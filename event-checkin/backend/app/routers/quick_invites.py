"""A small invitation workspace over canonical Events and Guests.

No guest is created by drafting, publishing, importing email contacts or sending.
All public edits require the recipient's unguessable reply credential.
"""
import html
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth import get_current_user, require_admin, require_event_admin, require_verified_current_email
from ..config import settings
from ..database import get_db
from ..entitlements import assert_within_guest_cap, EMAIL_FREE_QUOTA
from ..models import Event, Guest, Membership, Organization, QuickInviteRecipient, User, RSVPQuestion
from ..ratelimit import rate_limit
from ..schemas import EventCreate
from .events import create_event

router = APIRouter()
PALETTES = {"mint": ("#123b35", "#e5efe8", "#cbdcbd"), "lavender": ("#25243e", "#f0ecf6", "#cfc2ed"), "rose": ("#5c343c", "#faf0eb", "#edc6bb")}


class InviteDraft(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    event_date: datetime
    timezone: str = Field(max_length=80)
    venue_name: str = Field(default="", max_length=300)
    message: str = Field(default="", max_length=2000)
    style: Literal["editorial", "arch", "minimal"] = "editorial"
    colour: Literal["mint", "lavender", "rose"] = "mint"
    cover: str = Field(default="", max_length=2000)
    envelope: bool = False
    request_id: uuid.UUID

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip() or '\n' in value or '\r' in value:
            raise ValueError("Enter an invitation title on one line")
        return value.strip()

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value):
        try: ZoneInfo(value)
        except Exception: raise ValueError("Choose a valid timezone")
        return value

    @field_validator("cover")
    @classmethod
    def valid_cover(cls, value):
        from urllib.parse import urlparse
        if value and (urlparse(value).scheme != "https" or not urlparse(value).hostname):
            raise ValueError("Cover image must use an HTTPS URL")
        return value


class EmailContact(BaseModel):
    email: EmailStr
    name: str = Field(default="", max_length=200)


class SendInvites(BaseModel):
    recipients: list[EmailContact] = Field(min_length=1, max_length=25)
    confirm: Literal[True]


class Reply(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr | None = None
    response: Literal["going", "maybe", "declined"]
    reply_token: str | None = Field(default=None, max_length=64)
    request_id: uuid.UUID


async def verified_sender(request: Request, user: User = Depends(get_current_user)):
    try:
        return await require_verified_current_email(request=request, user=user)
    except HTTPException as exc:
        if exc.status_code == 403:
            raise HTTPException(403, "Verify your current email address, then sign in again before sending invitations. You can still copy and share your invitation link.")
        raise


def preferences(event):
    return (event.setup_preferences or {}).get("quick_invite") or {}


def public_data(event):
    prefs = preferences(event)
    return {"name": event.name, "event_date": event.event_date.replace(tzinfo=timezone.utc).isoformat(), "timezone": event.timezone,
            "venue_name": event.venue_name or "", "message": event.invite_message or "", "style": prefs.get("style", "editorial"),
            "colour": prefs.get("colour", "mint"), "cover": prefs.get("cover", ""), "envelope": prefs.get("envelope", False)}


async def invitation(token, db, *, lock=False):
    query = select(Event).where(Event.rsvp_token == token)
    event = await db.scalar(query.with_for_update() if lock else query)
    org = await db.get(Organization, event.org_id) if event else None
    if not event or not preferences(event) or not org or not org.is_active:
        raise HTTPException(404, "Invitation not found")
    if event.cancelled or event.status != "active":
        raise HTTPException(410, "This invitation is no longer accepting replies")
    if event.event_date < datetime.utcnow():
        raise HTTPException(410, "Replies closed when this event started")
    if event.attendance_mode == 'rsvp' and (not event.rsvp_enabled or (event.rsvp_deadline and event.rsvp_deadline <= datetime.utcnow())):
        raise HTTPException(410, "The organizer has closed replies for this invitation")
    return event


async def registration_target(event, db, person=None):
    """Once an event grows, its established registration gates stay authoritative."""
    base = (settings.public_base_url or settings.frontend_url).rstrip('/')
    if event.attendance_mode in {'ticketed', 'hybrid'}:
        return f'{base}/tickets/e/{event.id}'
    if event.attendance_mode == 'private':
        raise HTTPException(403, "This event now requires a personal invitation from the organizer.")
    required = await db.scalar(select(RSVPQuestion.id).where(RSVPQuestion.event_id == event.id, RSVPQuestion.is_required.is_(True)).limit(1))
    if event.rsvp_require_approval or event.rsvp_multi_invitee_enabled or event.rsvp_capacity is not None or required or (event.rsvp_collect_email and event.rsvp_email_required) or (event.rsvp_collect_phone and event.rsvp_phone_required):
        if event.invite_mode == 'closed':
            guest = await db.get(Guest, person.guest_id) if person and person.guest_id else None
            if not guest or not guest.invite_token:
                raise HTTPException(403, "The organizer added private registration steps. Please ask them for your latest personal registration link.")
            return f'{base}/r/{guest.invite_token}'
        return f'{base}/rsvp/{event.rsvp_token}'
    return None


async def owned(event_id, user, db, request):
    await require_event_admin(event_id=event_id, user=user, db=db, request=request)
    event = await db.get(Event, event_id)
    if not preferences(event): raise HTTPException(404, "Invitation not found")
    return event


def share_url(event, recipient=None):
    base = (settings.public_base_url or settings.frontend_url).rstrip("/")
    return f"{base}/i/{event.rsvp_token}" + (f"?reply={recipient.token}" if recipient else "")


async def workspace(event, db):
    rows = (await db.scalars(select(QuickInviteRecipient).where(QuickInviteRecipient.event_id == event.id).order_by(QuickInviteRecipient.created_at.desc()))).all()
    guests = (await db.scalars(select(Guest).where(Guest.event_id == event.id))).all()
    by_id = {g.id: g for g in guests}
    by_email = {g.email.lower(): g for g in guests if g.email}
    visible, linked = [], set()
    states = {'confirmed': 'going', 'maybe': 'maybe', 'declined': 'declined', 'pending': 'approval', 'waitlisted': 'waitlisted'}
    for row in rows:
        guest = by_id.get(row.guest_id) or by_email.get((row.email or '').lower())
        if guest: linked.add(guest.id)
        visible.append({'id': row.id, 'name': row.name, 'email': row.email, 'response': states.get(guest.rsvp_status) if guest else row.response,
                        'send_status': row.send_status, 'responded_at': guest.rsvp_responded_at if guest else row.responded_at, 'sent_at': row.sent_at})
    for guest in guests:
        if guest.id not in linked:
            visible.append({'id': 'guest:'+guest.id, 'name': f'{guest.first_name} {guest.last_name}'.strip(), 'email': guest.email,
                            'response': states.get(guest.rsvp_status), 'send_status': 'draft', 'responded_at': guest.rsvp_responded_at, 'sent_at': None})
    return {"id": event.id, "invitation": public_data(event), "url": share_url(event), "status": event.status,
            "email_limit": min(75, EMAIL_FREE_QUOTA), "email_attempts": sum(r.attempts for r in rows),
            "recipients": visible}


@router.post("", status_code=201)
async def create(data: InviteDraft, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    if data.event_date.tzinfo is None:
        raise HTTPException(422, "The event date must include its timezone offset")
    when = data.event_date.astimezone(timezone.utc).replace(tzinfo=None)
    if when <= datetime.utcnow(): raise HTTPException(422, "Choose a future event date")
    # Lock the same organization used by standard event creation. A retry of
    # this request returns its existing event rather than consuming another slot.
    org_id = await db.scalar(select(Membership.org_id).where(Membership.user_id == user.id, Membership.role.in_(["owner", "admin"])).order_by(Membership.created_at).limit(1))
    if not org_id: raise HTTPException(403, "An organizer account is required")
    await db.scalar(select(Organization).where(Organization.id == org_id).with_for_update())
    events = (await db.scalars(select(Event).where(Event.org_id == org_id))).all()
    existing = next((e for e in events if preferences(e).get("request_id") == str(data.request_id)), None)
    if existing: return await workspace(existing, db)
    prefs = {"quick_invite": {"style": data.style, "colour": data.colour, "cover": data.cover, "envelope": data.envelope, "request_id": str(data.request_id)}}
    result = await create_event(EventCreate(name=data.name, event_date=data.event_date, timezone=data.timezone,
                    venue_name=data.venue_name, description=data.message, setup_preferences=prefs,
                    checkin_base_url=settings.public_base_url or settings.frontend_url, notify_sms=False, notify_whatsapp=False),
                    background_tasks=background_tasks, db=db, current_user=user)
    event = await db.get(Event, result.id)
    event.status = "active"
    event.rsvp_enabled = True
    event.invite_mode = "open"
    event.invite_message = data.message
    event.description = data.message
    event.invite_cover_image = data.cover or None
    event.rsvp_collect_phone = False
    event.rsvp_phone_required = False
    event.rsvp_email_required = False
    event.notify_sms = False
    event.notify_whatsapp = False
    await db.commit()
    return await workspace(event, db)


@router.get("")
async def list_invites(db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    orgs = select(Membership.org_id).where(Membership.user_id == user.id, Membership.role.in_(["owner", "admin"]))
    events = (await db.scalars(select(Event).where(Event.org_id.in_(orgs)).order_by(Event.event_date.desc()))).all()
    return [{"id": e.id, "name": e.name, "event_date": e.event_date, "status": e.status} for e in events if preferences(e)]


@router.put("/manage/{event_id}")
async def edit(event_id: str, request: Request, data: InviteDraft, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    event = await owned(event_id, user, db, request)
    if data.event_date.tzinfo is None or data.event_date.astimezone(timezone.utc).replace(tzinfo=None) <= datetime.utcnow():
        raise HTTPException(422, "Choose a future event date with its timezone offset")
    event.name = data.name
    event.event_date = data.event_date.astimezone(timezone.utc).replace(tzinfo=None)
    event.timezone = data.timezone
    event.venue_name = data.venue_name
    event.invite_message = data.message
    event.description = data.message
    event.invite_cover_image = data.cover or None
    event.setup_preferences = {**(event.setup_preferences or {}), "quick_invite": {**preferences(event), "style": data.style, "colour": data.colour, "cover": data.cover, "envelope": data.envelope}}
    await db.commit()
    return await workspace(event, db)


@router.get("/manage/{event_id}")
async def get_workspace(event_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await workspace(await owned(event_id, user, db, request), db)


@router.get("/public/{token}")
async def get_public(token: str, response: Response, reply: str | None = None, db: AsyncSession = Depends(get_db)):
    response.headers.update({"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow"})
    event = await invitation(token, db)
    person = await db.scalar(select(QuickInviteRecipient).where(QuickInviteRecipient.event_id == event.id, QuickInviteRecipient.token == reply)) if reply else None
    if reply and not person: raise HTTPException(404, "Personal invitation not found")
    if event.invite_mode == 'closed' and not person:
        raise HTTPException(403, "Please open the personal invitation sent to you by the organizer.")
    return {"invitation": public_data(event), "registration_url": await registration_target(event, db, person),
            "recipient": {"name": person.name, "response": person.response} if person else None}


@router.post("/public/{token}/reply", dependencies=[Depends(rate_limit(limit=30, window=60, scope="quick-rsvp"))])
async def respond(token: str, data: Reply, response: Response, db: AsyncSession = Depends(get_db)):
    response.headers.update({"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow"})
    event = await invitation(token, db, lock=True)
    key = data.reply_token or hashlib.sha256(f"{event.id}:{data.request_id}".encode()).hexdigest()
    person = await db.scalar(select(QuickInviteRecipient).where(QuickInviteRecipient.event_id == event.id, QuickInviteRecipient.token == key))
    if data.reply_token and not person: raise HTTPException(404, "Reply link not found")
    if event.invite_mode == 'closed' and not person:
        raise HTTPException(403, "Please use your personal invitation link to respond.")
    if await registration_target(event, db, person):
        raise HTTPException(409, "The organizer added registration steps. Reopen the invitation to continue through the event's registration page.")
    email = str(data.email).strip().lower() if data.email else None
    if not person and email and await db.scalar(select(QuickInviteRecipient.id).where(QuickInviteRecipient.event_id == event.id, QuickInviteRecipient.email == email)):
        raise HTTPException(409, "Please use the personal invitation or reply link for this email address.")
    if not person:
        # UUID request identity is a secret idempotency credential, never inferred
        # from a name/email address and never disclosed by directory lookup.
        person = QuickInviteRecipient(event_id=event.id, name=data.name.strip(), email=email, token=key)
        db.add(person)
    if not data.name.strip(): raise HTTPException(422, "Enter your name")
    guest = await db.get(Guest, person.guest_id) if person.guest_id else None
    if guest and guest.admitted and data.response != "going":
        raise HTTPException(409, "You are already checked in. Please contact the organizer to change your attendance.")
    if not guest:
        count = await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id == event.id)) or 0
        try:
            assert_within_guest_cap(event, count)
        except HTTPException as exc:
            if exc.status_code == 402:
                raise HTTPException(409, "This invitation has reached its guest limit. Please contact the organizer.")
            raise
        parts = data.name.strip().split(' ', 1)
        guest = Guest(event_id=event.id, first_name=parts[0][:100], last_name=(parts[1] if len(parts)>1 else '')[:100], email=person.email or email,
                      invite_token=str(uuid.uuid4()), rsvp_status="invited")
        db.add(guest)
        await db.flush()
        person.guest_id = guest.id
    parts = data.name.strip().split(' ', 1)
    guest.first_name = parts[0][:100]
    guest.last_name = (parts[1] if len(parts)>1 else '')[:100]
    person.name = data.name.strip()
    person.response = data.response
    person.responded_at = datetime.utcnow()
    guest.rsvp_status = {"going": "confirmed", "maybe": "maybe", "declined": "declined"}[data.response]
    guest.rsvp_responded_at = person.responded_at
    await db.commit()
    return {"response": person.response, "reply_token": person.token}


def email_document(event, person):
    ink, paper, accent = PALETTES.get(preferences(event).get("colour"), PALETTES["mint"])
    esc = html.escape
    date = event.event_date.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(event.timezone or "UTC")).strftime("%A, %B %d · %I:%M %p")
    return f'''<!doctype html><html><body style="margin:0;background:{paper};font-family:Arial,sans-serif;color:{ink}"><table role="presentation" width="100%"><tr><td align="center" style="padding:48px 20px"><table role="presentation" width="540" style="width:100%;max-width:540px;background:white;border-radius:20px"><tr><td style="padding:42px"><p style="letter-spacing:3px;font-size:11px">YOU'RE INVITED</p><h1 style="font:42px Georgia,serif">{esc(event.name)}</h1><p>Hello {esc(person.name or 'there')},</p><p>{esc(event.invite_message or '').replace(chr(10),'<br>')}</p><p>{esc(date)}<br>{esc(event.timezone or '')}<br>{esc(event.venue_name or '')}</p><p style="margin:32px 0"><a style="background:{ink};color:white;text-decoration:none;padding:16px 24px;border-radius:8px" href="{esc(share_url(event,person))}">Open invitation &amp; RSVP</a></p><p style="font-size:12px">Sent by your event organizer through Festio. Your reply is private.</p></td></tr></table><p><a href="{esc(settings.frontend_url.rstrip('/')+'/create-invitation')}">Create your own free invitation with Festio</a></p></td></tr></table></body></html>'''


@router.post("/manage/{event_id}/send", dependencies=[Depends(verified_sender), Depends(rate_limit(limit=5, window=60, scope="quick-send"))])
async def send(event_id: str, request: Request, data: SendInvites, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await owned(event_id, user, db, request)
    event = await db.scalar(select(Event).where(Event.id == event_id).with_for_update())
    await invitation(event.rsvp_token, db)
    rows = (await db.scalars(select(QuickInviteRecipient).where(QuickInviteRecipient.event_id == event.id))).all()
    addresses = {str(p.email).strip().lower(): p for p in data.recipients}
    new_count = len(set(addresses)-{r.email for r in rows if r.email})
    if len(rows)+new_count > 25: raise HTTPException(422, "Quick invitations support 25 contacts. Open the full event workspace for larger lists.")
    requested = []
    for address, contact in addresses.items():
        person = next((r for r in rows if r.email == address), None)
        if not person:
            person = QuickInviteRecipient(event_id=event.id, email=address, name=contact.name.strip())
            db.add(person)
            await db.flush()
        if person.send_status in {"sent", "queued", "sending", "uncertain"} or person.attempts >= 3: continue
        requested.append(person)
    limit = min(75, EMAIL_FREE_QUOTA)
    if sum(r.attempts for r in rows)+len(requested) > limit:
        raise HTTPException(422, "This invitation's free email allowance is used. You can still copy and share the link.")
    for person in requested:
        person.send_status = "queued"
        person.attempts += 1
        person.email_subject = "You're invited — " + event.name
        person.email_html = email_document(event, person)
    await db.commit()
    return {"queued": len(requested), "skipped": len(addresses)-len(requested)}
