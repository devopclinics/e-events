from datetime import datetime
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Guest
from ..schemas import ScanResult, GuestOut
from services.email_service import send_admission_email
from services.sms_service import send_admission_sms
from . import broadcast

router = APIRouter()


@router.post("/{qr_token}", response_model=ScanResult)
async def scan_qr(qr_token: str, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Guest).where(Guest.qr_token == qr_token))
    guest = result.scalar_one_or_none()

    if not guest:
        return ScanResult(status="invalid", message="Invalid QR code. This ticket was not found.")

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
