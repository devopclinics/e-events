from datetime import datetime
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Guest, Event, EventUser, User, SeatingTable, MenuCategory, MenuItem, GuestMenuChoice
from ..schemas import ScanResult, GuestOut, TicketView, EventBrief, MenuCategoryOut, MenuItemOut, GuestMenuSubmit
from ..auth import require_official
from services.email_service import send_admission_email
from services.sms_service import send_admission_sms
from services.qr_service import generate_qr_bytes
from . import broadcast

router = APIRouter()


async def _load_menu(event_id: str, guest_id: str, db: AsyncSession):
    """Returns (menu_categories, guest_choices_dict)."""
    cats = (await db.execute(
        select(MenuCategory).where(MenuCategory.event_id == event_id).order_by(MenuCategory.sort_order, MenuCategory.name)
    )).scalars().all()

    menu_out = []
    for cat in cats:
        items = (await db.execute(select(MenuItem).where(MenuItem.category_id == cat.id))).scalars().all()
        menu_out.append(MenuCategoryOut(
            id=cat.id, event_id=event_id, name=cat.name, sort_order=cat.sort_order,
            items=[MenuItemOut(id=i.id, category_id=i.category_id, name=i.name, description=i.description) for i in items],
        ))

    choices_rows = (await db.execute(
        select(GuestMenuChoice).where(GuestMenuChoice.guest_id == guest_id)
    )).scalars().all()
    choices = {c.category_id: c.menu_item_id for c in choices_rows}

    return menu_out, choices


@router.get("/{qr_token}/ticket", response_model=TicketView)
async def view_ticket(qr_token: str, db: AsyncSession = Depends(get_db)):
    """Public — guest views their digital ticket."""
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        return TicketView(status="invalid")

    event = await db.get(Event, guest.event_id)
    event_brief = EventBrief(
        name=event.name,
        couples_name=event.couples_name,
        event_date=event.event_date,
        status=event.status,
        seating_enabled=event.seating_enabled,
        menu_enabled=event.menu_enabled,
    ) if event else None

    table_name = None
    if guest.table_id:
        table = await db.get(SeatingTable, guest.table_id)
        if table:
            table_name = table.name

    menu_categories = []
    guest_choices: dict[str, str] = {}
    if event and event.menu_enabled and event.status == "active":
        menu_categories, guest_choices = await _load_menu(guest.event_id, guest.id, db)

    return TicketView(
        status="admitted" if guest.admitted else "valid",
        guest=GuestOut.model_validate(guest),
        event=event_brief,
        table_name=table_name,
        seat_number=guest.seat_number,
        menu_categories=menu_categories,
        guest_choices=guest_choices,
    )


@router.get("/{qr_token}/qr.png")
async def ticket_qr_image(qr_token: str, db: AsyncSession = Depends(get_db)):
    """Public — QR image for the guest's own ticket page."""
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        return Response(status_code=404)
    event = await db.get(Event, guest.event_id)
    base_url = event.checkin_base_url if event else "https://events.nihlah.io"
    return Response(content=generate_qr_bytes(qr_token, base_url), media_type="image/png")


@router.post("/{qr_token}", response_model=ScanResult)
async def scan_qr(
    qr_token: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_official),
):
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        return ScanResult(status="invalid", message="Invalid QR code. This ticket was not found.")

    event = await db.get(Event, guest.event_id)

    if event and event.status != "active":
        label = "has not started yet" if event.status == "draft" else "has ended"
        return ScanResult(status="not_active", message=f"'{event.name}' {label}. Scanning is disabled.")

    if current_user.role == "official":
        assigned = await db.scalar(
            select(EventUser).where(EventUser.event_id == guest.event_id, EventUser.user_id == current_user.id)
        )
        if not assigned:
            return ScanResult(status="not_assigned", message="You are not assigned to this event.")

    # Resolve table name for display
    table_name = None
    if guest.table_id:
        table = await db.get(SeatingTable, guest.table_id)
        if table:
            table_name = table.name

    if guest.admitted:
        admitted_time = guest.admitted_at.strftime("%H:%M") if guest.admitted_at else "unknown"
        return ScanResult(
            status="already_admitted",
            message=f"{guest.first_name} {guest.last_name} was already admitted at {admitted_time}.",
            guest=GuestOut.model_validate(guest),
            table_name=table_name,
            seat_number=guest.seat_number,
        )

    guest.admitted = True
    guest.admitted_at = datetime.utcnow()
    guest.admit_notified = True
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

    broadcast(guest.event_id, {
        "type": "admitted",
        "guest_id": guest.id,
        "name": f"{guest.first_name} {guest.last_name}",
        "email": guest.email,
        "admitted_at": guest.admitted_at.isoformat(),
    })

    return ScanResult(
        status="admitted",
        message=f"Welcome, {guest.first_name} {guest.last_name}! You are admitted.",
        guest=GuestOut.model_validate(guest),
        table_name=table_name,
        seat_number=guest.seat_number,
    )


@router.post("/{qr_token}/menu")
async def submit_menu(qr_token: str, body: GuestMenuSubmit, db: AsyncSession = Depends(get_db)):
    """Public — guest submits or updates their menu selection."""
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        raise HTTPException(status_code=404, detail="Invalid ticket")
    event = await db.get(Event, guest.event_id)
    if not event or not event.menu_enabled:
        raise HTTPException(status_code=400, detail="Menu selection is not enabled for this event")
    if event.status != "active":
        raise HTTPException(status_code=400, detail="Menu selection is only available while the event is active")
    if guest.meal_served:
        raise HTTPException(status_code=400, detail="Your meal has been served — selection is locked")

    for category_id, menu_item_id in body.choices.items():
        item = await db.get(MenuItem, menu_item_id)
        if not item or item.event_id != guest.event_id or item.category_id != category_id:
            raise HTTPException(status_code=400, detail=f"Invalid selection for category {category_id}")
        existing = await db.scalar(
            select(GuestMenuChoice).where(GuestMenuChoice.guest_id == guest.id, GuestMenuChoice.category_id == category_id)
        )
        if existing:
            existing.menu_item_id = menu_item_id
            existing.chosen_at = datetime.utcnow()
        else:
            db.add(GuestMenuChoice(guest_id=guest.id, category_id=category_id, menu_item_id=menu_item_id))

    await db.commit()
    return {"ok": True}
