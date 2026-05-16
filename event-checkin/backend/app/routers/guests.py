import csv
import io
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Event, Guest, User
from ..schemas import GuestOut
from ..auth import require_admin
from services.qr_service import generate_qr_bytes
from services.email_service import send_invite_email

router = APIRouter()


@router.post("/{event_id}/guests/upload")
async def upload_guests(event_id: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    content = await file.read()
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))

    added = 0
    skipped = 0
    for row in reader:
        email = row.get("email", "").strip().lower()
        if not email:
            skipped += 1
            continue
        existing = await db.execute(select(Guest).where(Guest.event_id == event_id, Guest.email == email))
        if existing.scalar_one_or_none():
            skipped += 1
            continue
        guest = Guest(
            event_id=event_id,
            first_name=row.get("first_name", "").strip(),
            last_name=row.get("last_name", "").strip(),
            email=email,
            phone=row.get("phone", "").strip() or None,
        )
        db.add(guest)
        added += 1

    await db.commit()
    return {"added": added, "skipped": skipped}


@router.get("/{event_id}/guests", response_model=list[GuestOut])
async def list_guests(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(
        select(Guest).where(Guest.event_id == event_id).order_by(Guest.last_name, Guest.first_name)
    )
    return result.scalars().all()


@router.post("/{event_id}/guests/generate-qr")
async def generate_qr_codes(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    result = await db.execute(
        select(Guest).where(Guest.event_id == event_id, Guest.qr_generated_at == None)
    )
    guests = result.scalars().all()

    for guest in guests:
        guest.qr_generated_at = datetime.utcnow()

    await db.commit()
    return {"generated": len(guests)}


@router.post("/{event_id}/guests/send-invites")
async def send_invites(event_id: str, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    result = await db.execute(
        select(Guest).where(
            Guest.event_id == event_id,
            Guest.qr_generated_at != None,
            Guest.invite_sent_at == None,
        )
    )
    guests = result.scalars().all()

    event_name = event.name
    couples_name = event.couples_name
    checkin_base_url = event.checkin_base_url
    event_date = event.event_date

    for guest in guests:
        guest_data = {
            "first_name": guest.first_name,
            "last_name": guest.last_name,
            "email": guest.email,
            "qr_token": guest.qr_token,
        }
        background_tasks.add_task(send_invite_email, guest_data, event_name, couples_name, checkin_base_url, event_date)
        guest.invite_sent_at = datetime.utcnow()

    await db.commit()
    return {"queued": len(guests)}


@router.get("/{event_id}/guests/{guest_id}/qr.png")
async def get_guest_qr(event_id: str, guest_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    event = await db.get(Event, event_id)
    qr_bytes = generate_qr_bytes(guest.qr_token, event.checkin_base_url)
    return Response(content=qr_bytes, media_type="image/png")
