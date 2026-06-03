import csv
import io
import re
import httpx
from datetime import datetime
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Response, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Event, Guest, User
from ..schemas import GuestOut, GuestCreate
from ..auth import require_admin
from services.qr_service import generate_qr_bytes
from services.email_service import send_invite_email
from services import messaging

router = APIRouter()

_E164_RE = re.compile(r'^\+[1-9]\d{6,14}$')
# Strip everything except digits and leading '+'.
_PHONE_STRIP = re.compile(r'[^\d+]')


def _normalize_phone(raw: str, default_country_code: str = "1") -> str | None:
    """Coerce a freeform phone string into E.164.

    Accepts: '+1 832-794-1707', '(832) 794-1707', '8327941707',
             '18327941707', '+18327941707'.
    Returns: '+18327941707' or None if the digits don't look like a valid number.

    `default_country_code` is used when the input has no '+' and looks like a
    local number. Defaults to US (1) — change if your event audience is elsewhere.
    """
    if not raw:
        return None
    cleaned = _PHONE_STRIP.sub('', raw.strip())
    if not cleaned:
        return None
    if cleaned.startswith('+'):
        candidate = cleaned
    elif cleaned.startswith('00'):
        # Some countries write international as 00<cc>... — treat as +<cc>...
        candidate = '+' + cleaned[2:]
    elif len(cleaned) == 10 and default_country_code == "1":
        # Bare US 10-digit number
        candidate = '+1' + cleaned
    elif len(cleaned) == 11 and cleaned.startswith('1') and default_country_code == "1":
        candidate = '+' + cleaned
    else:
        # Could be a longer non-US number missing its + — assume international and prepend.
        candidate = '+' + cleaned
    return candidate if _E164_RE.match(candidate) else None

# A real browser UA is required: SharePoint Online's abuse filter
# rejects requests with bot-looking User-Agents (returns 401/403).
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _xlsx_to_csv_text(raw: bytes) -> str:
    """Convert xlsx binary to CSV-like text."""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(400, "Excel file is empty")
    out = io.StringIO()
    writer = csv.writer(out)
    for row in rows:
        writer.writerow([str(c) if c is not None else "" for c in row])
    return out.getvalue()


def _decode_csv_bytes(raw: bytes, filename: str = "") -> str:
    name_lower = filename.lower()
    if name_lower.endswith(".xlsx") or raw[:4] == b"PK\x03\x04":
        return _xlsx_to_csv_text(raw)
    if name_lower.endswith(".xls") or raw[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise HTTPException(400, "Old .xls format is not supported — save as .xlsx or export as CSV")
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    raise HTTPException(400, "Could not decode file — save it as UTF-8 CSV and try again")


def _google_sheets_csv_url(url: str) -> str | None:
    """Convert a Google Sheets share URL to a CSV export URL."""
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
    if not m:
        return None
    sheet_id = m.group(1)
    gid_m = re.search(r"[?&]gid=(\d+)", url)
    gid = gid_m.group(1) if gid_m else "0"
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"


def _normalize_excel_url(url: str) -> str:
    """For OneDrive / SharePoint URLs, ensure ?download=1 is set so the
    redirect chain serves the raw file instead of the web viewer."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if not any(h in host for h in ("1drv.ms", "onedrive.live.com", "sharepoint.com")):
        return url
    if "download=1" in url:
        return url
    sep = "&" if parsed.query else "?"
    return f"{url}{sep}download=1"


async def _fetch_sheet_csv(url: str) -> tuple[bytes, str]:
    """Returns (raw_bytes, inferred_filename). Raises HTTPException(400) on failure."""
    google_url = _google_sheets_csv_url(url)
    fetch_url = google_url or _normalize_excel_url(url)

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=30,
            headers={"User-Agent": _BROWSER_UA, "Accept": "*/*"},
        ) as client:
            resp = await client.get(fetch_url)
    except Exception as e:
        raise HTTPException(400, f"Failed to reach spreadsheet URL: {e}")

    if resp.status_code >= 400:
        raise HTTPException(
            400,
            f"Could not fetch spreadsheet (HTTP {resp.status_code}). "
            "Make sure sharing is set to 'Anyone with the link can view' and "
            "paste the OneDrive/Excel Share → Copy link URL (not the browser address-bar URL).",
        )

    content_type = resp.headers.get("content-type", "").lower()
    body = resp.content
    if "text/html" in content_type or body.lstrip()[:200].lower().startswith(b"<!doctype html"):
        raise HTTPException(
            400,
            "The link returned an HTML page instead of a file — sharing is probably restricted. "
            "Open the file in OneDrive/Excel, click Share → 'Anyone with the link can view', "
            "copy that link, and paste it here.",
        )

    fname = "sheet.csv"
    if "spreadsheetml" in content_type or "xlsx" in content_type or body[:4] == b"PK\x03\x04":
        fname = "sheet.xlsx"
    return body, fname


async def _process_csv(text: str, event_id: str, db: AsyncSession):
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    reader = csv.DictReader(io.StringIO(text))
    fields = {(f or '').strip().lower() for f in (reader.fieldnames or [])}
    missing = {'first_name', 'last_name', 'email'} - fields
    if missing:
        raise HTTPException(
            400,
            f"CSV is missing required columns: {', '.join(sorted(missing))}. "
            "Expected header: first_name,last_name,email,phone"
        )

    added = skipped = invalid_phones = backfilled_phones = 0
    for row in reader:
        email = row.get("email", "").strip().lower()
        first = row.get("first_name", "").strip()
        last = row.get("last_name", "").strip()
        if not email:
            skipped += 1
            continue

        phone_raw = row.get("phone", "").strip()
        normalized_phone: str | None = None
        if phone_raw:
            normalized_phone = _normalize_phone(phone_raw)
            if normalized_phone is None:
                invalid_phones += 1

        # Deduplicate on (first_name + last_name + email) — same person twice
        existing = (await db.execute(
            select(Guest).where(
                Guest.event_id == event_id,
                Guest.email == email,
                Guest.first_name == first,
                Guest.last_name == last,
            )
        )).scalar_one_or_none()
        if existing:
            # Backfill missing fields on re-import — useful when the source spreadsheet
            # now has a phone number that was blank/invalid on the first import.
            if not existing.phone and normalized_phone:
                existing.phone = normalized_phone
                backfilled_phones += 1
            skipped += 1
            continue

        db.add(Guest(
            event_id=event_id,
            first_name=first,
            last_name=last,
            email=email,
            phone=normalized_phone,
        ))
        added += 1

    await db.commit()
    result = {"added": added, "skipped": skipped}
    if backfilled_phones:
        result["backfilled_phones"] = backfilled_phones
    if invalid_phones:
        result["invalid_phones"] = invalid_phones
        result["phone_note"] = "Phones with invalid format were cleared (must be E.164 e.g. +447911123456)"
    return result


@router.post("/{event_id}/guests/upload")
async def upload_guests(event_id: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    raw = await file.read()
    text = _decode_csv_bytes(raw, file.filename or "")
    return await _process_csv(text, event_id, db)


def _dispatch_invite(background_tasks: BackgroundTasks, event: Event, guest: Guest) -> None:
    """Fan out an invite across enabled channels for this event. Channel modules
    no-op silently when contact info is missing or creds aren't configured."""
    ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}"

    if event.notify_email:
        guest_data = {
            "first_name": guest.first_name,
            "last_name":  guest.last_name,
            "email":      guest.email,
            "qr_token":   guest.qr_token,
        }
        background_tasks.add_task(
            send_invite_email,
            guest_data, event.name, event.couples_name, event.checkin_base_url, event.event_date,
            event.seating_enabled, event.menu_enabled,
        )

    if event.notify_sms and guest.phone and guest.sms_consent:
        background_tasks.add_task(
            messaging.send_invite_sms,
            phone=guest.phone, first_name=guest.first_name,
            event_name=event.name, ticket_url=ticket_url, event_date=event.event_date,
        )

    if event.notify_whatsapp and guest.phone and guest.whatsapp_consent:
        background_tasks.add_task(
            messaging.send_invite_whatsapp,
            phone=guest.phone, first_name=guest.first_name,
            event_name=event.name, ticket_url=ticket_url, event_date=event.event_date,
        )


async def import_from_source_url(url: str, event_id: str, db: AsyncSession) -> dict:
    """Fetch a Google Sheets / OneDrive / Excel Online URL and merge rows into the event.
    Shared by the manual import endpoint and the background sync poller."""
    raw, fname = await _fetch_sheet_csv(url)
    text = _decode_csv_bytes(raw, fname)
    return await _process_csv(text, event_id, db)


@router.post("/{event_id}/guests/import-url")
async def import_guests_from_url(
    event_id: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(400, "url is required")

    return await import_from_source_url(url, event_id, db)


@router.post("/{event_id}/guests", response_model=GuestOut, status_code=201)
async def add_guest(event_id: str, data: GuestCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    """Manually add a single guest — used for VVIP walk-ins not on the original list.
    Email is optional; phone validated if provided. No invite is auto-sent."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    first = data.first_name.strip()
    last = data.last_name.strip()
    if not first or not last:
        raise HTTPException(400, "first_name and last_name are required")
    email = (data.email or "").strip().lower()
    phone_raw = (data.phone or "").strip()
    phone = _normalize_phone(phone_raw) if phone_raw else None
    if phone_raw and phone is None:
        raise HTTPException(400, "Phone format not recognised. Use E.164 (e.g. +18327941707) or US 10-digit.")

    guest = Guest(event_id=event_id, first_name=first, last_name=last, email=email, phone=phone, is_vip=bool(data.is_vip))
    db.add(guest)
    await db.commit()
    await db.refresh(guest)
    return guest


@router.get("/{event_id}/guests", response_model=list[GuestOut])
async def list_guests(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(
        select(Guest).where(Guest.event_id == event_id).order_by(Guest.last_name, Guest.first_name)
    )
    return result.scalars().all()


@router.delete("/{event_id}/guests/{guest_id}", status_code=204)
async def delete_guest(event_id: str, guest_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    await db.delete(guest)
    await db.commit()


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

    for guest in guests:
        _dispatch_invite(background_tasks, event, guest)
        guest.invite_sent_at = datetime.utcnow()

    await db.commit()
    return {"queued": len(guests)}


@router.post("/{event_id}/guests/send-batch")
async def send_invites_batch(
    event_id: str,
    body: dict = Body(default={}),
    background_tasks: BackgroundTasks = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Send (or resend) invites in bulk.

    Body:
      guest_ids: list[str] | None  — if omitted, applies to all guests in the event
      force: bool                  — if true, re-send even to already-invited guests
                                     (otherwise only unsent guests get the email)
    """
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    guest_ids = body.get("guest_ids") or []
    force = bool(body.get("force", False))

    q = select(Guest).where(Guest.event_id == event_id)
    if guest_ids:
        q = q.where(Guest.id.in_(guest_ids))
    if not force:
        q = q.where(Guest.invite_sent_at == None)  # noqa: E711

    guests = (await db.execute(q)).scalars().all()

    queued = 0
    now = datetime.utcnow()
    for guest in guests:
        # Auto-generate QR timestamp on first send so it can also be a no-op for never-touched guests.
        if not guest.qr_generated_at:
            guest.qr_generated_at = now
        _dispatch_invite(background_tasks, event, guest)
        guest.invite_sent_at = now
        queued += 1

    await db.commit()
    return {"queued": queued, "force": force, "scope": "selected" if guest_ids else "all"}


@router.post("/{event_id}/guests/{guest_id}/resend-invite")
async def resend_invite(event_id: str, guest_id: str, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    if not guest.qr_generated_at:
        raise HTTPException(400, "Generate QR codes first before sending invites")

    _dispatch_invite(background_tasks, event, guest)
    guest.invite_sent_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.get("/{event_id}/guests/{guest_id}/qr.png")
async def get_guest_qr(event_id: str, guest_id: str, db: AsyncSession = Depends(get_db)):
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    event = await db.get(Event, event_id)
    qr_bytes = generate_qr_bytes(guest.qr_token, event.checkin_base_url)
    return Response(content=qr_bytes, media_type="image/png")
