"""Event Calendars (Gatsby-parity feature): curated, cross-event public/
private listing pages, plus the org-level Contact/ContactList audience model
that private calendars need (Guest, elsewhere in this app, only exists inside
one event — there's no other cross-event contact concept to reuse).

Two routers in this file:
  - `router` — admin CRUD (contact lists, calendars, curation, logo, send),
    mounted at /api/organizations/me, gated to org owner/admin.
  - `public_router` — the public page's single resolve endpoint, mounted at
    /api/calendars, no auth. Registering for an event from a calendar sends
    the visitor to that event's own existing RSVP page — nothing here
    duplicates RSVP questions, meal selection, capacity checks, or the
    confirmation email; this file only curates *which* events are listed and
    who's allowed to see them.
"""
import csv
import io
import uuid
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import case, delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    Calendar, CalendarAccess, CalendarContactList, CalendarEvent, Contact, ContactList,
    ContactListMember, Event, Guest, Membership, Organization, User,
)
from .admin import DEFAULT_ORG_ID
from .guests import _decode_csv_bytes, _norm_header
from ..schemas import (
    CalendarContactListsUpdate, CalendarCreate, CalendarEventReorder, CalendarOut, CalendarUpdate,
    ContactCreate, ContactListCreate, ContactListOut, ContactOut, ContactPaste,
    PublicCalendarContactOut, PublicCalendarEventOut, PublicCalendarOut,
)
from ..auth import get_current_user
from ..config import settings
from .. import storage
from services.email_service import send_simple_email

router = APIRouter()
public_router = APIRouter()

ALLOWED_LOGO_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_LOGO_SIZE = 10 * 1024 * 1024  # 10 MB, same cap as the event cover-image upload


async def _managed_org(user: User, db: AsyncSession) -> Organization:
    """The org this user owns or admins — same bar as event management
    (events.py's Membership.role.in_(["owner", "admin"]) checks), unlike
    API keys/webhooks/subscription's owner-only _owned_org.

    Prefers a real, deliberately-created org over the legacy shared
    DEFAULT_ORG_ID ("vsgs") — see api_keys.py's _owned_org docstring for the
    full explanation; same bug, same fix, here for admins too."""
    org_id = await db.scalar(
        select(Membership.org_id)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == user.id, Membership.role.in_(["owner", "admin"]))
        .order_by(case((Organization.id == DEFAULT_ORG_ID, 1), else_=0), Organization.created_at.asc())
        .limit(1)
    )
    org = await db.get(Organization, org_id) if org_id else None
    if not org:
        raise HTTPException(403, "You must be an org owner or admin to manage calendars")
    return org


# ── Contact lists ─────────────────────────────────────────────────────────────

async def _contact_list_out(cl: ContactList, db: AsyncSession) -> ContactListOut:
    count = await db.scalar(select(func.count()).where(ContactListMember.contact_list_id == cl.id)) or 0
    return ContactListOut(id=cl.id, name=cl.name, contact_count=count, created_at=cl.created_at)


@router.get("/contact-lists", response_model=list[ContactListOut])
async def list_contact_lists(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    rows = (await db.execute(
        select(ContactList).where(ContactList.org_id == org.id).order_by(ContactList.created_at.desc())
    )).scalars().all()
    return [await _contact_list_out(cl, db) for cl in rows]


@router.post("/contact-lists", response_model=ContactListOut, status_code=201)
async def create_contact_list(data: ContactListCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    cl = ContactList(org_id=org.id, name=name)
    db.add(cl)
    await db.commit()
    await db.refresh(cl)
    return await _contact_list_out(cl, db)


@router.delete("/contact-lists/{list_id}", status_code=204)
async def delete_contact_list(list_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cl = await db.get(ContactList, list_id)
    if not cl or cl.org_id != org.id:
        raise HTTPException(404, "Contact list not found")
    # Deliberately does NOT revoke already-minted CalendarAccess tokens for
    # this list's contacts — same "links don't expire on their own" model as
    # Guest.invite_token elsewhere in this app.
    await db.execute(sa_delete(ContactListMember).where(ContactListMember.contact_list_id == list_id))
    await db.execute(sa_delete(CalendarContactList).where(CalendarContactList.contact_list_id == list_id))
    await db.delete(cl)
    await db.commit()


# ── Contacts ──────────────────────────────────────────────────────────────────

async def _get_or_create_contact(org_id: str, first_name: str, last_name: str | None, email: str, db: AsyncSession) -> Contact:
    email = email.strip().lower()
    existing = await db.scalar(select(Contact).where(Contact.org_id == org_id, Contact.email == email))
    if existing:
        return existing
    contact = Contact(org_id=org_id, first_name=first_name.strip(), last_name=(last_name or "").strip() or None, email=email)
    db.add(contact)
    await db.flush()
    return contact


async def _link_contact_to_list(list_id: str, contact_id: str, db: AsyncSession) -> None:
    existing = await db.scalar(select(ContactListMember).where(
        ContactListMember.contact_list_id == list_id, ContactListMember.contact_id == contact_id
    ))
    if not existing:
        db.add(ContactListMember(contact_list_id=list_id, contact_id=contact_id))


async def _backfill_access_for_new_member(list_id: str, contact_id: str, db: AsyncSession) -> None:
    """If this list is already attached to any calendar, mint that
    calendar's personalized link for this contact too — matches Gatsby's
    "adding a contact to a linked list gives them a calendar link" behavior."""
    calendar_ids = (await db.execute(
        select(CalendarContactList.calendar_id).where(CalendarContactList.contact_list_id == list_id)
    )).scalars().all()
    for calendar_id in calendar_ids:
        existing = await db.scalar(select(CalendarAccess).where(
            CalendarAccess.calendar_id == calendar_id, CalendarAccess.contact_id == contact_id
        ))
        if not existing:
            db.add(CalendarAccess(calendar_id=calendar_id, contact_id=contact_id))


@router.get("/contact-lists/{list_id}/contacts", response_model=list[ContactOut])
async def list_contacts(list_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cl = await db.get(ContactList, list_id)
    if not cl or cl.org_id != org.id:
        raise HTTPException(404, "Contact list not found")
    rows = (await db.execute(
        select(Contact).join(ContactListMember, ContactListMember.contact_id == Contact.id)
        .where(ContactListMember.contact_list_id == list_id).order_by(Contact.first_name)
    )).scalars().all()
    return rows


@router.post("/contact-lists/{list_id}/contacts", response_model=ContactOut, status_code=201)
async def add_contact(list_id: str, data: ContactCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cl = await db.get(ContactList, list_id)
    if not cl or cl.org_id != org.id:
        raise HTTPException(404, "Contact list not found")
    first_name = data.first_name.strip()
    if not first_name:
        raise HTTPException(400, "first_name is required")
    contact = await _get_or_create_contact(org.id, first_name, data.last_name, data.email, db)
    await _link_contact_to_list(list_id, contact.id, db)
    await _backfill_access_for_new_member(list_id, contact.id, db)
    await db.commit()
    await db.refresh(contact)
    return contact


@router.post("/contact-lists/{list_id}/contacts/paste", response_model=list[ContactOut], status_code=201)
async def paste_contacts(list_id: str, data: ContactPaste, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Bulk add: one 'Name, email@x.com' per line — the fast path for a
    handful of contacts. See import_contacts_csv below for spreadsheet
    uploads with proper column headers."""
    org = await _managed_org(user, db)
    cl = await db.get(ContactList, list_id)
    if not cl or cl.org_id != org.id:
        raise HTTPException(404, "Contact list not found")
    added = []
    for line in data.text.splitlines():
        line = line.strip()
        if not line or "," not in line:
            continue
        name_part, email_part = line.rsplit(",", 1)
        name_part, email_part = name_part.strip(), email_part.strip().lower()
        if "@" not in email_part:
            continue
        parts = name_part.split(None, 1)
        first_name = parts[0] if parts else email_part.split("@")[0]
        last_name = parts[1] if len(parts) > 1 else None
        contact = await _get_or_create_contact(org.id, first_name, last_name, email_part, db)
        await _link_contact_to_list(list_id, contact.id, db)
        await _backfill_access_for_new_member(list_id, contact.id, db)
        added.append(contact)
    await db.commit()
    for c in added:
        await db.refresh(c)
    return added


@router.post("/contact-lists/{list_id}/contacts/csv", response_model=list[ContactOut], status_code=201)
async def import_contacts_csv(
    list_id: str, file: UploadFile = File(...),
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Real spreadsheet import — CSV or .xlsx, flexible header names (reuses
    guests.py's _decode_csv_bytes/_norm_header, the same machinery the guest
    importer uses for xlsx-to-csv conversion and 'First Name'/'first_name'/
    'first-name' header normalization). Requires an `email` column;
    `first_name`/`last_name` are recognized but optional."""
    org = await _managed_org(user, db)
    cl = await db.get(ContactList, list_id)
    if not cl or cl.org_id != org.id:
        raise HTTPException(404, "Contact list not found")

    raw = await file.read()
    text = _decode_csv_bytes(raw, file.filename or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    reader = csv.DictReader(io.StringIO(text))
    headers = {_norm_header(f) for f in (reader.fieldnames or [])}
    if "email" not in headers:
        raise HTTPException(400, "CSV must have an 'email' column (first_name and last_name are also recognized).")

    added = []
    for row in reader:
        normalized = {_norm_header(k): (v or "").strip() for k, v in row.items() if k}
        email = normalized.get("email", "").strip().lower()
        if not email or "@" not in email:
            continue
        first_name = normalized.get("first_name") or email.split("@")[0]
        last_name = normalized.get("last_name") or None
        contact = await _get_or_create_contact(org.id, first_name, last_name, email, db)
        await _link_contact_to_list(list_id, contact.id, db)
        await _backfill_access_for_new_member(list_id, contact.id, db)
        added.append(contact)
    await db.commit()
    for c in added:
        await db.refresh(c)
    return added


@router.delete("/contact-lists/{list_id}/contacts/{contact_id}", status_code=204)
async def remove_contact(list_id: str, contact_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cl = await db.get(ContactList, list_id)
    if not cl or cl.org_id != org.id:
        raise HTTPException(404, "Contact list not found")
    await db.execute(sa_delete(ContactListMember).where(
        ContactListMember.contact_list_id == list_id, ContactListMember.contact_id == contact_id
    ))
    await db.commit()


# ── Calendars ─────────────────────────────────────────────────────────────────

async def _calendar_out(cal: Calendar, db: AsyncSession) -> CalendarOut:
    rows = (await db.execute(
        select(CalendarEvent.event_id, CalendarEvent.click_count)
        .where(CalendarEvent.calendar_id == cal.id).order_by(CalendarEvent.sort_order)
    )).all()
    list_ids = (await db.execute(
        select(CalendarContactList.contact_list_id).where(CalendarContactList.calendar_id == cal.id)
    )).scalars().all()
    return CalendarOut(
        id=cal.id, title=cal.title, description=cal.description, logo_url=cal.logo_url, logo_width=cal.logo_width,
        visibility=cal.visibility, hide_past_events=cal.hide_past_events, share_token=cal.share_token,
        event_ids=[eid for eid, _ in rows], event_click_counts={eid: count for eid, count in rows},
        contact_list_ids=list(list_ids), view_count=cal.view_count,
        created_at=cal.created_at, updated_at=cal.updated_at,
    )


async def _get_org_calendar(calendar_id: str, org: Organization, db: AsyncSession) -> Calendar:
    cal = await db.get(Calendar, calendar_id)
    if not cal or cal.org_id != org.id:
        raise HTTPException(404, "Calendar not found")
    return cal


@router.get("/calendars", response_model=list[CalendarOut])
async def list_calendars(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    rows = (await db.execute(select(Calendar).where(Calendar.org_id == org.id).order_by(Calendar.created_at.desc()))).scalars().all()
    return [await _calendar_out(c, db) for c in rows]


@router.post("/calendars", response_model=CalendarOut, status_code=201)
async def create_calendar(data: CalendarCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "title is required")
    cal = Calendar(
        org_id=org.id, title=title, description=data.description, visibility=data.visibility,
        hide_past_events=data.hide_past_events,
        share_token=(str(uuid.uuid4()) if data.visibility == "public" else None),
    )
    db.add(cal)
    await db.commit()
    await db.refresh(cal)
    return await _calendar_out(cal, db)


@router.get("/calendars/{calendar_id}", response_model=CalendarOut)
async def get_calendar(calendar_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cal = await _get_org_calendar(calendar_id, org, db)
    return await _calendar_out(cal, db)


@router.put("/calendars/{calendar_id}", response_model=CalendarOut)
async def update_calendar(calendar_id: str, data: CalendarUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cal = await _get_org_calendar(calendar_id, org, db)
    if data.title is not None:
        title = data.title.strip()
        if not title:
            raise HTTPException(400, "title is required")
        cal.title = title
    if data.description is not None:
        cal.description = data.description
    if data.hide_past_events is not None:
        cal.hide_past_events = data.hide_past_events
    if data.logo_width is not None:
        cal.logo_width = data.logo_width
    if data.visibility is not None and data.visibility != cal.visibility:
        cal.visibility = data.visibility
        if data.visibility == "public" and not cal.share_token:
            cal.share_token = str(uuid.uuid4())
        # Switching to private leaves any existing share_token in place but
        # inert — the public resolve endpoint only trusts a share_token match
        # while visibility == "public", so no separate cleanup is needed.
    await db.commit()
    await db.refresh(cal)
    return await _calendar_out(cal, db)


@router.delete("/calendars/{calendar_id}", status_code=204)
async def delete_calendar(calendar_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cal = await _get_org_calendar(calendar_id, org, db)
    if cal.logo_url:
        storage.delete(storage.subpath_from_url(cal.logo_url))
    await db.execute(sa_delete(CalendarEvent).where(CalendarEvent.calendar_id == calendar_id))
    await db.execute(sa_delete(CalendarContactList).where(CalendarContactList.calendar_id == calendar_id))
    await db.execute(sa_delete(CalendarAccess).where(CalendarAccess.calendar_id == calendar_id))
    await db.delete(cal)
    await db.commit()


# ── Curation ──────────────────────────────────────────────────────────────────
# NOTE: /events/reorder must be registered before /events/{event_id} — FastAPI
# matches routes in declaration order, and "reorder" would otherwise be
# captured as an event_id by the more generic path.

@router.post("/calendars/{calendar_id}/events/reorder", response_model=CalendarOut)
async def reorder_calendar_events(calendar_id: str, data: CalendarEventReorder, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cal = await _get_org_calendar(calendar_id, org, db)
    rows = (await db.execute(select(CalendarEvent).where(CalendarEvent.calendar_id == calendar_id))).scalars().all()
    by_event = {r.event_id: r for r in rows}
    if len(data.event_ids) != len(set(data.event_ids)) or set(data.event_ids) != set(by_event.keys()):
        raise HTTPException(400, "Reorder must include each calendar event exactly once")
    for index, eid in enumerate(data.event_ids):
        by_event[eid].sort_order = index
    await db.commit()
    return await _calendar_out(cal, db)


@router.post("/calendars/{calendar_id}/events/{event_id}", response_model=CalendarOut, status_code=201)
async def add_calendar_event(calendar_id: str, event_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cal = await _get_org_calendar(calendar_id, org, db)
    event = await db.get(Event, event_id)
    if not event or event.org_id != org.id:
        raise HTTPException(404, "Event not found")
    existing = await db.scalar(select(CalendarEvent).where(
        CalendarEvent.calendar_id == calendar_id, CalendarEvent.event_id == event_id
    ))
    if not existing:
        count = await db.scalar(select(func.count()).where(CalendarEvent.calendar_id == calendar_id)) or 0
        db.add(CalendarEvent(calendar_id=calendar_id, event_id=event_id, sort_order=count))
        await db.commit()
    return await _calendar_out(cal, db)


@router.delete("/calendars/{calendar_id}/events/{event_id}", response_model=CalendarOut)
async def remove_calendar_event(calendar_id: str, event_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cal = await _get_org_calendar(calendar_id, org, db)
    await db.execute(sa_delete(CalendarEvent).where(
        CalendarEvent.calendar_id == calendar_id, CalendarEvent.event_id == event_id
    ))
    await db.commit()
    return await _calendar_out(cal, db)


# ── Private audience ────────────────────────────────────────────────────────

async def ensure_calendar_access_tokens(calendar_id: str, db: AsyncSession) -> None:
    """Idempotent — creates a CalendarAccess row for any contact in any of
    this calendar's attached lists that doesn't already have one."""
    list_ids = (await db.execute(
        select(CalendarContactList.contact_list_id).where(CalendarContactList.calendar_id == calendar_id)
    )).scalars().all()
    if not list_ids:
        return
    contact_ids = (await db.execute(
        select(ContactListMember.contact_id).where(ContactListMember.contact_list_id.in_(list_ids)).distinct()
    )).scalars().all()
    if not contact_ids:
        return
    existing = set((await db.execute(
        select(CalendarAccess.contact_id).where(
            CalendarAccess.calendar_id == calendar_id, CalendarAccess.contact_id.in_(contact_ids)
        )
    )).scalars().all())
    for cid in contact_ids:
        if cid not in existing:
            db.add(CalendarAccess(calendar_id=calendar_id, contact_id=cid))


@router.put("/calendars/{calendar_id}/contact-lists", response_model=CalendarOut)
async def set_calendar_contact_lists(calendar_id: str, data: CalendarContactListsUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cal = await _get_org_calendar(calendar_id, org, db)
    for lid in data.contact_list_ids:
        cl = await db.get(ContactList, lid)
        if not cl or cl.org_id != org.id:
            raise HTTPException(404, f"Contact list {lid} not found")
    await db.execute(sa_delete(CalendarContactList).where(CalendarContactList.calendar_id == calendar_id))
    for lid in data.contact_list_ids:
        db.add(CalendarContactList(calendar_id=calendar_id, contact_list_id=lid))
    await db.flush()
    await ensure_calendar_access_tokens(calendar_id, db)
    await db.commit()
    return await _calendar_out(cal, db)


# ── Logo upload ───────────────────────────────────────────────────────────────

@router.post("/calendars/{calendar_id}/upload-logo", response_model=CalendarOut)
async def upload_calendar_logo(calendar_id: str, file: UploadFile = File(...), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cal = await _get_org_calendar(calendar_id, org, db)
    if file.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(400, f"Unsupported file type '{file.content_type}'. Use JPEG, PNG, WebP or GIF.")
    data = await file.read()
    if len(data) > MAX_LOGO_SIZE:
        raise HTTPException(413, "Image too large — maximum 10 MB.")
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get(file.content_type, "jpg")
    filename = f"{calendar_id}-logo-{uuid.uuid4().hex[:8]}.{ext}"
    if cal.logo_url:
        storage.delete(storage.subpath_from_url(cal.logo_url))
    cal.logo_url = storage.save(f"calendars/{filename}", data, file.content_type)
    await db.commit()
    await db.refresh(cal)
    return await _calendar_out(cal, db)


@router.delete("/calendars/{calendar_id}/upload-logo", response_model=CalendarOut)
async def delete_calendar_logo(calendar_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _managed_org(user, db)
    cal = await _get_org_calendar(calendar_id, org, db)
    if cal.logo_url:
        storage.delete(storage.subpath_from_url(cal.logo_url))
        cal.logo_url = None
        await db.commit()
        await db.refresh(cal)
    return await _calendar_out(cal, db)


# ── Distribution ──────────────────────────────────────────────────────────────

@router.post("/calendars/{calendar_id}/send")
async def send_calendar_links(calendar_id: str, background_tasks: BackgroundTasks, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Emails every contact across the calendar's linked lists their
    personalized link — one fixed transactional template via the same
    send_simple_email primitive used throughout this app, not a general
    templated campaign tool."""
    org = await _managed_org(user, db)
    cal = await _get_org_calendar(calendar_id, org, db)
    if cal.visibility != "private":
        raise HTTPException(400, "Only private calendars can be sent to contacts")
    await ensure_calendar_access_tokens(calendar_id, db)
    await db.commit()
    rows = (await db.execute(
        select(Contact, CalendarAccess.token)
        .join(CalendarAccess, CalendarAccess.contact_id == Contact.id)
        .where(CalendarAccess.calendar_id == calendar_id)
    )).all()
    base = (settings.public_base_url or settings.frontend_url).rstrip("/")
    queued = 0
    for contact, token in rows:
        link = f"{base}/calendar/{token}"
        body = (
            f"<p>Hi {contact.first_name},</p>"
            f"<p>{cal.title} is now available — see what's coming up and register:</p>"
            + (f"<p>{cal.description}</p>" if cal.description else "")
            + f'<p><a href="{link}">{link}</a></p>'
        )
        background_tasks.add_task(send_simple_email, contact.email, cal.title, body, None, None, None, "calendar_invite")
        queued += 1
    return {"queued": queued}


# ── Public resolution (no auth) ─────────────────────────────────────────────

async def _resolve_token(token: str, db: AsyncSession) -> tuple[Calendar, Contact | None]:
    """Shared lookup for both the page-resolve endpoint and the click-tracking
    redirect below — tries a public calendar's share_token first, then a
    private calendar's per-contact CalendarAccess token."""
    cal = await db.scalar(select(Calendar).where(Calendar.share_token == token, Calendar.visibility == "public"))
    contact: Contact | None = None
    if not cal:
        access = await db.scalar(select(CalendarAccess).where(CalendarAccess.token == token))
        if access:
            candidate = await db.get(Calendar, access.calendar_id)
            if candidate and candidate.visibility == "private":
                cal, contact = candidate, await db.get(Contact, access.contact_id)
    if not cal:
        raise HTTPException(404, "Calendar not found")
    return cal, contact


async def _event_register_url(event: Event, contact: Contact | None, base: str, db: AsyncSession) -> tuple[str, str | None, bool | None]:
    """(register_url, rsvp_status, admitted) for one event on a calendar.
    A contact who's already a Guest on this event gets their own editable
    link + current status; everyone else gets the event's real RSVP page
    (pre-filled with name/email for a known contact who hasn't registered yet)."""
    rsvp_status = admitted = None
    register_url = f"{base}/rsvp/{event.rsvp_token}" if event.rsvp_token else f"{base}/e/{event.id}"
    if contact:
        guest = await db.scalar(select(Guest).where(Guest.event_id == event.id, Guest.email == contact.email))
        if guest:
            rsvp_status, admitted = guest.rsvp_status, guest.admitted
            if guest.invite_token:
                register_url = f"{base}/r/{guest.invite_token}"
        else:
            sep = "&" if "?" in register_url else "?"
            register_url = f"{register_url}{sep}first_name={quote(contact.first_name)}&email={quote(contact.email)}"
    return register_url, rsvp_status, admitted


@public_router.get("/{token}", response_model=PublicCalendarOut)
async def resolve_calendar(token: str, db: AsyncSession = Depends(get_db)):
    """Resolves EITHER a public calendar's share_token or a private
    calendar's per-contact CalendarAccess token — one URL shape for
    visitors regardless of which kind of link they were given."""
    base = (settings.public_base_url or settings.frontend_url).rstrip("/")
    cal, contact = await _resolve_token(token, db)

    cal.view_count += 1
    await db.commit()

    event_rows = (await db.execute(
        select(Event).join(CalendarEvent, CalendarEvent.event_id == Event.id)
        .where(CalendarEvent.calendar_id == cal.id).order_by(CalendarEvent.sort_order)
    )).scalars().all()

    events_out = []
    for event in event_rows:
        if cal.hide_past_events and event.event_date < datetime.utcnow():
            continue
        _dest, rsvp_status, admitted = await _event_register_url(event, contact, base, db)
        # Point at the click-tracking redirect rather than the real
        # destination directly — the redirect increments CalendarEvent's
        # click_count then 302s to the same URL _event_register_url computed.
        register_url = f"{base}/api/calendars/{token}/go/{event.id}"
        events_out.append(PublicCalendarEventOut(
            id=event.id, name=event.name, event_date=event.event_date,
            invite_cover_image=event.invite_cover_image, invite_message=event.invite_message,
            rsvp_status=rsvp_status, admitted=admitted, register_url=register_url,
        ))

    return PublicCalendarOut(
        mode=("private" if contact else "public"), title=cal.title, description=cal.description,
        logo_url=cal.logo_url, logo_width=cal.logo_width,
        contact=(PublicCalendarContactOut(first_name=contact.first_name, email=contact.email) if contact else None),
        events=events_out,
    )


@public_router.get("/{token}/go/{event_id}")
async def click_calendar_event(token: str, event_id: str, db: AsyncSession = Depends(get_db)):
    """Increments this event's click_count on this calendar, then redirects
    to the real destination (RSVP page / personal invite link) — a plain
    <a href> hop, no client-side JS needed to track clicks."""
    base = (settings.public_base_url or settings.frontend_url).rstrip("/")
    cal, contact = await _resolve_token(token, db)
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    calendar_event = await db.scalar(select(CalendarEvent).where(
        CalendarEvent.calendar_id == cal.id, CalendarEvent.event_id == event_id
    ))
    if not calendar_event:
        raise HTTPException(404, "Event not found on this calendar")
    calendar_event.click_count += 1
    await db.commit()
    dest, _status, _admitted = await _event_register_url(event, contact, base, db)
    return RedirectResponse(dest, status_code=302)
