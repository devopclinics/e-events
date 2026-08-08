"""Private, idempotent ticket-order fulfillment into Festio guest passes."""
import html
import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from ..config import settings
from ..database import get_db
from ..models import Event, Guest, Organization, TicketType
from services.email_service import send_simple_email
from services.outbound_safety import recipient_allowed
from services.qr_service import generate_qr_bytes
from services import messaging

router = APIRouter()


class PaidAttendee(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(default="", max_length=120)
    email: str | None = None
    phone: str | None = None
    access_ticket_type_id: str | None = None
    product_name: str = Field(max_length=120)
    # Donation/sponsorship line items are payment-only — no admission, no
    # guest row, no QR pass. See ticketing-service's TicketProduct.product_type.
    is_donation: bool = False


class PaidOrderFulfillment(BaseModel):
    order_id: str = Field(min_length=1, max_length=80)
    event_id: str
    buyer_email: str
    attendees: list[PaidAttendee] = Field(min_length=1, max_length=500)
    delivery_settings: dict = Field(default_factory=dict)


class PaidOrderDelivery(BaseModel):
    buyer_email: str
    delivery_settings: dict = Field(default_factory=dict)


class EventLookup(BaseModel):
    event_ids: list[str] = Field(min_length=1, max_length=500)


class PaidTicketTransfer(BaseModel):
    order_id: str
    guest_id: str
    recipient_name: str = Field(min_length=1, max_length=200)
    recipient_email: str


class WaitlistOfferDelivery(BaseModel):
    email: str
    name: str
    ticket_name: str
    offer_url: str
    expires_at: datetime
    reminder: bool = False


class TicketSalesReportDelivery(BaseModel):
    recipient: str
    subject: str = Field(max_length=300)
    html_body: str = Field(max_length=100_000)
    csv_content: str = Field(max_length=5_000_000)
    filename: str = Field(default="ticket-sales-report.csv", max_length=200)


class PaidTicketVoid(BaseModel):
    guest_ids: list[str] = Field(default_factory=list, max_length=500)


def _pass_url(event: Event, guest: Guest) -> str:
    base = (event.checkin_base_url or "https://staging.festio.events").rstrip("/")
    return f"{base}/scan/{guest.qr_token}"


def _queue_ticket_delivery(background_tasks: BackgroundTasks, event: Event, order_id: str,
                           buyer_email: str, guests: list[Guest], delivery_settings: dict | None = None,
                           donation_count: int = 0) -> int:
    settings_row = delivery_settings or {}
    def render(value: str, guest: Guest | None = None, pass_url: str = "") -> str:
        values = {"event_name": event.name, "order_id": order_id[:8].upper(),
                  "first_name": guest.first_name if guest else "", "last_name": guest.last_name if guest else "",
                  "ticket_link": pass_url}
        for key, replacement in values.items(): value = value.replace("{{"+key+"}}", str(replacement or ""))
        return value
    inline_images = []
    rows = "".join(
        f'<li style="margin:12px 0"><strong>{html.escape((g.first_name + " " + g.last_name).strip())}</strong>'
        f'<br><img src="cid:ticketqr{index}" alt="QR code for {(html.escape(g.first_name))}" width="220" height="220" '
        f'style="display:block;width:220px;height:220px;margin:12px 0;border:8px solid #fff" />'
        f'<div style="color:#64748b;font-size:13px;margin:4px 0 10px">{html.escape(render(settings_row.get("email_qr_caption") or "Show this QR code at the entrance.", g, _pass_url(event, g)))}</div>'
        f'<a href="{html.escape(_pass_url(event, g), quote=True)}">Open mobile pass</a></li>'
        for index, g in enumerate(guests)
    )
    for index, guest in enumerate(guests):
        inline_images.append((f"ticket-{index+1}.png", generate_qr_bytes(guest.qr_token,
                              event.checkin_base_url or "https://staging.festio.events"), f"ticketqr{index}"))
    if not guests and donation_count:
        # Pure donation/sponsorship order — no admission passes to describe.
        default_body = (f'<p>Thank you — your contribution to <strong>{html.escape(event.name)}</strong> is confirmed.</p>'
                       f'<p>Order <strong>{html.escape(order_id[:8].upper())}</strong> is complete. '
                       'A full payment receipt is available on your order page.</p>')
    else:
        donation_note = (f'<p>Your order also includes {donation_count} contribution'
                        f'{"s" if donation_count != 1 else ""} — thank you for the extra support.</p>'
                        if donation_count else '')
        default_body = (f'<p>Your admission for <strong>{html.escape(event.name)}</strong> is confirmed.</p>'
                      f'<p>Order <strong>{html.escape(order_id[:8].upper())}</strong> includes '
                      f'{len(guests)} unique admission pass{"es" if len(guests) != 1 else ""}.</p>'
                      f'{donation_note}'
                      f'<ul>{rows}</ul><p>Each attendee must present their own QR pass at check-in. '
                      'A screenshot or the live mobile pass will work.</p>')
    custom_body = settings_row.get("email_body", "").strip()
    buyer_body = (f'<p>{html.escape(render(custom_body))}</p>{rows}' if custom_body else default_body)
    if settings_row.get("email_enabled", True):
        background_tasks.add_task(send_simple_email, buyer_email,
                                  render(settings_row.get("email_subject") or "Your tickets for {{event_name}}"),
                                  buyer_body, event.id, None, None, "paid_ticket_order", inline_images)
    queued = 1 if settings_row.get("email_enabled", True) else 0
    buyer_lower = buyer_email.strip().lower()
    sent = {buyer_lower}
    for guest in guests:
        recipient = (guest.email or "").strip().lower()
        if not recipient or recipient in sent:
            continue
        sent.add(recipient)
        link = _pass_url(event, guest)
        body = (f'<p>Hi {html.escape(guest.first_name)},</p><p>Your admission to '
                f'<strong>{html.escape(event.name)}</strong> is confirmed.</p>'
                f'<p><a href="{html.escape(link, quote=True)}">Open your unique Festio pass</a></p>'
                '<p>This QR pass belongs only to you and can be admitted once.</p>')
        background_tasks.add_task(send_simple_email, recipient,
                                  f"Your pass for {event.name}", body, event.id,
                                  None, guest.id, "paid_ticket_pass")
        queued += 1
    for guest in guests:
        if not guest.phone: continue
        link = _pass_url(event, guest)
        if settings_row.get("sms_enabled"):
            text = render(settings_row.get("sms_body") or "Hi {{first_name}}, your ticket for {{event_name}}: {{ticket_link}}", guest, link)
            background_tasks.add_task(messaging.send_custom_sms, phone=guest.phone, body=text); queued += 1
        if settings_row.get("whatsapp_enabled"):
            # Ticket delivery can start a new WhatsApp conversation, so it must
            # use the Meta-approved Bird template rather than session-only free
            # text. The active Festio ticket/pass template carries the attendee,
            # event date and secure pass URL as approved variables.
            background_tasks.add_task(
                messaging.send_invite_whatsapp,
                phone=guest.phone, first_name=guest.first_name,
                event_name=event.name, event_date=event.event_date,
                event_timezone=event.timezone, ticket_url=link,
            ); queued += 1
    return queued


def _authorized(value: str | None) -> None:
    if not settings.ticketing_internal_token or value != settings.ticketing_internal_token:
        raise HTTPException(401, "Invalid internal service token")


@router.post("/events")
async def ticketed_events(body: EventLookup, x_internal_token: str | None = Header(default=None),
                          db: AsyncSession = Depends(get_db)):
    _authorized(x_internal_token)
    events = (await db.execute(select(Event).where(Event.id.in_(body.event_ids)))).scalars().all()
    org_ids = {event.org_id for event in events}
    orgs = {row.id: row for row in (await db.execute(select(Organization).where(
        Organization.id.in_(org_ids)))).scalars().all()}
    return {"events": [{"id": event.id, "name": event.name, "description": event.description,
                        "event_type": event.event_type, "organizer_name": orgs[event.org_id].name,
                        "organizer_slug": orgs[event.org_id].slug,
                        "event_date": event.event_date, "event_end_date": event.event_end_date,
                        "timezone": event.timezone, "venue_name": event.venue_name,
                        "venue_address": event.venue_address,
                        "cover_image": event.invite_cover_image} for event in events]}


@router.post("/transfer/{event_id}")
async def transfer_paid_ticket(event_id: str, body: PaidTicketTransfer, background_tasks: BackgroundTasks,
                               x_internal_token: str | None = Header(default=None),
                               db: AsyncSession = Depends(get_db)):
    _authorized(x_internal_token)
    guest = await db.get(Guest, body.guest_id)
    event = await db.get(Event, event_id)
    marker = f"Paid ticket order: {body.order_id}"
    if not event or not guest or guest.event_id != event_id or not (
            guest.paid_ticket_order_id == body.order_id or (guest.rsvp_notes or "").startswith(marker)):
        raise HTTPException(404, "Transferable ticket not found")
    if guest.rsvp_status != "confirmed" or guest.admitted:
        raise HTTPException(409, "A cancelled or already-admitted ticket cannot be transferred")
    parts = body.recipient_name.strip().split(maxsplit=1)
    guest.first_name, guest.last_name = parts[0], parts[1] if len(parts) > 1 else ""
    guest.email, guest.qr_token, guest.qr_generated_at = body.recipient_email, str(uuid.uuid4()), datetime.utcnow()
    await db.commit(); await db.refresh(guest)
    link = _pass_url(event, guest)
    background_tasks.add_task(send_simple_email, body.recipient_email,
        f"A ticket for {event.name} was transferred to you",
        f'<p>Your ticket transfer is complete.</p><p><a href="{html.escape(link, quote=True)}">Open your new unique Festio pass</a></p><p>The previous QR is no longer valid.</p>',
        event.id, None, guest.id, "paid_ticket_transfer")
    return {"guest_id": guest.id, "qr_token": guest.qr_token,
            "name": f"{guest.first_name} {guest.last_name}".strip(), "pass_url": link}


@router.post("/waitlist-offer/{event_id}")
async def deliver_waitlist_offer(event_id: str, body: WaitlistOfferDelivery, background_tasks: BackgroundTasks,
                                 x_internal_token: str | None = Header(default=None),
                                 db: AsyncSession = Depends(get_db)):
    _authorized(x_internal_token)
    event = await db.get(Event, event_id)
    if not event: raise HTTPException(404, "Event not found")
    subject = f"Reminder: your ticket offer expires soon — {event.name}" if body.reminder else f"Tickets are available for {event.name}"
    intro = "Your reserved ticket offer expires soon." if body.reminder else "Your place on the waitlist is ready."
    background_tasks.add_task(send_simple_email, body.email, subject,
        f'<p>Hi {html.escape(body.name)},</p><p>{html.escape(intro)} '
        f'{html.escape(body.ticket_name)} is reserved for you for a limited time.</p>'
        f'<p><a href="{html.escape(body.offer_url, quote=True)}">Claim your reserved tickets</a></p>'
        f'<p>This private offer expires at {html.escape(body.expires_at.isoformat())}.</p>',
        event.id, None, None, "ticket_waitlist_offer")
    return {"queued": True}


@router.post("/sales-report/{event_id}")
async def deliver_ticket_sales_report(event_id: str, body: TicketSalesReportDelivery,
                                      background_tasks: BackgroundTasks,
                                      x_internal_token: str | None = Header(default=None),
                                      db: AsyncSession = Depends(get_db)):
    _authorized(x_internal_token)
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    safe_filename = "".join(ch for ch in body.filename if ch.isalnum() or ch in "-_. ").strip() or "ticket-sales-report.csv"
    background_tasks.add_task(send_simple_email, body.recipient, body.subject, body.html_body,
                              event.id, [(safe_filename, body.csv_content.encode("utf-8"), "text/csv")],
                              None, "ticket_sales_report")
    return {"queued": True}


@router.post("/fulfill")
async def fulfill_paid_order(body: PaidOrderFulfillment, background_tasks: BackgroundTasks,
                             x_internal_token: str | None = Header(default=None),
                             db: AsyncSession = Depends(get_db)):
    _authorized(x_internal_token)
    event = await db.get(Event, body.event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    marker = f"Paid ticket order: {body.order_id}"
    existing = (await db.execute(select(Guest).where(
        Guest.event_id == body.event_id,
        or_(Guest.paid_ticket_order_id == body.order_id, Guest.rsvp_notes.like(f"{marker}%"))
    ).order_by(Guest.id))).scalars().all()
    if existing:
        return {"order_id": body.order_id, "already_fulfilled": True,
                "passes": [{"guest_id": g.id, "qr_token": g.qr_token,
                            "name": f"{g.first_name} {g.last_name}".strip()} for g in existing],
                "delivery_queued": False}
    valid_types = set((await db.execute(select(TicketType.id).where(
        TicketType.event_id == body.event_id, TicketType.is_active.is_(True)
    ))).scalars().all())
    now = datetime.utcnow()
    created = []
    donation_count = sum(1 for attendee in body.attendees if attendee.is_donation)
    for attendee in body.attendees:
        if attendee.is_donation:
            continue
        if attendee.access_ticket_type_id and attendee.access_ticket_type_id not in valid_types:
            raise HTTPException(409, f"Access type for {attendee.product_name} is no longer valid")
        guest = Guest(
            event_id=body.event_id, first_name=attendee.first_name.strip(),
            last_name=attendee.last_name.strip(), email=attendee.email or body.buyer_email,
            phone=attendee.phone, ticket_type_id=attendee.access_ticket_type_id,
            rsvp_status="confirmed", rsvp_responded_at=now, qr_generated_at=now,
            invite_sent_at=now, rsvp_guest_type=attendee.product_name,
            paid_ticket_order_id=body.order_id,
            paid_ticket_pass_design=(body.delivery_settings or {}).get("pass_design") or {},
        )
        db.add(guest); created.append(guest)
    await db.commit()
    for guest in created:
        await db.refresh(guest)
    delivery_allowed = not body.delivery_settings.get("email_enabled", True) or recipient_allowed("email", body.buyer_email)
    queued = _queue_ticket_delivery(background_tasks, event, body.order_id, body.buyer_email, created,
                                    body.delivery_settings, donation_count) if delivery_allowed else 0
    return {"order_id": body.order_id, "already_fulfilled": False,
            "passes": [{"guest_id": g.id, "qr_token": g.qr_token,
                        "name": f"{g.first_name} {g.last_name}".strip()} for g in created],
            "delivery_queued": delivery_allowed, "delivery_blocked": not delivery_allowed,
            "delivery_block_reason": None if delivery_allowed else "Recipient is not on the staging email allowlist",
            "delivery_messages": queued}


@router.post("/delivery/{event_id}/{order_id}")
async def resend_paid_order(event_id: str, order_id: str, body: PaidOrderDelivery,
                            background_tasks: BackgroundTasks,
                            x_internal_token: str | None = Header(default=None),
                            db: AsyncSession = Depends(get_db)):
    _authorized(x_internal_token)
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    marker = f"Paid ticket order: {order_id}"
    guests = (await db.execute(select(Guest).where(
        Guest.event_id == event_id,
        or_(Guest.paid_ticket_order_id == order_id, Guest.rsvp_notes.like(f"{marker}%")),
        Guest.rsvp_status == "confirmed"
    ).order_by(Guest.id))).scalars().all()
    if not guests:
        raise HTTPException(404, "No active passes found for this order")
    for guest in guests:
        guest.paid_ticket_pass_design = body.delivery_settings.get("pass_design") or guest.paid_ticket_pass_design or {}
    await db.commit()
    queued = _queue_ticket_delivery(background_tasks, event, order_id, body.buyer_email, guests, body.delivery_settings)
    return {"order_id": order_id, "delivery_queued": True, "delivery_messages": queued}


@router.post("/void/{event_id}/{order_id}")
async def void_paid_order(event_id: str, order_id: str,
                          body: PaidTicketVoid | None = None,
                          x_internal_token: str | None = Header(default=None),
                          db: AsyncSession = Depends(get_db)):
    _authorized(x_internal_token)
    marker = f"Paid ticket order: {order_id}"
    guests = (await db.execute(select(Guest).where(
        Guest.event_id == event_id,
        or_(Guest.paid_ticket_order_id == order_id, Guest.rsvp_notes.like(f"{marker}%"))
    ))).scalars().all()
    selected = set(body.guest_ids if body else [])
    if selected:
        found = {guest.id for guest in guests}
        if not selected.issubset(found):
            raise HTTPException(404, "One or more tickets were not found in this order")
        guests = [guest for guest in guests if guest.id in selected]
    for guest in guests:
        guest.rsvp_status = "declined"
        guest.admitted = False
        guest.admitted_at = None
    await db.commit()
    return {"order_id": order_id, "voided": len(guests)}


@router.post("/anonymize/{event_id}/{order_id}")
async def anonymize_paid_order(event_id: str, order_id: str,
                               x_internal_token: str | None = Header(default=None),
                               db: AsyncSession = Depends(get_db)):
    """Erase attendee PII while retaining the minimum financial/order linkage."""
    _authorized(x_internal_token)
    marker = f"Paid ticket order: {order_id}"
    guests = (await db.execute(select(Guest).where(
        Guest.event_id == event_id,
        or_(Guest.paid_ticket_order_id == order_id, Guest.rsvp_notes.like(f"{marker}%"))))).scalars().all()
    for index, guest in enumerate(guests, start=1):
        guest.first_name, guest.last_name = "Deleted attendee", str(index)
        guest.email, guest.phone = None, None
        guest.qr_token, guest.rsvp_status = str(uuid.uuid4()), "declined"
        guest.admitted, guest.admitted_at = False, None
    await db.commit()
    return {"order_id": order_id, "anonymized": len(guests)}
