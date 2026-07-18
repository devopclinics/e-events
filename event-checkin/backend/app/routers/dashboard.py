import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import EmailDeliveryEvent, Guest, Event, User, Zone, MenuCategory, SeatingTable, TicketType, TableGroup, ScanEvent, MessageCreditLedger
from ..schemas import DashboardStats, GuestOut, ZoneOccupancy, TableReport, DashboardBreakdown, DashboardTimelinePoint, DashboardInviteDelivery, DashboardContactStats, DashboardEmailDelivery, DashboardChannelDelivery, DashboardCredits
from ..auth import require_dashboard_access, verify_token_user, user_has_dashboard_access
from .access import zone_occupancy
from . import sse_subscribers

router = APIRouter()


async def _count(db, *where):
    return await db.scalar(select(func.count()).select_from(Guest).where(*where)) or 0


@router.get("/{event_id}/dashboard", response_model=DashboardStats)
async def get_dashboard(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_dashboard_access)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    total = await _count(db, Guest.event_id == event_id)
    admitted_count = await _count(db, Guest.event_id == event_id, Guest.admitted == True)
    walk_in_count = await _count(db, Guest.event_id == event_id, Guest.is_walk_in == True)
    checked_out_count = 0
    if event.checkout_enabled:
        checked_out_count = await db.scalar(
            select(func.count(func.distinct(ScanEvent.guest_id))).where(
                ScanEvent.event_id == event_id,
                ScanEvent.zone_id.is_(None),
                ScanEvent.direction == "out",
                ScanEvent.denied.is_(False),
            )
        ) or 0

    # Full admitted_at history (cheap: one column) drives the arrival-timeline
    # chart, which needs every check-in, not just the most recent ones.
    admitted_at_values = (await db.execute(
        select(Guest.admitted_at).where(Guest.event_id == event_id, Guest.admitted == True)
    )).scalars().all()
    # The "Recent check-ins" list only ever shows the newest 50 (frontend
    # slices to 50 regardless), so cap it here too -- serializing every
    # admitted guest's full record on every dashboard load doesn't scale
    # past a few hundred check-ins and was causing multi-hundred-KB
    # responses (and client-side "Failed to fetch" timeouts) on well-attended
    # live events.
    admitted_guests = (await db.execute(
        select(Guest).where(Guest.event_id == event_id, Guest.admitted == True)
        .order_by(Guest.admitted_at.desc())
        .limit(50)
    )).scalars().all()
    pending_guests = (await db.execute(
        select(Guest).where(Guest.event_id == event_id, Guest.admitted == False)
        .order_by(Guest.is_vip.desc(), Guest.last_name, Guest.first_name)
        .limit(50)
    )).scalars().all()

    # RSVP breakdown
    rsvp_confirmed = await _count(db, Guest.event_id == event_id, Guest.rsvp_status == "confirmed")
    rsvp_declined = await _count(db, Guest.event_id == event_id, Guest.rsvp_status == "declined")
    rsvp_pending = await _count(db, Guest.event_id == event_id, Guest.rsvp_status == "pending")
    rsvp_invited = await _count(db, Guest.event_id == event_id, Guest.rsvp_status == "invited")
    vip_total = await _count(db, Guest.event_id == event_id, Guest.is_vip == True)
    vip_admitted = await _count(db, Guest.event_id == event_id, Guest.is_vip == True, Guest.admitted == True)
    invite_delivery = DashboardInviteDelivery(
        sent=await _count(db, Guest.event_id == event_id, Guest.invite_status == "sent"),
        failed=await _count(db, Guest.event_id == event_id, Guest.invite_status == "failed"),
        unsent=await _count(db, Guest.event_id == event_id, Guest.invite_status.is_(None), Guest.invite_sent_at.is_(None)),
    )
    email_delivery_rows = (await db.execute(
        select(EmailDeliveryEvent)
        .where(EmailDeliveryEvent.event_id == event_id)
        .order_by(EmailDeliveryEvent.occurred_at.desc(), EmailDeliveryEvent.created_at.desc())
    )).scalars().all()
    latest_by_email = {}
    for row in email_delivery_rows:
        key = row.provider_email_id or row.provider_event_id or row.id
        latest_by_email.setdefault(key, row)
    email_delivery_counts = {
        "sent": 0,
        "delivered": 0,
        "opened": 0,
        "clicked": 0,
        "delayed": 0,
        "bounced": 0,
        "failed": 0,
        "complained": 0,
        "suppressed": 0,
        "unknown": 0,
    }
    for row in latest_by_email.values():
        status = row.status or "unknown"
        if status == "delivery_delayed":
            status = "delayed"
        if status not in email_delivery_counts:
            status = "unknown"
        email_delivery_counts[status] += 1
    email_delivery = DashboardEmailDelivery(
        **email_delivery_counts,
        tracked=len(latest_by_email),
    )
    email_available = await _count(db, Guest.event_id == event_id, Guest.email.isnot(None), Guest.email != "")
    phone_available = await _count(db, Guest.event_id == event_id, Guest.phone.isnot(None), Guest.phone != "")
    both_available = await _count(
        db,
        Guest.event_id == event_id,
        Guest.email.isnot(None), Guest.email != "",
        Guest.phone.isnot(None), Guest.phone != "",
    )
    contact_stats = DashboardContactStats(
        email_available=email_available,
        phone_available=phone_available,
        both_available=both_available,
        no_contact=await _count(
            db,
            Guest.event_id == event_id,
            (Guest.email.is_(None) | (Guest.email == "")),
            (Guest.phone.is_(None) | (Guest.phone == "")),
        ),
        invite_sent=invite_delivery.sent,
        invite_failed=invite_delivery.failed,
        responses_received=await _count(
            db,
            Guest.event_id == event_id,
            (Guest.rsvp_responded_at.isnot(None) | Guest.rsvp_status.in_(["confirmed", "declined", "pending"])),
        ),
    )

    admitted_by_hour: dict[str, int] = {}
    for admitted_at in admitted_at_values:
        if not admitted_at:
            continue
        hour = admitted_at.replace(minute=0, second=0, microsecond=0)
        admitted_by_hour[hour.isoformat()] = admitted_by_hour.get(hour.isoformat(), 0) + 1
    arrival_timeline = [
        DashboardTimelinePoint(label=label, count=count)
        for label, count in sorted(admitted_by_hour.items())
    ]

    ticket_types: list[DashboardBreakdown] = []
    ttype_rows = (await db.execute(
        select(TicketType).where(TicketType.event_id == event_id, TicketType.is_active == True)
        .order_by(TicketType.sort_order, TicketType.name)
    )).scalars().all()
    ttype_agg = {tid: (n, ci) for tid, n, ci in (await db.execute(
        select(
            Guest.ticket_type_id,
            func.count(Guest.id),
            func.count(Guest.id).filter(Guest.admitted.is_(True)),
        ).where(Guest.event_id == event_id, Guest.ticket_type_id.isnot(None))
        .group_by(Guest.ticket_type_id)
    )).all()}
    for ticket in ttype_rows:
        n, ci = ttype_agg.get(ticket.id, (0, 0))
        ticket_types.append(DashboardBreakdown(
            name=ticket.name, total=int(n), admitted=int(ci), pending=max(int(n) - int(ci), 0),
            capacity=ticket.capacity,
        ))
    unassigned_ticket_total = await _count(db, Guest.event_id == event_id, Guest.ticket_type_id.is_(None))
    if unassigned_ticket_total:
        unassigned_ticket_admitted = await _count(db, Guest.event_id == event_id, Guest.ticket_type_id.is_(None), Guest.admitted == True)
        ticket_types.append(DashboardBreakdown(
            name="Unassigned", total=unassigned_ticket_total, admitted=unassigned_ticket_admitted,
            pending=max(unassigned_ticket_total - unassigned_ticket_admitted, 0),
        ))

    table_groups: list[DashboardBreakdown] = []
    group_rows = (await db.execute(
        select(TableGroup).where(TableGroup.event_id == event_id).order_by(TableGroup.sort_order, TableGroup.name)
    )).scalars().all()
    group_agg = {gid: (n, ci) for gid, n, ci in (await db.execute(
        select(
            Guest.assigned_table_group_id,
            func.count(Guest.id),
            func.count(Guest.id).filter(Guest.admitted.is_(True)),
        ).where(Guest.event_id == event_id, Guest.assigned_table_group_id.isnot(None))
        .group_by(Guest.assigned_table_group_id)
    )).all()}
    for group in group_rows:
        n, ci = group_agg.get(group.id, (0, 0))
        table_groups.append(DashboardBreakdown(
            name=group.name, total=int(n), admitted=int(ci), pending=max(int(n) - int(ci), 0),
        ))
    unassigned_group_total = await _count(db, Guest.event_id == event_id, Guest.assigned_table_group_id.is_(None))
    if unassigned_group_total and group_rows:
        unassigned_group_admitted = await _count(db, Guest.event_id == event_id, Guest.assigned_table_group_id.is_(None), Guest.admitted == True)
        table_groups.append(DashboardBreakdown(
            name="No section", total=unassigned_group_total, admitted=unassigned_group_admitted,
            pending=max(unassigned_group_total - unassigned_group_admitted, 0),
        ))

    # Venue-access live occupancy (only when enabled)
    zones: list[ZoneOccupancy] = []
    if event.venue_access_enabled:
        zrows = (await db.execute(
            select(Zone).where(Zone.event_id == event_id, Zone.is_active == True)
            .order_by(Zone.sort_order))).scalars().all()
        for z in zrows:
            zones.append(ZoneOccupancy(name=z.name, inside=await zone_occupancy(z.id, db), capacity=z.capacity))

    # Catering progress (only when menu enabled)
    catering_served = catering_total = None
    if event.menu_enabled:
        has_menu = await db.scalar(select(func.count()).select_from(MenuCategory).where(MenuCategory.event_id == event_id))
        if has_menu:
            catering_total = total
            catering_served = await _count(db, Guest.event_id == event_id, Guest.meal_served == True)

    # Per-table report (only when seating enabled) — helps table-assigned staff.
    tables: list[TableReport] = []
    if event.seating_enabled:
        trows = (await db.execute(
            select(SeatingTable).where(SeatingTable.event_id == event_id)
            .order_by(SeatingTable.name))).scalars().all()
        agg = {tid: (n, ci, sv) for tid, n, ci, sv in (await db.execute(
            select(
                Guest.table_id,
                func.count(Guest.id),
                func.count(Guest.id).filter(Guest.admitted.is_(True)),
                func.count(Guest.id).filter(Guest.meal_served.is_(True)),
            ).where(Guest.event_id == event_id, Guest.table_id.isnot(None))
            .group_by(Guest.table_id))).all()}
        for t in trows:
            n, ci, sv = agg.get(t.id, (0, 0, 0))
            tables.append(TableReport(name=t.name, capacity=t.capacity,
                                      seated=int(n), checked_in=int(ci), served=int(sv)))

    # Messaging (SMS/MMS/WhatsApp) delivery breakdown + credit balance/spend,
    # derived from the message-credit ledger (spend = attempt, refund = failure).
    msg_rows = (await db.execute(
        select(
            MessageCreditLedger.id,
            MessageCreditLedger.channel,
            MessageCreditLedger.action,
            MessageCreditLedger.status,
            MessageCreditLedger.delta,
            MessageCreditLedger.provider_message_id,
        )
        .where(
            MessageCreditLedger.event_id == event_id,
            MessageCreditLedger.channel.in_(("sms", "mms", "whatsapp")),
        )
    )).all()
    chan = {c: {"sent": 0, "delivered": 0, "failed": 0} for c in ("sms", "mms", "whatsapp")}
    credits_spent = 0
    # Deduplicate by provider_message_id so a spend + refund pair is treated as
    # one logical message outcome instead of two separate failures.
    msg_ids = {c: {"sent": set(), "delivered": set(), "failed": set()} for c in ("sms", "mms", "whatsapp")}
    failed_statuses = {"failed", "undelivered", "error", "rejected"}
    for row_id, c, action, status, delta, provider_message_id in msg_rows:
        d = msg_ids.get(c)
        if d is None:
            continue
        message_key = provider_message_id or f"ledger:{row_id}"
        if action == "spend":
            d["sent"].add(message_key)
            st = (status or "").lower()
            if "deliver" in st:
                d["delivered"].add(message_key)
            elif st in failed_statuses:
                d["failed"].add(message_key)
            credits_spent += abs(delta or 0)
        elif action == "refund":
            d["failed"].add(message_key)
    for c in ("sms", "mms", "whatsapp"):
        sent_ids = msg_ids[c]["sent"]
        failed_ids = msg_ids[c]["failed"]
        delivered_ids = msg_ids[c]["delivered"] - failed_ids
        chan[c] = {
            "sent": len(sent_ids),
            "delivered": len(delivered_ids),
            "failed": len(failed_ids),
        }
    message_delivery = [DashboardChannelDelivery(channel=c, **chan[c])
                        for c in ("sms", "mms", "whatsapp")
                        if chan[c]["sent"] or chan[c]["failed"]]
    credits = DashboardCredits(balance=event.message_credits or 0, spent=credits_spent)

    return DashboardStats(
        total=total, admitted=admitted_count, pending=total - admitted_count,
        walk_in=walk_in_count,
        checkout_enabled=event.checkout_enabled,
        checked_out=checked_out_count,
        admitted_guests=[GuestOut.model_validate(g) for g in admitted_guests],
        rsvp_confirmed=rsvp_confirmed, rsvp_declined=rsvp_declined,
        rsvp_pending=rsvp_pending, rsvp_invited=rsvp_invited,
        vip_total=vip_total, vip_admitted=vip_admitted,
        invite_delivery=invite_delivery,
        email_delivery=email_delivery,
        message_delivery=message_delivery,
        credits=credits,
        contact_stats=contact_stats,
        arrival_timeline=arrival_timeline,
        pending_guests=[GuestOut.model_validate(g) for g in pending_guests],
        ticket_types=ticket_types,
        table_groups=table_groups,
        zones=zones, catering_served=catering_served, catering_total=catering_total,
        tables=tables,
    )


@router.get("/{event_id}/stream")
async def event_stream(
    event_id: str,
    token: str = Query(..., description="Firebase ID token (EventSource can't send auth headers)"),
    db: AsyncSession = Depends(get_db),
):
    # EventSource can't set an Authorization header, so the token comes as a query
    # param and is verified here (ported from prod a077c15, using main's
    # dashboard-access rule incl. grantable staff access).
    user = await verify_token_user(token, db)
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if not await user_has_dashboard_access(user, event, db):
        raise HTTPException(403, "You don't have dashboard access for this event.")

    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    if event_id not in sse_subscribers:
        sse_subscribers[event_id] = []
    sse_subscribers[event_id].append(queue)

    async def generate():
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    event_data = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {json.dumps(event_data)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            subscribers = sse_subscribers.get(event_id, [])
            if queue in subscribers:
                subscribers.remove(queue)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
