from datetime import datetime
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Guest, Event, EventUser, User, SeatingTable, MenuCategory, MenuItem, GuestMenuChoice, MenuCombination, MenuCombinationItem, Zone, TicketType, ScanEvent, TableGroup
from ..schemas import ScanResult, GuestOut, TicketView, EventBrief, MenuCategoryOut, MenuItemOut, MenuCombinationOut, MenuCombinationItemOut, GuestMenuSubmit, PartnerInfo, PairRequest, ScanZoneRequest, ScanZoneResult
from ..auth import require_official, _org_role
from .access import zone_occupancy, ticket_allows
from ..entitlements import can_use_paid_channels, take_message_credit
from services.email_service import send_admission_email
from services import messaging
from services.qr_service import generate_qr_bytes
from . import broadcast
from .seating import assign_next_seat
from ..timeutil import local_hhmm
from ..template_resolve import load_overrides, channel_text as template_channel_text, email_override as template_email_override
from services.templates import build_context as build_template_context

router = APIRouter()


async def _load_menu(event_id: str, guest_id: str, db: AsyncSession):
    """Returns (menu_categories, guest_choices_dict).

    guest_choices is shape:
      {"single": {category_id: item_id},
       "multi":  {category_id: [item_id, ...]},
       "combo":  {category_id: combination_id}}
    """
    cats = (await db.execute(
        select(MenuCategory).where(MenuCategory.event_id == event_id).order_by(MenuCategory.sort_order, MenuCategory.name)
    )).scalars().all()

    menu_out = []
    for cat in cats:
        items = (await db.execute(select(MenuItem).where(MenuItem.category_id == cat.id))).scalars().all()
        combos = (await db.execute(
            select(MenuCombination).where(MenuCombination.category_id == cat.id).order_by(MenuCombination.sort_order, MenuCombination.name)
        )).scalars().all()
        combo_outs: list[MenuCombinationOut] = []
        for combo in combos:
            rows = (await db.execute(
                select(MenuCombinationItem, MenuItem)
                .join(MenuItem, MenuItem.id == MenuCombinationItem.menu_item_id)
                .where(MenuCombinationItem.combination_id == combo.id)
            )).all()
            combo_outs.append(MenuCombinationOut(
                id=combo.id,
                name=combo.name,
                description=combo.description,
                sort_order=combo.sort_order,
                items=[MenuCombinationItemOut(menu_item_id=mi.id, name=mi.name, quantity=ci.quantity) for ci, mi in rows],
            ))
        menu_out.append(MenuCategoryOut(
            id=cat.id,
            event_id=event_id,
            name=cat.name,
            sort_order=cat.sort_order,
            selection_type=cat.selection_type,
            min_selections=cat.min_selections,
            max_selections=cat.max_selections,
            items=[MenuItemOut(id=i.id, category_id=i.category_id, name=i.name, description=i.description) for i in items],
            combinations=combo_outs,
        ))

    cat_type = {c.id: c.selection_type for c in cats}
    choices_rows = (await db.execute(
        select(GuestMenuChoice).where(GuestMenuChoice.guest_id == guest_id)
    )).scalars().all()

    single: dict[str, str] = {}
    multi: dict[str, list[str]] = {}
    combo_sel: dict[str, str] = {}
    for ch in choices_rows:
        sel = cat_type.get(ch.category_id)
        if sel == "single" and ch.menu_item_id:
            single[ch.category_id] = ch.menu_item_id
        elif sel == "multi" and ch.menu_item_id:
            multi.setdefault(ch.category_id, []).append(ch.menu_item_id)
        elif sel == "combo" and ch.combination_id:
            combo_sel[ch.category_id] = ch.combination_id

    choices = {"single": single, "multi": multi, "combo": combo_sel}
    return menu_out, choices


@router.get("/{qr_token}/ticket", response_model=TicketView)
async def view_ticket(qr_token: str, db: AsyncSession = Depends(get_db)):
    """Public — guest views their digital ticket."""
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        return TicketView(status="invalid")

    event = await db.get(Event, guest.event_id)
    event_brief = EventBrief(
        name=event.name,
        couples_name=event.couples_name,
        event_date=event.event_date,
        status=event.status,
        seating_enabled=event.seating_enabled,
        menu_enabled=event.menu_enabled,
        notify_sms=event.notify_sms,
        notify_whatsapp=event.notify_whatsapp,
    ) if event else None

    table_name = None
    if guest.table_id:
        table = await db.get(SeatingTable, guest.table_id)
        if table:
            table_name = table.name

    menu_locked = bool(event and event.menu_enabled and not guest.admitted)
    menu_categories = []
    guest_choices: dict[str, dict] = {"single": {}, "multi": {}, "combo": {}}
    if event and event.menu_enabled and event.status == "active" and guest.admitted:
        menu_categories, guest_choices = await _load_menu(guest.event_id, guest.id, db)

    partner_info = None
    if guest.partner_guest_id:
        p = await db.get(Guest, guest.partner_guest_id)
        if p:
            partner_info = PartnerInfo(
                first_name=p.first_name, last_name=p.last_name,
                email=p.email, admitted=p.admitted,
            )

    return TicketView(
        status="admitted" if guest.admitted else "valid",
        guest=GuestOut.model_validate(guest),
        event=event_brief,
        table_name=table_name,
        seat_number=guest.seat_number,
        menu_locked=menu_locked,
        menu_categories=menu_categories,
        guest_choices=guest_choices,
        partner=partner_info,
    )


@router.get("/{qr_token}/qr.png")
async def ticket_qr_image(qr_token: str, db: AsyncSession = Depends(get_db)):
    """Public — QR image for the guest's own ticket page."""
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        return Response(status_code=404)
    event = await db.get(Event, guest.event_id)
    base_url = event.checkin_base_url if event else "https://events.vsgs.io"
    return Response(content=generate_qr_bytes(qr_token, base_url), media_type="image/png")


@router.get("/{qr_token}/card.jpg")
async def ticket_card_image(
    qr_token: str,
    admitted: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Public — styled ticket-card JPEG mirroring the in-app ticket (ported from
    prod). Usable as a shareable/printable card or future MMS media."""
    import asyncio as _asyncio
    from services.ticket_card import generate_ticket_card

    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        return Response(status_code=404)
    event = await db.get(Event, guest.event_id)
    if not event:
        return Response(status_code=404)

    base_url = event.checkin_base_url or "https://events.vsgs.io"
    qr_bytes = generate_qr_bytes(qr_token, base_url)

    table_name = ""
    if guest.table_id:
        tbl = await db.get(SeatingTable, guest.table_id)
        if tbl:
            table_name = tbl.name

    card = await _asyncio.to_thread(
        generate_ticket_card,
        event_name=event.name,
        couples_name=event.couples_name or "",
        event_date=event.event_date,
        venue_name=event.venue_name or "",
        venue_address=event.venue_address or "",
        guest_first_name=guest.first_name,
        guest_last_name=guest.last_name or "",
        qr_png_bytes=qr_bytes,
        admitted=admitted,
        table_name=table_name,
        seat_number=guest.seat_number or "",
    )
    return Response(content=card, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.post("/{qr_token}", response_model=ScanResult)
async def scan_qr(
    qr_token: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_official),
):
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        return ScanResult(status="invalid", message="Invalid QR code. This ticket was not found.")
    event = await db.get(Event, guest.event_id)
    blocked = await checkin_guard(event, current_user, db)
    if blocked:
        return blocked
    return await perform_admission(guest, event, background_tasks, db)


async def checkin_guard(event, current_user, db) -> ScanResult | None:
    """Shared validity + tenant/assignment check for QR and manual check-in.
    Returns a ScanResult to short-circuit on failure, or None when allowed.
    Org owners/admins can check in any of their events; staff must be assigned."""
    if event and event.status != "active":
        label = "has not started yet" if event.status == "draft" else "has ended"
        return ScanResult(status="not_active", message=f"'{event.name}' {label}. Check-in is disabled.")
    if event and not event.is_paid:
        return ScanResult(
            status="not_active",
            message="This event needs an Event Pass to run check-in. Upgrade it in the admin panel.",
        )
    if not current_user.is_platform_superadmin:
        org_role = await _org_role(current_user, event.org_id if event else None, db)
        if org_role is None:
            return ScanResult(status="not_assigned", message="You are not assigned to this event.")
        if org_role == "staff":
            assigned = await db.scalar(
                select(EventUser).where(EventUser.event_id == event.id, EventUser.user_id == current_user.id)
            )
            if not assigned:
                return ScanResult(status="not_assigned", message="You are not assigned to this event.")
    return None


async def perform_admission(guest, event, background_tasks, db) -> ScanResult:
    """Admit a guest — seat assignment (incl. table-group rules), admitted flags,
    notifications, and SSE broadcast. Shared by QR scan and manual check-in.
    Caller must have already validated the event + access (see checkin_guard)."""
    if guest.admitted:
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

    # First-come-first-served seat assignment if this guest has no seat yet.
    # Honors couple pairings + table-group restrictions (see assign_next_seat).
    if event and event.seating_enabled and not guest.table_id:
        await assign_next_seat(guest, db)
        # Table Groups: a grouped guest who couldn't be seated within their group
        # (group full / has no tables) is turned away with a clear message rather
        # than seated outside their group.
        if guest.assigned_table_group_id and event.enforce_table_groups and not guest.table_id:
            grp = await db.get(TableGroup, guest.assigned_table_group_id)
            gname = grp.name if grp else "their table group"
            # Nothing was mutated (the guest stays un-admitted, un-seated), so we
            # can return the denial without committing.
            return ScanResult(
                status="denied",
                message=f"Table group '{gname}' capacity reached — no seat available for "
                        f"{guest.first_name} {guest.last_name}.",
                guest=GuestOut.model_validate(guest),
            )

    # Resolve table name (after possible assignment) for the result card + email.
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

    # Look up menu choices for this guest as "Category: Item" pairs.
    menu_lines: list[tuple[str, str]] = []
    if event and event.menu_enabled:
        rows = (await db.execute(
            select(MenuCategory.name, MenuItem.name)
            .join(GuestMenuChoice, GuestMenuChoice.category_id == MenuCategory.id)
            .join(MenuItem, MenuItem.id == GuestMenuChoice.menu_item_id)
            .where(GuestMenuChoice.guest_id == guest.id)
            .order_by(MenuCategory.sort_order, MenuCategory.name)
        )).all()
        menu_lines = [(cat, item) for cat, item in rows]

    ticket_url = None
    if event and event.checkin_base_url:
        ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}"

    guest_data = {
        "first_name": guest.first_name,
        "last_name": guest.last_name,
        "email": guest.email,
        "phone": guest.phone,
        "admitted_at": guest.admitted_at,
        "table_name": table_name,
        "seat_number": guest.seat_number,
        "menu_choices": menu_lines,
        "event_name": event.name if event else None,
        "ticket_url": ticket_url,
        "menu_enabled": bool(event and event.menu_enabled),
    }
    paid = can_use_paid_channels(event) if event else False
    # Customizable-template overrides for the check-in messages (fall back to the
    # built-in copy when a channel has no override).
    overrides = await load_overrides(event.id, db) if event else {}
    tmpl_ctx = build_template_context(
        event, guest, extras={"table_name": table_name or "", "ticket_link": ticket_url or "", "qr_code": ticket_url or ""}
    )
    if event.notify_email:
        subj, intro = template_email_override(overrides, "admission_confirmation", tmpl_ctx)
        guest_data["subject_override"] = subj
        guest_data["intro_block_override"] = intro
        background_tasks.add_task(send_admission_email, guest_data)
    if paid and event.notify_sms and guest.phone and guest.sms_consent and take_message_credit(event):
        sms_text = template_channel_text(overrides, "admission_confirmation", "sms", tmpl_ctx)
        if sms_text is not None:
            background_tasks.add_task(messaging.send_custom_sms, phone=guest.phone, body=sms_text)
        else:
            background_tasks.add_task(
                messaging.send_admission_sms,
                phone=guest.phone, first_name=guest.first_name,
                event_name=event.name if event else "the event",
                admitted_at=guest.admitted_at,
                table_name=table_name, seat_number=guest.seat_number,
            )
    if paid and event.notify_whatsapp and guest.phone and guest.whatsapp_consent and take_message_credit(event):
        wa_text = template_channel_text(overrides, "admission_confirmation", "whatsapp", tmpl_ctx)
        if wa_text is not None:
            background_tasks.add_task(messaging.send_custom_whatsapp, phone=guest.phone, body=wa_text)
        else:
            background_tasks.add_task(
                messaging.send_admission_whatsapp,
                phone=guest.phone, first_name=guest.first_name,
                event_name=event.name if event else "the event",
                table_name=table_name, seat_number=guest.seat_number,
            )
    await db.commit()  # persist message-credit decrements

    broadcast(guest.event_id, {
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


@router.post("/{qr_token}/zone", response_model=ScanZoneResult)
async def scan_qr_zone(
    qr_token: str,
    body: ScanZoneRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_official),
):
    """Venue Access scan: log a directional, per-zone movement. Completely
    separate from the legacy `scan_qr` flow above (which is unchanged). Only
    usable on events with `venue_access_enabled`."""
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        raise HTTPException(404, "Invalid QR code — this ticket was not found.")
    event = await db.get(Event, guest.event_id)
    if not event or not event.venue_access_enabled:
        raise HTTPException(400, "Venue access scanning is not enabled for this event.")
    if event.status != "active":
        raise HTTPException(409, f"'{event.name}' is not active. Scanning is disabled.")
    if not event.is_paid:
        raise HTTPException(402, "This event needs an Event Pass to run check-in.")

    # Same tenant/assignment check as scan_qr (copied, not shared, to keep that
    # endpoint untouched).
    if not current_user.is_platform_superadmin:
        org_role = await _org_role(current_user, event.org_id, db)
        if org_role is None:
            raise HTTPException(403, "You are not assigned to this event.")
        if org_role == "staff":
            assigned = await db.scalar(
                select(EventUser).where(EventUser.event_id == guest.event_id, EventUser.user_id == current_user.id)
            )
            if not assigned:
                raise HTTPException(403, "You are not assigned to this event.")

    zone = await db.get(Zone, body.zone_id)
    if not zone or zone.event_id != event.id or not zone.is_active:
        raise HTTPException(404, "Zone not found.")

    # Direction: explicit, else inferred from the zone's mode.
    direction = body.direction or ("in" if zone.direction_mode in ("both", "entry") else "out")
    if zone.direction_mode == "entry":
        direction = "in"
    elif zone.direction_mode == "exit":
        direction = "out"

    # Access decision: ticket-type zone permission, then capacity.
    allowed, reason = await ticket_allows(guest, zone.id, db)
    denied = not allowed
    deny_reason = reason
    if not denied and direction == "in" and zone.capacity:
        if await zone_occupancy(zone.id, db) >= zone.capacity:
            denied, deny_reason = True, "Zone is at capacity"

    db.add(ScanEvent(
        event_id=event.id, guest_id=guest.id, zone_id=zone.id, direction=direction,
        scanned_by=current_user.id, denied=denied, deny_reason=deny_reason,
    ))
    # First allowed entry also marks the guest admitted so the normal dashboard
    # still reflects arrivals (legacy events never reach this code).
    if not denied and direction == "in" and not guest.admitted:
        guest.admitted = True
        guest.admitted_at = datetime.utcnow()
        guest.admit_notified = True
        if event.seating_enabled and not guest.table_id:
            await assign_next_seat(guest, db)
    await db.commit()

    occ = await zone_occupancy(zone.id, db)
    journey_count = await db.scalar(
        select(func.count(ScanEvent.id)).where(
            ScanEvent.guest_id == guest.id, ScanEvent.event_id == event.id, ScanEvent.denied.is_(False))
    ) or 0
    tt_name = None
    if guest.ticket_type_id:
        tt = await db.get(TicketType, guest.ticket_type_id)
        tt_name = tt.name if tt else None
    table_name = None
    if guest.table_id:
        tbl = await db.get(SeatingTable, guest.table_id)
        table_name = tbl.name if tbl else None

    broadcast(event.id, {
        "type": "scan", "guest_id": guest.id,
        "name": f"{guest.first_name} {guest.last_name}",
        "zone_id": zone.id, "zone_name": zone.name,
        "direction": direction, "denied": denied, "occupancy": occ,
    })

    return ScanZoneResult(
        status="denied" if denied else "ok", denied=denied, deny_reason=deny_reason,
        guest_name=f"{guest.first_name} {guest.last_name}", ticket_type=tt_name,
        zone_name=zone.name, direction=direction, occupancy=occ,
        journey_count=int(journey_count), seat_number=guest.seat_number, table_name=table_name,
    )


@router.post("/{qr_token}/preferences")
async def update_preferences(qr_token: str, body: dict, db: AsyncSession = Depends(get_db)):
    """Public — guest updates their own notification preferences.
    Body: {sms_consent?: bool, whatsapp_consent?: bool}
    No auth: the QR token itself is the credential."""
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        raise HTTPException(404, "Invalid ticket")
    if "sms_consent" in body:
        guest.sms_consent = bool(body["sms_consent"])
    if "whatsapp_consent" in body:
        guest.whatsapp_consent = bool(body["whatsapp_consent"])
    await db.commit()
    return {"ok": True, "sms_consent": guest.sms_consent, "whatsapp_consent": guest.whatsapp_consent}


@router.post("/{qr_token}/pair")
async def pair_with_partner(qr_token: str, body: PairRequest, db: AsyncSession = Depends(get_db)):
    """Public — guest links themselves to another guest in the same event so
    they get seated together at scan time."""
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        raise HTTPException(404, "Invalid ticket")

    target_email = body.partner_email.strip().lower()
    partner = (await db.execute(
        select(Guest).where(
            Guest.event_id == guest.event_id,
            Guest.email == target_email,
            Guest.first_name.ilike(body.partner_first_name.strip()),
            Guest.last_name.ilike(body.partner_last_name.strip()),
        )
    )).scalar_one_or_none()

    if not partner:
        raise HTTPException(404, "No guest matches that name and email on the invite list.")
    if partner.id == guest.id:
        raise HTTPException(400, "You can't pair with yourself.")
    if partner.partner_guest_id and partner.partner_guest_id != guest.id:
        raise HTTPException(409, f"{partner.first_name} is already paired with someone else.")
    if guest.partner_guest_id and guest.partner_guest_id != partner.id:
        raise HTTPException(409, "You're already paired with another guest. Unpair first.")

    # Mutual link.
    guest.partner_guest_id = partner.id
    partner.partner_guest_id = guest.id
    await db.commit()
    return {"ok": True, "partner": {"first_name": partner.first_name, "last_name": partner.last_name}}


@router.delete("/{qr_token}/pair")
async def unpair(qr_token: str, db: AsyncSession = Depends(get_db)):
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        raise HTTPException(404, "Invalid ticket")
    if not guest.partner_guest_id:
        return {"ok": True}
    partner = await db.get(Guest, guest.partner_guest_id)
    guest.partner_guest_id = None
    if partner and partner.partner_guest_id == guest.id:
        partner.partner_guest_id = None
    await db.commit()
    return {"ok": True}


@router.post("/{qr_token}/menu")
async def submit_menu(qr_token: str, body: GuestMenuSubmit, db: AsyncSession = Depends(get_db)):
    """Public — guest submits or updates their menu selection.

    Body shape: {single: {cat_id: item_id}, multi: {cat_id: [item_ids]}, combo: {cat_id: combo_id}}
    Per-category validation runs against the category's selection_type.
    """
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        raise HTTPException(status_code=404, detail="Invalid ticket")
    event = await db.get(Event, guest.event_id)
    if not event or not event.menu_enabled:
        raise HTTPException(status_code=400, detail="Menu selection is not enabled for this event")
    if event.status != "active":
        raise HTTPException(status_code=400, detail="Menu selection is only available while the event is active")
    if not guest.admitted:
        raise HTTPException(status_code=400, detail="Menu unlocks at check-in")
    if guest.meal_served:
        raise HTTPException(status_code=400, detail="Your meal has been served — selection is locked")

    # Index this event's categories by id for validation.
    cats = (await db.execute(
        select(MenuCategory).where(MenuCategory.event_id == guest.event_id)
    )).scalars().all()
    cats_by_id = {c.id: c for c in cats}

    # Required-category check: every is_required category must have a choice.
    submitted_cat_ids = set((body.single or {}).keys()) \
        | set((body.multi or {}).keys()) \
        | set((body.combo or {}).keys())
    for c in cats:
        if c.is_required and c.id not in submitted_cat_ids:
            raise HTTPException(400, f"{c.name} is required — please make a selection")

    touched_cat_ids: set[str] = set()
    new_rows: list[GuestMenuChoice] = []

    # --- single ---
    for cat_id, item_id in (body.single or {}).items():
        cat = cats_by_id.get(cat_id)
        if not cat or cat.selection_type != "single":
            raise HTTPException(400, f"Category {cat_id} does not accept a single choice")
        item = await db.get(MenuItem, item_id)
        if not item or item.category_id != cat_id:
            raise HTTPException(400, f"Item {item_id} doesn't belong to category {cat_id}")
        touched_cat_ids.add(cat_id)
        new_rows.append(GuestMenuChoice(guest_id=guest.id, category_id=cat_id, menu_item_id=item_id))

    # --- multi ---
    for cat_id, item_ids in (body.multi or {}).items():
        cat = cats_by_id.get(cat_id)
        if not cat or cat.selection_type != "multi":
            raise HTTPException(400, f"Category {cat_id} does not accept multiple choices")
        n = len(item_ids)
        if n < (cat.min_selections or 0):
            raise HTTPException(400, f"{cat.name}: pick at least {cat.min_selections}")
        if cat.max_selections is not None and n > cat.max_selections:
            raise HTTPException(400, f"{cat.name}: pick at most {cat.max_selections}")
        for iid in item_ids:
            item = await db.get(MenuItem, iid)
            if not item or item.category_id != cat_id:
                raise HTTPException(400, f"Item {iid} doesn't belong to {cat.name}")
            new_rows.append(GuestMenuChoice(guest_id=guest.id, category_id=cat_id, menu_item_id=iid))
        touched_cat_ids.add(cat_id)

    # --- combo ---
    for cat_id, combo_id in (body.combo or {}).items():
        cat = cats_by_id.get(cat_id)
        if not cat or cat.selection_type != "combo":
            raise HTTPException(400, f"Category {cat_id} does not accept a combo")
        combo = await db.get(MenuCombination, combo_id)
        if not combo or combo.category_id != cat_id:
            raise HTTPException(400, f"Combo {combo_id} doesn't belong to {cat.name}")
        touched_cat_ids.add(cat_id)
        new_rows.append(GuestMenuChoice(guest_id=guest.id, category_id=cat_id, combination_id=combo_id))

    # Replace existing choices for the touched categories.
    if touched_cat_ids:
        await db.execute(
            GuestMenuChoice.__table__.delete().where(
                GuestMenuChoice.guest_id == guest.id,
                GuestMenuChoice.category_id.in_(touched_cat_ids),
            )
        )
    for row in new_rows:
        db.add(row)

    await db.commit()
    return {"ok": True, "saved": len(new_rows)}
