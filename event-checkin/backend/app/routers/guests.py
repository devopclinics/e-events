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
from ..schemas import GuestOut
from ..auth import require_admin
from services.qr_service import generate_qr_bytes
from services.email_service import send_invite_email

router = APIRouter()

_E164_RE = re.compile(r'^\+[1-9]\d{6,14}$')

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

    added = skipped = invalid_phones = 0
    for row in reader:
        email = row.get("email", "").strip().lower()
        first = row.get("first_name", "").strip()
        last = row.get("last_name", "").strip()
        if not email:
            skipped += 1
            continue
        # Deduplicate on (first_name + last_name + email) — same person twice
        existing = await db.execute(
            select(Guest).where(
                Guest.event_id == event_id,
                Guest.email == email,
                Guest.first_name == first,
                Guest.last_name == last,
            )
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue

        phone_raw = row.get("phone", "").strip()
        if phone_raw and not _E164_RE.match(phone_raw):
            phone = None
            invalid_phones += 1
        else:
            phone = phone_raw or None

        db.add(Guest(
            event_id=event_id,
            first_name=first,
            last_name=last,
            email=email,
            phone=phone,
        ))
        added += 1

    await db.commit()
    result = {"added": added, "skipped": skipped}
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
        guest_data = {
            "first_name": guest.first_name,
            "last_name": guest.last_name,
            "email": guest.email,
            "qr_token": guest.qr_token,
        }
        background_tasks.add_task(send_invite_email, guest_data, event.name, event.couples_name, event.checkin_base_url, event.event_date)
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
        guest_data = {
            "first_name": guest.first_name,
            "last_name": guest.last_name,
            "email": guest.email,
            "qr_token": guest.qr_token,
        }
        background_tasks.add_task(
            send_invite_email,
            guest_data, event.name, event.couples_name, event.checkin_base_url, event.event_date,
        )
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

    guest_data = {
        "first_name": guest.first_name,
        "last_name": guest.last_name,
        "email": guest.email,
        "qr_token": guest.qr_token,
    }
    background_tasks.add_task(send_invite_email, guest_data, event.name, event.couples_name, event.checkin_base_url, event.event_date)
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
