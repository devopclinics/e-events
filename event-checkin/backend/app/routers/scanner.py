from datetime import datetime
from fastapi import APIRouter, Depends, BackgroundTasks
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Guest, Event, EventUser, User
from ..schemas import ScanResult, GuestOut, TicketView, EventBrief
from ..auth import require_official
from services.email_service import send_admission_email
from services.sms_service import send_admission_sms
from services.qr_service import generate_qr_bytes
from . import broadcast

router = APIRouter()


@router.get("/{qr_token}/ticket", response_model=TicketView)
async def view_ticket(qr_token: str, db: AsyncSession = Depends(get_db)):
    """Public — guest views their digital ticket."""
    result = await db.execute(select(Guest).where(Guest.qr_token == qr_token))
    guest = result.scalar_one_or_none()
    if not guest:
        return TicketView(status="invalid")
    event = await db.get(Event, guest.event_id)
    event_brief = EventBrief(
        name=event.name,
        couples_name=event.couples_name,
        event_date=event.event_date,
        status=event.status,
    ) if event else None
    return TicketView(
        status="admitted" if guest.admitted else "valid",
        guest=GuestOut.model_validate(guest),
        event=event_brief,
    )


@router.get("/{qr_token}/qr.png")
async def ticket_qr_image(qr_token: str, db: AsyncSession = Depends(get_db)):
    """Public — QR image for the guest's own ticket page."""
    result = await db.execute(select(Guest).where(Guest.qr_token == qr_token))
    guest = result.scalar_one_or_none()
    if not guest:
        return Response(status_code=404)
    event = await db.get(Event, guest.event_id)
    base_url = event.checkin_base_url if event else "https://events.vsgs.io"
    return Response(content=generate_qr_bytes(qr_token, base_url), media_type="image/png")


@router.post("/{qr_token}", response_model=ScanResult)
async def scan_qr(
    qr_token: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_official),
):
    result = await db.execute(select(Guest).where(Guest.qr_token == qr_token))
    guest = result.scalar_one_or_none()

    if not guest:
        return ScanResult(status="invalid", message="Invalid QR code. This ticket was not found.")

    event = await db.get(Event, guest.event_id)

    # Block scanning when event is not active
    if event and event.status != "active":
        label = "has not started yet" if event.status == "draft" else "has ended"
        return ScanResult(
            status="not_active",
            message=f"'{event.name}' {label}. Scanning is disabled.",
        )

    # Officials must be assigned to this event; admins bypass
    if current_user.role == "official":
        assigned = await db.scalar(
            select(EventUser).where(
                EventUser.event_id == guest.event_id,
                EventUser.user_id == current_user.id,
            )
        )
        if not assigned:
            return ScanResult(
                status="not_assigned",
                message="You are not assigned to this event.",
            )

    if guest.admitted:
        admitted_time = guest.admitted_at.strftime("%H:%M") if guest.admitted_at else "unknown"
        return ScanResult(
            status="already_admitted",
            message=f"{guest.first_name} {guest.last_name} was already admitted at {admitted_time}.",
            guest=GuestOut.model_validate(guest),
        )

    guest.admitted = True
    guest.admitted_at = datetime.utcnow()
    await db.commit()
    await db.refresh(guest)

    guest_data = {
        "first_name": guest.first_name,
        "last_name": guest.last_name,
        "email": guest.email,
        "phone": guest.phone,
        "admitted_at": guest.admitted_at,
    }

    background_tasks.add_task(send_admission_email, guest_data)
    if guest.phone:
        background_tasks.add_task(send_admission_sms, guest_data)

    broadcast(
        guest.event_id,
        {
            "type": "admitted",
            "guest_id": guest.id,
            "name": f"{guest.first_name} {guest.last_name}",
            "email": guest.email,
            "admitted_at": guest.admitted_at.isoformat(),
        },
    )

    return ScanResult(
        status="admitted",
        message=f"Welcome, {guest.first_name} {guest.last_name}! You are admitted.",
        guest=GuestOut.model_validate(guest),
    )
