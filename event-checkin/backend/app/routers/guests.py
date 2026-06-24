import csv
import io
import logging
import re
import httpx

logger = logging.getLogger(__name__)
from datetime import datetime
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Response, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Event, Guest, User, TableGroup, SeatingTable, EventUser
from ..schemas import GuestOut, GuestCreate, GuestUpdate, GuestSearchResult, ScanResult
from ..auth import require_admin, require_official
from services.qr_service import generate_qr_bytes
from services.email_service import send_invite_email, send_plain_email, send_template_email
from services import messaging

router = APIRouter()

_E164_RE = re.compile(r'^\+[1-9]\d{6,14}$')
# Strip everything except digits and leading '+'.
_PHONE_STRIP = re.compile(r'[^\d+]')


def _normalize_phone(raw: str, default_country_code: str = "1") -> str | None:
    """Coerce a freeform phone string into E.164.

    Accepts: '+1 832-794-1707', '(832) 794-1707', '8327941707',
             '18327941707', '+18327941707',
             '08012345678' (Nigerian trunk prefix → +2348012345678).
    Returns E.164 string or None if unrecognisable.
    """
    if not raw:
        return None
    cleaned = _PHONE_STRIP.sub('', raw.strip())
    if not cleaned:
        return None
    if cleaned.startswith('+'):
        candidate = cleaned
    elif cleaned.startswith('00'):
        candidate = '+' + cleaned[2:]
    elif len(cleaned) == 11 and cleaned.startswith('0'):
        # Nigerian (and other West African) trunk-prefix format: 0XXXXXXXXXX → +234XXXXXXXXXX
        candidate = '+234' + cleaned[1:]
    elif len(cleaned) == 10 and default_country_code == "1":
        candidate = '+1' + cleaned
    elif len(cleaned) == 11 and cleaned.startswith('1') and default_country_code == "1":
        candidate = '+' + cleaned
    else:
        candidate = '+' + cleaned
    return candidate if _E164_RE.match(candidate) else None

# A real browser UA is required: SharePoint Online's abuse filter
# rejects requests with bot-looking User-Agents (returns 401/403).
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


_GUEST_HEADER_COLS = {"first_name", "last_name", "email"}

def _xlsx_to_csv_text(raw: bytes) -> str:
    """Convert xlsx binary to CSV-like text.

    When the workbook has multiple sheets, pick the first sheet whose header
    row contains all required guest columns. Falls back to the active sheet
    so existing single-sheet workbooks are unaffected.
    """
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)

    def _sheet_has_guest_header(ws) -> bool:
        for row in ws.iter_rows(min_row=1, max_row=5, values_only=True):
            cells = {str(c).strip().lower() for c in row if c is not None}
            if _GUEST_HEADER_COLS.issubset(cells):
                return True
        return False

    # Prefer the first sheet that looks like a guest list
    chosen = wb.active
    for name in wb.sheetnames:
        ws = wb[name]
        if _sheet_has_guest_header(ws):
            chosen = ws
            break

    rows = list(chosen.iter_rows(values_only=True))
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
    missing = {'first_name'} - fields
    if missing:
        raise HTTPException(
            400,
            f"CSV is missing required columns: {', '.join(sorted(missing))}. "
            "Expected header: first_name,last_name,email,phone"
        )

    # Detect phone column (any common alias)
    _PHONE_ALIASES = {'phone', 'phone_number', 'phone number', 'mobile', 'mobile_number',
                      'mobile number', 'cell', 'cell_phone', 'cell phone', 'telephone', 'tel', 'contact'}
    phone_col = next((f for f in (reader.fieldnames or []) if (f or '').strip().lower() in _PHONE_ALIASES), None)

    # Detect table-group column (any of the supported aliases)
    _TG_ALIASES = {'table_group', 'table_tag', 'assigned_table_tag', 'assigned_table_group'}
    tg_col = next((f for f in (reader.fieldnames or []) if (f or '').strip().lower() in _TG_ALIASES), None)

    # Detect table column (specific table within a group)
    _TABLE_ALIASES = {'table', 'table_name', 'table name', 'assigned_table', 'assigned table', 'seat_table'}
    table_col = next((f for f in (reader.fieldnames or []) if (f or '').strip().lower() in _TABLE_ALIASES), None)

    # Pre-load all table groups for this event keyed by normalised tag.
    tg_by_tag: dict[str, str] = {}  # tag → group.id
    if tg_col:
        tg_rows = (await db.execute(
            select(TableGroup).where(TableGroup.event_id == event_id)
        )).scalars().all()
        tg_by_tag = {g.tag: g.id for g in tg_rows}

    # Pre-load all tables for this event keyed by normalised name.
    table_by_name: dict[str, str] = {}  # lower(name) → table.id
    if table_col:
        tbl_rows = (await db.execute(
            select(SeatingTable).where(SeatingTable.event_id == event_id)
        )).scalars().all()
        table_by_name = {t.name.strip().lower(): t.id for t in tbl_rows}

    added = skipped = invalid_phones = backfilled_phones = tg_unknown = 0
    skipped_rows: list[dict] = []   # {row, first_name, last_name, reason}
    for row_num, row in enumerate(reader, start=2):  # start=2: row 1 is the header
        email = row.get("email", "").strip().lower()
        first = row.get("first_name", "").strip()
        last = row.get("last_name", "").strip()
        if not first:
            skipped += 1
            skipped_rows.append({"row": row_num, "first_name": first, "last_name": last, "reason": "blank first_name"})
            continue

        phone_raw = (row.get(phone_col) or "").strip() if phone_col else ""
        normalized_phone: str | None = None
        if phone_raw:
            normalized_phone = _normalize_phone(phone_raw)
            if normalized_phone is None:
                invalid_phones += 1

        # Resolve table group ID from import column.
        table_group_id: str | None = None
        if tg_col:
            raw_tag = (row.get(tg_col) or "").strip().lower().replace(" ", "_")
            if raw_tag:
                if raw_tag in tg_by_tag:
                    table_group_id = tg_by_tag[raw_tag]
                else:
                    tg_unknown += 1

        # Resolve specific table ID from import column.
        table_id: str | None = None
        if table_col:
            raw_table = (row.get(table_col) or "").strip().lower()
            if raw_table and raw_table in table_by_name:
                table_id = table_by_name[raw_table]

        # Deduplicate: match on first+last name (case-insensitive).
        # Email is NOT used as a match key — it can differ between syncs and would
        # create false duplicates when a guest was previously imported without an email.
        from sqlalchemy import func as _func
        existing = (await db.execute(
            select(Guest).where(
                Guest.event_id == event_id,
                _func.lower(Guest.first_name) == first.lower(),
                _func.lower(Guest.last_name) == last.lower(),
            )
        )).scalar_one_or_none()
        if existing:
            # Backfill / correct any fields that improved in the spreadsheet.
            if normalized_phone and existing.phone != normalized_phone:
                existing.phone = normalized_phone
                backfilled_phones += 1
            if email and existing.email != email:
                existing.email = email
            if table_group_id and existing.table_group_id != table_group_id:
                existing.table_group_id = table_group_id
            if table_id and existing.table_id != table_id:
                existing.table_id = table_id
            skipped += 1
            skipped_rows.append({"row": row_num, "first_name": first, "last_name": last, "reason": "duplicate"})
            continue

        db.add(Guest(
            event_id=event_id,
            first_name=first,
            last_name=last,
            email=email,
            phone=normalized_phone,
            table_group_id=table_group_id,
            table_id=table_id,
        ))
        added += 1

    await db.commit()
    skipped_blank = sum(1 for r in skipped_rows if r["reason"] == "blank first_name")
    skipped_duplicate = sum(1 for r in skipped_rows if r["reason"] == "duplicate")
    logger.info(
        "Import result event=%s added=%d skipped=%d blank=%d duplicate=%d invalid_phones=%d tg_unknown=%d",
        event_id, added, skipped, skipped_blank, skipped_duplicate, invalid_phones, tg_unknown,
    )
    result = {"added": added, "skipped": skipped}
    if skipped_rows:
        result["skipped_rows"] = skipped_rows[:100]  # cap at 100 to keep response size sane
    if skipped_blank:
        result["skipped_blank_name"] = skipped_blank
    if skipped_duplicate:
        result["skipped_duplicate"] = skipped_duplicate
    if backfilled_phones:
        result["backfilled_phones"] = backfilled_phones
    if invalid_phones:
        result["invalid_phones"] = invalid_phones
        result["phone_note"] = "Phones with invalid format were cleared (must be E.164 e.g. +447911123456)"
    if tg_unknown:
        result["unknown_table_groups"] = tg_unknown
        result["table_group_note"] = "Some table group tags were not found for this event and were ignored"
    return result


@router.post("/{event_id}/guests/upload")
async def upload_guests(event_id: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    raw = await file.read()
    text = _decode_csv_bytes(raw, file.filename or "")
    return await _process_csv(text, event_id, db)


async def _dispatch_invite(background_tasks: BackgroundTasks, event: Event, guest: Guest, db) -> bool:
    """Fan out an invite across enabled channels for this event.
    Returns True if at least one channel was dispatched (i.e. guest is reachable).
    Uses the organizer's custom message template when one has been saved;
    falls back to the rich HTML email with embedded QR code otherwise."""
    from services import template_service as _ts
    from ..models import MessageTemplate as _MT
    from sqlalchemy import func as _func

    ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}"
    event_date_str = event.event_date.strftime("%A, %d %B %Y") if event.event_date else ""

    # Resolve the invite_email template and check for an event-level override.
    resolved = await _ts.resolve_template("invite_email", event.id, db)
    has_custom = bool(await db.scalar(
        select(_func.count(_MT.id)).where(
            _MT.template_key == "invite_email",
            _MT.scope == "event",
            _MT.event_id == event.id,
        )
    ))

    dispatched = False

    if event.notify_email and guest.email:
        dispatched = True
        if has_custom and resolved.get("email_body"):
            ctx = {
                "guest_first_name": guest.first_name,
                "guest_last_name":  guest.last_name,
                "guest_full_name":  f"{guest.first_name} {guest.last_name}",
                "event_name":       event.name,
                "event_date":       event_date_str,
                "organizer_name":   event.couples_name or event.name,
                "ticket_link":      ticket_url,
                "rsvp_link":        ticket_url,
                "table_name":       "",
                "seat_number":      "",
                "table_group":      "",
            }
            rendered = _ts.render_template(resolved, ctx)
            background_tasks.add_task(
                send_template_email,
                guest.email,
                rendered.get("subject") or f"Your Invitation — {event.name}",
                rendered.get("email_body") or "",
                guest.qr_token,
                event.checkin_base_url,
            )
        else:
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
        dispatched = True
        sms_body = resolved.get("sms_body")
        if sms_body:
            ctx = {
                "guest_first_name": guest.first_name,
                "guest_last_name":  guest.last_name,
                "guest_full_name":  f"{guest.first_name} {guest.last_name}",
                "event_name":       event.name,
                "event_date":       event_date_str,
                "organizer_name":   event.couples_name or event.name,
                "ticket_link":      ticket_url,
                "rsvp_link":        ticket_url,
                "table_name": "", "seat_number": "", "table_group": "",
            }
            rendered_sms = _ts.render(sms_body, ctx)
            background_tasks.add_task(messaging.send_template_sms, phone=guest.phone, body=rendered_sms)
        else:
            background_tasks.add_task(
                messaging.send_invite_sms,
                phone=guest.phone, first_name=guest.first_name,
                event_name=event.name, ticket_url=ticket_url, event_date=event.event_date,
            )

    if event.notify_mms and guest.phone and guest.sms_consent:
        dispatched = True
        qr_image_url = f"{event.checkin_base_url.rstrip('/')}/api/scan/{guest.qr_token}/qr.png"
        mms_template_body = resolved.get("mms_body") or resolved.get("sms_body")
        ctx = {
            "guest_first_name": guest.first_name,
            "guest_last_name":  guest.last_name,
            "guest_full_name":  f"{guest.first_name} {guest.last_name}",
            "event_name":       event.name,
            "event_date":       event_date_str,
            "organizer_name":   event.couples_name or event.name,
            "ticket_link":      ticket_url,
            "rsvp_link":        ticket_url,
            "table_name": "", "seat_number": "", "table_group": "",
        }
        if mms_template_body:
            mms_body = _ts.render(mms_template_body, ctx)
        else:
            date_str = event.event_date.strftime("%a %d %b") if event.event_date else ""
            mms_body = (
                f"Hi {guest.first_name}! Your QR ticket for {event.name}"
                + (f" on {date_str}" if date_str else "")
                + f". Tap to view: {ticket_url}"
            )
        background_tasks.add_task(
            messaging.send_invite_mms,
            phone=guest.phone,
            body=mms_body,
            media_url=qr_image_url,
            subject=event.name,
            event_name=event.name,
            couples_name=event.couples_name or "",
            event_date=event.event_date,
            venue_name=event.venue_name or "",
            venue_address=event.venue_address or "",
            guest_first_name=guest.first_name,
            guest_last_name=guest.last_name or "",
        )

    if event.notify_whatsapp and guest.phone and guest.whatsapp_consent:
        dispatched = True
        wa_body = resolved.get("whatsapp_body")
        if wa_body:
            ctx = {
                "guest_first_name": guest.first_name,
                "guest_last_name":  guest.last_name,
                "guest_full_name":  f"{guest.first_name} {guest.last_name}",
                "event_name":       event.name,
                "event_date":       event_date_str,
                "organizer_name":   event.couples_name or event.name,
                "ticket_link":      ticket_url,
                "rsvp_link":        ticket_url,
                "table_name": "", "seat_number": "", "table_group": "",
            }
            rendered_wa = _ts.render(wa_body, ctx)
            background_tasks.add_task(messaging.send_template_whatsapp, phone=guest.phone, body=rendered_wa)
        else:
            background_tasks.add_task(
                messaging.send_invite_whatsapp,
                phone=guest.phone, first_name=guest.first_name,
                event_name=event.name, ticket_url=ticket_url, event_date=event.event_date,
            )

    return dispatched


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
    guests = result.scalars().all()

    tg_rows = (await db.execute(
        select(TableGroup).where(TableGroup.event_id == event_id)
    )).scalars().all()
    tg_name_by_id = {tg.id: tg.name for tg in tg_rows}

    out: list[GuestOut] = []
    for g in guests:
        payload = GuestOut.model_validate(g)
        out.append(payload.model_copy(update={"table_group_name": tg_name_by_id.get(g.table_group_id)}))
    return out


@router.get("/{event_id}/guests/import-template")
async def download_import_template(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Download a blank CSV template pre-populated with all supported columns
    and any existing table-group tags so the organizer can fill it in."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    # Fetch existing table groups so we can embed the valid tags as a comment row.
    tg_rows = (await db.execute(
        select(TableGroup).where(TableGroup.event_id == event_id).order_by(TableGroup.name)
    )).scalars().all()

    out = io.StringIO()
    writer = csv.writer(out)

    # Fetch tables so we can embed names as hints too.
    tbl_rows = (await db.execute(
        select(SeatingTable).where(SeatingTable.event_id == event_id).order_by(SeatingTable.name)
    )).scalars().all()

    # Header row — all columns the importer understands.
    writer.writerow(["first_name", "last_name", "email", "phone", "table_group", "table"])

    # One hint row per table group so the organizer knows the valid tag values.
    if tg_rows or tbl_rows:
        for tg in tg_rows:
            writer.writerow([f"# Group example: {tg.name}", "", "", "", tg.tag, ""])
        for tbl in tbl_rows[:5]:  # cap at 5 hint rows
            writer.writerow([f"# Table example: {tbl.name}", "", "", "", "", tbl.name])
    else:
        writer.writerow(["# Example", "Guest", "guest@example.com", "+14155550123", "", ""])

    filename = f"import-template-{event.name.replace(' ', '_')}.csv"
    return Response(
        content=out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{event_id}/guests/export")
async def export_guests(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Export the full guest list as CSV including table-group assignments."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    guests = (await db.execute(
        select(Guest).where(Guest.event_id == event_id).order_by(Guest.last_name, Guest.first_name)
    )).scalars().all()

    # Build a tag lookup for table groups.
    tg_rows = (await db.execute(
        select(TableGroup).where(TableGroup.event_id == event_id)
    )).scalars().all()
    tg_tag_by_id = {tg.id: tg.tag for tg in tg_rows}

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "first_name", "last_name", "email", "phone",
        "table_group", "admitted", "qr_generated", "invite_sent",
    ])
    for g in guests:
        writer.writerow([
            g.first_name,
            g.last_name,
            g.email,
            g.phone or "",
            tg_tag_by_id.get(g.table_group_id, "") if g.table_group_id else "",
            "yes" if g.admitted else "no",
            "yes" if g.qr_generated_at else "no",
            "yes" if g.invite_sent_at else "no",
        ])

    filename = f"guests-{event.name.replace(' ', '_')}.csv"
    return Response(
        content=out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/{event_id}/guests/{guest_id}", response_model=GuestOut)
async def update_guest(
    event_id: str,
    guest_id: str,
    data: GuestUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    if data.first_name is not None:
        guest.first_name = data.first_name.strip()
    if data.last_name is not None:
        guest.last_name = data.last_name.strip()
    if data.email is not None:
        guest.email = data.email.strip()
    if data.phone is not None:
        phone = _normalize_phone(data.phone.strip()) if data.phone.strip() else None
        if data.phone.strip() and phone is None:
            raise HTTPException(400, "Invalid phone format — use E.164 e.g. +447911123456")
        guest.phone = phone
    if data.is_vip is not None:
        guest.is_vip = data.is_vip
    if data.sms_consent is not None:
        guest.sms_consent = data.sms_consent
    if data.whatsapp_consent is not None:
        guest.whatsapp_consent = data.whatsapp_consent
    # Only update table_group_id if the field was explicitly sent in the request.
    if 'table_group_id' in data.model_fields_set:
        if data.table_group_id is None:
            guest.table_group_id = None
        else:
            # Validate the group belongs to this event.
            from ..models import TableGroup as TG
            tg = await db.get(TG, data.table_group_id)
            if not tg or tg.event_id != event_id:
                raise HTTPException(400, "Table group not found for this event")
            guest.table_group_id = data.table_group_id
    await db.commit()
    await db.refresh(guest)
    return guest


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
        ok = await _dispatch_invite(background_tasks, event, guest, db)
        guest.invite_sent_at = datetime.utcnow()
        guest.invite_status = "sent" if ok else "failed"

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
        ok = await _dispatch_invite(background_tasks, event, guest, db)
        guest.invite_sent_at = now
        guest.invite_status = "sent" if ok else "failed"
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

    ok = await _dispatch_invite(background_tasks, event, guest, db)
    guest.invite_sent_at = datetime.utcnow()
    guest.invite_status = "sent" if ok else "failed"
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


# ── Manual check-in: guest search ─────────────────────────────────────────────

@router.get("/{event_id}/guests/search", response_model=list[GuestSearchResult])
async def search_guests(
    event_id: str,
    q: str = "",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_official),
):
    """Search guests by first name, last name, or phone number (partial match).
    Used by the manual check-in flow on the scanner page.
    """
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    if current_user.role == "official":
        assigned = await db.scalar(
            select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == current_user.id)
        )
        if not assigned:
            raise HTTPException(403, "You are not assigned to this event")

    term = (q or "").strip()
    if not term:
        return []

    from sqlalchemy import or_
    guests = (await db.execute(
        select(Guest).where(
            Guest.event_id == event_id,
            or_(
                Guest.first_name.ilike(f"%{term}%"),
                Guest.last_name.ilike(f"%{term}%"),
                Guest.phone.ilike(f"%{term}%"),
            )
        ).order_by(Guest.last_name, Guest.first_name).limit(20)
    )).scalars().all()

    results = []
    for g in guests:
        table_name = None
        if g.table_id:
            tbl = await db.get(SeatingTable, g.table_id)
            if tbl:
                table_name = tbl.name
        results.append(GuestSearchResult(
            id=g.id,
            first_name=g.first_name,
            last_name=g.last_name,
            phone=g.phone,
            table_name=table_name,
            seat_number=g.seat_number,
            admitted=g.admitted,
            admitted_at=g.admitted_at,
            is_vip=g.is_vip,
        ))
    return results


# ── Manual check-in: admit guest by ID ────────────────────────────────────────

@router.post("/{event_id}/guests/{guest_id}/manual-checkin", response_model=ScanResult)
async def manual_checkin(
    event_id: str,
    guest_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_official),
):
    """Admit a guest without scanning their QR code.
    Requires manual_checkin_enabled on the event (super admin toggle).
    """
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    if not event.manual_checkin_enabled and not event.walk_in_enabled:
        raise HTTPException(403, "Manual check-in is not enabled for this event")

    if event.status != "active":
        label = "has not started yet" if event.status == "draft" else "has ended"
        return ScanResult(status="not_active", message=f"'{event.name}' {label}. Check-in is disabled.")

    if current_user.role == "official":
        assigned = await db.scalar(
            select(EventUser).where(EventUser.event_id == event_id, EventUser.user_id == current_user.id)
        )
        if not assigned:
            raise HTTPException(403, "You are not assigned to this event")

    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")

    if guest.admitted:
        from app.timeutil import local_hhmm
        admitted_time = local_hhmm(guest.admitted_at) or "unknown"
        table_name = None
        if guest.table_id:
            tbl = await db.get(SeatingTable, guest.table_id)
            if tbl:
                table_name = tbl.name
        return ScanResult(
            status="already_admitted",
            message=f"{guest.first_name} {guest.last_name} was already admitted at {admitted_time}.",
            guest=GuestOut.model_validate(guest),
            table_name=table_name,
            seat_number=guest.seat_number,
        )

    # For walk-in guests with no group yet, auto-assign to the event's walk-in table group.
    if event.walk_in_enabled and event.walk_in_table_group_id and not guest.table_group_id and not guest.table_id:
        guest.table_group_id = event.walk_in_table_group_id

    # Seat assignment — same logic as QR scan.
    if event.seating_enabled:
        from .seating import assign_next_seat
        if not guest.table_id:
            seat_error = await assign_next_seat(guest, db)
            if seat_error:
                return ScanResult(status="no_seat_available", message=seat_error)
        elif not guest.seat_number:
            await assign_next_seat(guest, db)

    table_name = None
    if guest.table_id:
        tbl = await db.get(SeatingTable, guest.table_id)
        if tbl:
            table_name = tbl.name

    guest.admitted = True
    guest.admitted_at = datetime.utcnow()
    guest.admit_notified = True
    await db.commit()
    await db.refresh(guest)

    # Notifications + broadcast — same as QR scan.
    from .scanner import _dispatch_admission_message
    await _dispatch_admission_message(background_tasks, event, guest, table_name, db)

    from . import broadcast
    broadcast(event_id, {
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
