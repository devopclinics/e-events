import csv
import io
import re
import uuid
import httpx
from datetime import datetime
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Response, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Event, Guest, TicketType, GuestTag, GuestTagLink, User
from ..schemas import GuestOut, GuestCreate
from ..auth import require_event_admin
from ..entitlements import assert_within_guest_cap, guest_limit, can_use_paid_channels, take_message_credit
from services.qr_service import generate_qr_bytes
from services.email_service import send_invite_email, send_manual_invite_email
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


def _google_sheets_xlsx_url(url: str) -> str | None:
    """Whole-workbook xlsx export URL for a Google Sheets share URL.

    Unlike format=csv, this also works for .xlsx files that were uploaded to
    Drive but never converted to a native Google Sheet (their share links carry
    rtpof=true). For those, format=csv returns HTTP 400, so this is the fallback.
    """
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
    if not m:
        return None
    return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=xlsx"


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
            # Uploaded-but-unconverted .xlsx files (share links carry rtpof=true)
            # reject format=csv with HTTP 400. Retry as whole-workbook xlsx, which
            # the _decode_csv_bytes pipeline handles transparently.
            if resp.status_code == 400 and google_url:
                xlsx_url = _google_sheets_xlsx_url(url)
                if xlsx_url:
                    resp = await client.get(xlsx_url)
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


# Guest shipping-address columns (logistics add-on) — template and import
# must agree on these names since they map 1:1 onto Guest attributes.
_SHIP_COLS = ("ship_address1", "ship_address2", "ship_city", "ship_state",
              "ship_postal", "ship_country")


def _template_columns(event: Event) -> list[str]:
    """Importable columns for this event, driven by its enabled add-ons.
    Must stay in lockstep with what _process_csv understands."""
    cols = ["first_name", "last_name", "email", "phone"]
    if event.venue_access_enabled:
        cols.append("ticket_type")
        cols.append("tags")
    if event.logistics_enabled:
        cols.extend(_SHIP_COLS)
    return cols


# Sample row values. The example.com email doubles as the marker _process_csv
# uses to skip the row if the client forgets to delete it.
_TEMPLATE_SAMPLE = {
    "first_name": "Jane", "last_name": "Doe",
    "email": "jane@example.com", "phone": "+18325550100",
    "tags": "VIP; Press",
    "ship_address1": "123 Main St", "ship_address2": "Apt 4B",
    "ship_city": "Houston", "ship_state": "TX",
    "ship_postal": "77002", "ship_country": "USA",
}


def _norm_header(h: str) -> str:
    """Normalize a CSV header: 'First Name', 'FIRST_NAME', 'first-name' →
    'first_name'. Lets clients use their own list without renaming columns."""
    return re.sub(r"[\s\-]+", "_", (h or "").strip().lower())


async def _process_csv(text: str, event_id: str, db: AsyncSession):
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    reader = csv.DictReader(io.StringIO(text))
    fields = {_norm_header(f) for f in (reader.fieldnames or [])}
    missing = {'first_name', 'last_name'} - fields
    if missing:
        raise HTTPException(
            400,
            f"CSV is missing required columns: {', '.join(sorted(missing))}. "
            "Expected header: first_name,last_name,email,phone "
            "(case/spacing doesn't matter; email is optional)"
        )

    # Add-on columns (matching the downloadable template) are honored only when
    # the event has the feature enabled — extra columns are otherwise ignored.
    event = await db.get(Event, event_id)
    want_ticket = bool(event and event.venue_access_enabled) and "ticket_type" in fields
    want_shipping = bool(event and event.logistics_enabled) and "ship_address1" in fields
    want_tags = bool(event and event.venue_access_enabled) and "tags" in fields
    tt_by_name: dict[str, str] = {}
    if want_ticket:
        tts = (await db.execute(
            select(TicketType).where(TicketType.event_id == event_id)
        )).scalars().all()
        tt_by_name = {t.name.strip().lower(): t.id for t in tts}

    # Tag-based classification: resolve names to ids (auto-creating new tags),
    # and track existing links so re-imports don't duplicate.
    tag_id_by_name: dict[str, str] = {}            # existing tags → real id
    new_tag_by_name: dict[str, "GuestTag"] = {}    # created this run (id after flush)
    existing_links: set[tuple[str, str]] = set()
    pending_tags: list[tuple["Guest", list[str]]] = []   # (guest_obj, [name_key])
    tags_assigned = tags_created = 0
    if want_tags:
        for t in (await db.execute(select(GuestTag).where(GuestTag.event_id == event_id))).scalars():
            tag_id_by_name[t.name.strip().lower()] = t.id
        existing_links = set((await db.execute(
            select(GuestTagLink.guest_id, GuestTagLink.tag_id)
            .join(GuestTag, GuestTag.id == GuestTagLink.tag_id)
            .where(GuestTag.event_id == event_id))).all())

    def _resolve_tag_keys(cell: str) -> list[str]:
        """Return normalized tag name-keys for a row, auto-creating new tags
        (ids assigned at the later flush)."""
        nonlocal tags_created
        keys: list[str] = []
        for raw in re.split(r"[;,]", cell or ""):
            nm = raw.strip()
            if not nm:
                continue
            key = nm.lower()
            if key not in tag_id_by_name and key not in new_tag_by_name:
                tag = GuestTag(event_id=event_id, name=nm)
                db.add(tag)
                new_tag_by_name[key] = tag
                tags_created += 1
            if key not in keys:
                keys.append(key)
        return keys

    # Plan cap: bulk import must respect the same limit as single-add/RSVP.
    cap = guest_limit(event) if event else None
    current_count = 0
    if cap is not None:
        current_count = await db.scalar(
            select(func.count(Guest.id)).where(Guest.event_id == event_id)
        ) or 0

    added = skipped = invalid_phones = backfilled_phones = 0
    tickets_assigned = addresses_added = sample_rows = over_cap = 0
    unknown_tickets: set[str] = set()
    for raw_row in reader:
        row = {_norm_header(k): (v or "") for k, v in raw_row.items() if k is not None}
        email = row.get("email", "").strip().lower()
        first = row.get("first_name", "").strip()
        last = row.get("last_name", "").strip()
        if not first and not last:
            skipped += 1
            continue
        # The sample row shipped in the template uses a reserved example.com
        # address — skip it so an undeleted sample never becomes a guest.
        if email.endswith("@example.com"):
            sample_rows += 1
            continue

        phone_raw = row.get("phone", "").strip()
        normalized_phone: str | None = None
        if phone_raw:
            normalized_phone = _normalize_phone(phone_raw)
            if normalized_phone is None:
                invalid_phones += 1

        ticket_type_id: str | None = None
        if want_ticket:
            tt_name = (row.get("ticket_type") or "").strip()
            if tt_name:
                ticket_type_id = tt_by_name.get(tt_name.lower())
                if ticket_type_id is None:
                    unknown_tickets.add(tt_name)

        ship: dict[str, str | None] = {}
        if want_shipping and (row.get("ship_address1") or "").strip():
            ship = {c: (row.get(c) or "").strip() or None for c in _SHIP_COLS}

        row_tag_keys = _resolve_tag_keys(row.get("tags", "")) if want_tags else []

        # Deduplicate on (first_name + last_name + email) — same person twice.
        # Email-less rows (lists of names/phones) dedupe on name among guests
        # with no email, preferring a phone match so two same-named guests with
        # different numbers stay distinct.
        if email:
            existing = (await db.execute(
                select(Guest).where(
                    Guest.event_id == event_id,
                    Guest.email == email,
                    Guest.first_name == first,
                    Guest.last_name == last,
                )
            )).scalar_one_or_none()
        else:
            candidates = (await db.execute(
                select(Guest).where(
                    Guest.event_id == event_id,
                    Guest.email.is_(None),
                    Guest.first_name == first,
                    Guest.last_name == last,
                )
            )).scalars().all()
            existing = (
                next((c for c in candidates if normalized_phone and c.phone == normalized_phone), None)
                or next((c for c in candidates if not c.phone or not normalized_phone), None)
            )
        if existing:
            # Backfill missing fields on re-import — useful when the source spreadsheet
            # now has a phone number that was blank/invalid on the first import.
            if not existing.phone and normalized_phone:
                existing.phone = normalized_phone
                backfilled_phones += 1
            if ticket_type_id and not existing.ticket_type_id:
                existing.ticket_type_id = ticket_type_id
                tickets_assigned += 1
            if ship and not existing.ship_address1:
                for c in _SHIP_COLS:
                    setattr(existing, c, ship[c])
                addresses_added += 1
            if row_tag_keys:
                pending_tags.append((existing, row_tag_keys))
            skipped += 1
            continue

        if cap is not None and current_count >= cap:
            over_cap += 1
            continue
        g = Guest(
            event_id=event_id,
            first_name=first,
            last_name=last,
            email=email or None,
            phone=normalized_phone,
            ticket_type_id=ticket_type_id,
            **ship,
        )
        db.add(g)
        added += 1
        current_count += 1
        if ticket_type_id:
            tickets_assigned += 1
        if ship:
            addresses_added += 1
        if row_tag_keys:
            pending_tags.append((g, row_tag_keys))

    # Insert guests + any new tags first (assigns their ids), then the
    # guest↔tag links (FK-safe, deduped against pre-existing links).
    if want_tags:
        await db.flush()
        for guest, keys in pending_tags:
            for key in keys:
                tid = tag_id_by_name.get(key) or new_tag_by_name[key].id
                if (guest.id, tid) not in existing_links:
                    db.add(GuestTagLink(guest_id=guest.id, tag_id=tid))
                    existing_links.add((guest.id, tid))
                    tags_assigned += 1

    await db.commit()
    result = {"added": added, "skipped": skipped}
    if backfilled_phones:
        result["backfilled_phones"] = backfilled_phones
    if invalid_phones:
        result["invalid_phones"] = invalid_phones
        result["phone_note"] = "Phones with invalid format were cleared (must be E.164 e.g. +447911123456)"
    if tickets_assigned:
        result["ticket_types_assigned"] = tickets_assigned
    if addresses_added:
        result["addresses_added"] = addresses_added
    if tags_assigned:
        result["tags_assigned"] = tags_assigned
    if tags_created:
        result["tags_created"] = tags_created
    if unknown_tickets:
        result["unknown_ticket_types"] = sorted(unknown_tickets)
        result["ticket_note"] = (
            "Unknown ticket types were ignored — create them in the Access tab "
            "(or download a fresh template), then re-import to assign."
        )
    if sample_rows:
        result["sample_rows_skipped"] = sample_rows
    if over_cap:
        result["over_cap"] = over_cap
        result["cap_note"] = (
            f"This event's plan allows up to {cap} guests — {over_cap} row(s) "
            "were not imported. Upgrade with an Event Pass to add more."
        )
    return result


def import_warning_summary(result: dict) -> str | None:
    """One-line human-readable warnings from a _process_csv result — shown in
    the sync-status UI so background sheet syncs don't swallow problems."""
    parts = []
    if result.get("over_cap"):
        parts.append(result["cap_note"])
    if result.get("unknown_ticket_types"):
        parts.append("Unknown ticket types ignored: " + ", ".join(result["unknown_ticket_types"]))
    if result.get("invalid_phones"):
        parts.append(f"{result['invalid_phones']} phone(s) had an invalid format and were left blank")
    return " · ".join(parts) or None


@router.get("/{event_id}/guests/template")
async def download_guest_template(event_id: str, fmt: str = "xlsx", db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    """Downloadable guest-list template. Columns reflect the event's enabled
    add-ons (ticket_type for venue access, ship_* for logistics), so what the
    client fills in is exactly what upload / URL import / live sync ingest."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if fmt not in ("csv", "xlsx"):
        raise HTTPException(400, "fmt must be csv or xlsx")

    cols = _template_columns(event)
    tt_names: list[str] = []
    if event.venue_access_enabled:
        tt_names = list((await db.execute(
            select(TicketType.name).where(TicketType.event_id == event_id)
            .order_by(TicketType.sort_order, TicketType.name)
        )).scalars())
    sample = {**_TEMPLATE_SAMPLE, "ticket_type": tt_names[0] if tt_names else ""}
    sample_row = [sample.get(c, "") for c in cols]

    if fmt == "csv":
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(cols)
        writer.writerow(sample_row)
        return Response(
            out.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="guest-template.csv"'},
        )

    import openpyxl
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Guests"
    ws.append(cols)
    for i, col in enumerate(cols, 1):
        cell = ws.cell(row=1, column=i)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0F766E")
        ws.column_dimensions[get_column_letter(i)].width = max(len(col) + 4, 16)
    ws.append(sample_row)
    for i in range(1, len(cols) + 1):
        ws.cell(row=2, column=i).font = Font(italic=True, color="94A3B8")
    ws.freeze_panes = "A2"

    if tt_names and "ticket_type" in cols:
        # Names live on a hidden sheet and the dropdown references the range —
        # unlike an inline list, this survives commas in names and any length.
        ref = wb.create_sheet("TicketTypes")
        for name in tt_names:
            ref.append([name])
        ref.sheet_state = "hidden"
        dv = DataValidation(
            type="list", formula1=f"=TicketTypes!$A$1:$A${len(tt_names)}", allow_blank=True,
        )
        dv.error = "Pick one of the event's ticket types"
        dv.prompt = "Ticket types: " + ", ".join(tt_names)
        ws.add_data_validation(dv)
        letter = get_column_letter(cols.index("ticket_type") + 1)
        dv.add(f"{letter}2:{letter}1001")

    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="guest-template.xlsx"'},
    )


@router.post("/{event_id}/guests/upload")
async def upload_guests(event_id: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    raw = await file.read()
    text = _decode_csv_bytes(raw, file.filename or "")
    return await _process_csv(text, event_id, db)


def _dispatch_invite(background_tasks: BackgroundTasks, event: Event, guest: Guest) -> None:
    """Fan out an invite across enabled channels for this event. Channel modules
    no-op silently when contact info is missing or creds aren't configured.

    In closed (invitation-only) mode we send the guest their personal RSVP link
    (/r/{invite_token}) rather than a ticket — the ticket QR is issued only after
    they confirm. In open mode we send the ticket directly, as before."""
    if event.invite_mode == "closed":
        _dispatch_rsvp_invite(background_tasks, event, guest)
        return

    ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}"
    paid_channels = can_use_paid_channels(event)

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

    if paid_channels and event.notify_sms and guest.phone and guest.sms_consent and take_message_credit(event):
        background_tasks.add_task(
            messaging.send_invite_sms,
            phone=guest.phone, first_name=guest.first_name,
            event_name=event.name, ticket_url=ticket_url, event_date=event.event_date,
        )

    if paid_channels and event.notify_whatsapp and guest.phone and guest.whatsapp_consent and take_message_credit(event):
        background_tasks.add_task(
            messaging.send_invite_whatsapp,
            phone=guest.phone, first_name=guest.first_name,
            event_name=event.name, ticket_url=ticket_url, event_date=event.event_date,
        )


def _dispatch_rsvp_invite(background_tasks: BackgroundTasks, event: Event, guest: Guest) -> None:
    """Closed-mode invite: send the guest their personal RSVP link. Generates a
    one-per-guest invite_token on first send (mutation persisted by the caller's
    commit). No ticket/QR yet — that's issued when they confirm."""
    if not guest.invite_token:
        guest.invite_token = str(uuid.uuid4())
    invite_url = f"{event.checkin_base_url.rstrip('/')}/r/{guest.invite_token}"
    name = f"{guest.first_name} {guest.last_name}".strip() or "Guest"
    paid_channels = can_use_paid_channels(event)

    if event.notify_email and guest.email:
        background_tasks.add_task(
            send_manual_invite_email,
            name=name, email=guest.email, invite_url=invite_url,
            event_name=event.name, event_date=event.event_date,
            invite_message=event.invite_message,
        )

    if paid_channels and event.notify_sms and guest.phone and guest.sms_consent and take_message_credit(event):
        background_tasks.add_task(
            messaging.send_manual_invite_sms,
            phone=guest.phone, name=name,
            event_name=event.name, invite_url=invite_url,
        )

    if paid_channels and event.notify_whatsapp and guest.phone and guest.whatsapp_consent and take_message_credit(event):
        background_tasks.add_task(
            messaging.send_manual_invite_whatsapp,
            phone=guest.phone, name=name,
            event_name=event.name, invite_url=invite_url,
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
    _: User = Depends(require_event_admin),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(400, "url is required")

    return await import_from_source_url(url, event_id, db)


@router.post("/{event_id}/guests", response_model=GuestOut, status_code=201)
async def add_guest(event_id: str, data: GuestCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
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

    count = await db.scalar(select(func.count()).where(Guest.event_id == event_id)) or 0
    assert_within_guest_cap(event, count)

    guest = Guest(event_id=event_id, first_name=first, last_name=last, email=email, phone=phone, is_vip=bool(data.is_vip))
    db.add(guest)
    await db.commit()
    await db.refresh(guest)
    return guest


@router.get("/{event_id}/guests", response_model=list[GuestOut])
async def list_guests(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    result = await db.execute(
        select(Guest).where(Guest.event_id == event_id).order_by(Guest.last_name, Guest.first_name)
    )
    return result.scalars().all()


@router.delete("/{event_id}/guests/{guest_id}", status_code=204)
async def delete_guest(event_id: str, guest_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    await db.delete(guest)
    await db.commit()


@router.post("/{event_id}/guests/generate-qr")
async def generate_qr_codes(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
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
async def send_invites(event_id: str, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
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
    _: User = Depends(require_event_admin),
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
async def resend_invite(event_id: str, guest_id: str, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    # Open mode emails a ticket (needs a QR); closed mode emails an RSVP link (no QR yet).
    if event.invite_mode != "closed" and not guest.qr_generated_at:
        raise HTTPException(400, "Generate QR codes first before sending invites")

    _dispatch_invite(background_tasks, event, guest)
    guest.invite_sent_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.post("/{event_id}/guests/{guest_id}/approve")
async def approve_rsvp(event_id: str, guest_id: str, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    """Approve a pending self-registered RSVP: confirm the guest, issue their QR,
    and send the ticket. No-op-safe if the guest is already confirmed."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")

    now = datetime.utcnow()
    guest.rsvp_status = "confirmed"
    if not guest.qr_generated_at:
        guest.qr_generated_at = now
    guest.invite_sent_at = now
    _dispatch_invite(background_tasks, event, guest)
    await db.commit()
    return {"ok": True, "rsvp_status": "confirmed"}


@router.post("/{event_id}/guests/{guest_id}/reject")
async def reject_rsvp(event_id: str, guest_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    """Reject a pending RSVP — marks the guest declined (no ticket). Keeps the
    record so the planner has a history; use delete to remove entirely."""
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    guest.rsvp_status = "declined"
    guest.rsvp_responded_at = datetime.utcnow()
    await db.commit()
    return {"ok": True, "rsvp_status": "declined"}


@router.post("/{event_id}/guests/{guest_id}/invite-token")
async def ensure_invite_token(event_id: str, guest_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_event_admin)):
    """Mint (or return) a guest's personal RSVP-link token so the planner can
    copy /r/{token} from the dashboard without having to send the invite first."""
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    if not guest.invite_token:
        guest.invite_token = str(uuid.uuid4())
        await db.commit()
        await db.refresh(guest)
    event = await db.get(Event, event_id)
    return {
        "invite_token": guest.invite_token,
        "invite_url": f"{event.checkin_base_url.rstrip('/')}/r/{guest.invite_token}",
    }


@router.get("/{event_id}/guests/{guest_id}/qr.png")
async def get_guest_qr(event_id: str, guest_id: str, db: AsyncSession = Depends(get_db)):
    guest = await db.get(Guest, guest_id)
    if not guest or guest.event_id != event_id:
        raise HTTPException(404, "Guest not found")
    event = await db.get(Event, event_id)
    qr_bytes = generate_qr_bytes(guest.qr_token, event.checkin_base_url)
    return Response(content=qr_bytes, media_type="image/png")
