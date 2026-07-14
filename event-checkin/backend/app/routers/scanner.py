import html as html_escape
import json
from datetime import datetime
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Request
from fastapi.responses import Response, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from ..database import get_db
from ..models import ConsentForm, ConsentSignature, Guest, Event, EventUser, User, SeatingTable, MenuCategory, MenuItem, GuestMenuChoice, MenuCombination, MenuCombinationItem, Zone, TicketType, ScanEvent, TableGroup, Gate, GuestTag, GuestTagLink, ZoneTagRule
from ..schemas import ConsentSignatureCreate, ExperienceNextStepOut, ExperienceStepOut, GuestExperienceProgressOut, PublicConsentOut, SendConsentCopyOut, ScanResult, GuestOut, TicketView, EventBrief, MenuCategoryOut, MenuItemOut, MenuCombinationOut, MenuCombinationItemOut, GuestMenuSubmit, PartnerInfo, PairRequest, ScanZoneRequest, ScanZoneResult
from ..auth import require_official, _org_role
from .access import zone_occupancy, ticket_allows
from ..entitlements import can_use_paid_channels, last_credit_ledger_id, take_message_credit
from ..channels import channels_for_flow
from services.email_service import send_admission_email, send_simple_email
from services import messaging
from services.credit_ledger import send_with_credit_ledger
from services.qr_service import generate_qr_bytes, generate_qr_for_url
from . import broadcast
from .seating import assign_next_seat
from ..timeutil import event_tz, local_hhmm
from ..template_resolve import load_overrides, channel_text as template_channel_text, channel_text_or_default as template_channel_or_default, email_override as template_email_override, email_or_default as template_email_or_default
from services.templates import build_context as build_template_context
from ..services.experience import active_workflow, next_guest_steps, sync_guest_progress

router = APIRouter()


def _experience_template_key(event: Event | None, default_key: str, experience_key: str) -> str:
    return experience_key if event and event.experience_enabled else default_key


def _template_channel_for_event(overrides: dict, event: Event | None, default_key: str, experience_key: str, channel: str, context: dict) -> str | None:
    if event and event.experience_enabled:
        return template_channel_or_default(overrides, experience_key, channel, context)
    return template_channel_text(overrides, default_key, channel, context)


def _template_email_for_event(overrides: dict, event: Event | None, default_key: str, experience_key: str, context: dict) -> tuple[str | None, str | None]:
    if event and event.experience_enabled:
        return template_email_or_default(overrides, experience_key, context)
    return template_email_override(overrides, default_key, context)


async def _guest_by_token(qr_token: str, db: AsyncSession) -> tuple[Guest, Event]:
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        raise HTTPException(404, "Guest ticket not found")
    event = await db.get(Event, guest.event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return guest, event


@router.get("/{qr_token}/hub", include_in_schema=False)
async def open_live_program_hub(qr_token: str, db: AsyncSession = Depends(get_db)):
    """Guest-only companion to the staff admission QR route.

    The pass QR and staff POST scan remain unchanged; this explicit GET route
    simply opens the same guest's Hub, optionally focused on timed feedback.
    """
    guest, event = await _guest_by_token(qr_token, db)
    token = guest.invite_token or guest.qr_token
    base = (event.checkin_base_url or "").rstrip("/")
    return RedirectResponse(url=f"{base}/r/{token}?focus=feedback#guest-hub", status_code=302)


async def _active_consent_form(event_id: str, db: AsyncSession) -> ConsentForm | None:
    return await db.scalar(
        select(ConsentForm)
        .where(ConsentForm.event_id == event_id, ConsentForm.is_active.is_(True))
        .order_by(ConsentForm.version.desc(), ConsentForm.created_at.desc())
        .limit(1)
    )


async def _guest_consent_signature(form_id: str, guest_id: str, db: AsyncSession) -> ConsentSignature | None:
    return await db.scalar(
        select(ConsentSignature)
        .where(ConsentSignature.form_id == form_id, ConsentSignature.guest_id == guest_id)
        .limit(1)
    )


def _consent_download_html(event: Event, guest: Guest, form: ConsentForm, signature: ConsentSignature) -> str:
    signed_at = signature.signed_at.strftime("%Y-%m-%d %H:%M UTC") if signature.signed_at else ""
    body = "<br>".join(html_escape.escape(form.body).splitlines())
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{html_escape.escape(form.title)}</title>
<style>body{{font-family:Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#0f172a;line-height:1.55}}.box{{border:1px solid #cbd5e1;border-radius:8px;padding:16px;margin:18px 0}}dt{{font-weight:700}}dd{{margin:0 0 8px}}</style></head>
<body>
<h1>{html_escape.escape(form.title)}</h1>
<p><strong>Event:</strong> {html_escape.escape(event.name)}</p>
<p><strong>Guest:</strong> {html_escape.escape((guest.first_name or '') + ' ' + (guest.last_name or ''))}</p>
<div class="box">{body}</div>
<dl>
<dt>Signed by</dt><dd>{html_escape.escape(signature.signer_name)}</dd>
<dt>Signature</dt><dd>{html_escape.escape(signature.signature_text)}</dd>
<dt>Form version</dt><dd>{form.version}</dd>
<dt>Signed at</dt><dd>{signed_at}</dd>
</dl>
</body></html>"""


def _pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _json_list(raw: str | None):
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else None
    except Exception:
        return None


def _consent_pdf_bytes(event: Event, guest: Guest, form: ConsentForm, signature: ConsentSignature) -> bytes:
    """Small dependency-free PDF for signed consent copies.

    It intentionally uses plain wrapped text so we do not add a production PDF
    dependency before the real release path is decided.
    """
    guest_name = f"{guest.first_name or ''} {guest.last_name or ''}".strip()
    signed_at = signature.signed_at.strftime("%Y-%m-%d %H:%M UTC") if signature.signed_at else ""
    lines = [
        form.title,
        "",
        f"Event: {event.name}",
        f"Guest: {guest_name}",
        f"Form version: {form.version}",
        "",
        *form.body.splitlines(),
        "",
        f"Signed by: {signature.signer_name}",
        f"Signature: {signature.signature_text}",
        f"Signed at: {signed_at}",
    ]
    wrapped: list[str] = []
    for line in lines:
        text = line.strip()
        if not text:
            wrapped.append("")
            continue
        while len(text) > 88:
            cut = text.rfind(" ", 0, 88)
            if cut <= 0:
                cut = 88
            wrapped.append(text[:cut])
            text = text[cut:].strip()
        wrapped.append(text)

    stream_lines = ["BT", "/F1 11 Tf", "50 760 Td", "14 TL"]
    for idx, line in enumerate(wrapped[:48]):
        if idx:
            stream_lines.append("T*")
        stream_lines.append(f"({_pdf_text(line)}) Tj")
    stream_lines.append("ET")
    stream = "\n".join(stream_lines).encode("latin-1", errors="replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{i} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref_at = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode("ascii"))
    return bytes(pdf)


def _progress_out(row):
    return GuestExperienceProgressOut(
        id=row.id,
        event_id=row.event_id,
        workflow_id=row.workflow_id,
        step_id=row.step_id,
        guest_id=row.guest_id,
        status=row.status,
        completed_at=row.completed_at,
        completed_by_user_id=row.completed_by_user_id,
        completed_by_source=row.completed_by_source,
        override_reason=row.override_reason,
        metadata=row.progress_metadata,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _next_steps_for_scan(event_id: str, guest_id: str, db: AsyncSession) -> list[ExperienceNextStepOut]:
    rows = await next_guest_steps(event_id, guest_id, db)
    return [
        ExperienceNextStepOut(
            step=ExperienceStepOut.model_validate(step),
            progress=_progress_out(progress) if progress else None,
        )
        for step, progress in rows
    ]


def _step_message_config(step) -> dict:
    config = step.config or {}
    messages = config.get("messages") if isinstance(config.get("messages"), dict) else {}
    return {
        "guest_message": messages.get("guest") or config.get("guest_message"),
        "staff_prompt": messages.get("staff") or config.get("staff_prompt"),
        "completion_message": messages.get("complete") or config.get("completion_message"),
    }


def _step_email_payload(item: ExperienceNextStepOut, ticket_url: str | None) -> dict:
    message_config = _step_message_config(item.step)
    config = item.step.config or {}
    return {
        "title": item.step.title,
        "key": item.step.key,
        "type": item.step.type,
        "required": item.step.required,
        "description": item.step.description,
        "session": config.get("session") if isinstance(config.get("session"), dict) else None,
        **message_config,
        "action_url": f"{ticket_url}#consent" if item.step.type == "consent" and ticket_url else ticket_url,
    }


def _experience_session_text(session: dict | None) -> str:
    if not isinstance(session, dict):
        return ""
    parts = [str(session[key]) for key in ("topic", "date") if session.get(key)]
    times = " - ".join(str(session.get(key)) for key in ("start_time", "end_time") if session.get(key))
    if times:
        parts.append(times)
    if session.get("room"):
        parts.append(str(session["room"]))
    if session.get("speaker"):
        parts.append(f"Speaker: {session['speaker']}")
    return " · ".join(parts)


async def _queue_experience_next_steps_email(
    background_tasks: BackgroundTasks,
    event: Event,
    guest: Guest,
    db: AsyncSession,
    overrides: dict | None = None,
) -> bool:
    if not event.notify_email or not guest.email:
        return False
    rows = await next_guest_steps(event.id, guest.id, db)
    if not rows:
        return False

    ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}" if event.checkin_base_url else ""
    list_items = []
    text_items = []
    for step, _progress in rows:
        config = step.config or {}
        messages = config.get("messages") if isinstance(config.get("messages"), dict) else {}
        description = (messages.get("guest") or config.get("guest_message") or step.description or "").strip()
        session = _experience_session_text(config.get("session"))
        if session:
            description = f"{description}\n{session}" if description else session
        action = (
            f'<br><a href="{html_escape.escape(ticket_url + "#consent", quote=True)}">Open consent form</a>'
            if step.type == "consent" and ticket_url else ""
        )
        list_items.append(
            "<li><strong>{title}</strong>{required}{description}{action}</li>".format(
                title=html_escape.escape(step.title),
                required=" <span>(required)</span>" if step.required else "",
                description=f"<br>{html_escape.escape(description)}" if description else "",
                action=action,
            )
        )
        text_items.append(f"{step.title}{' (required)' if step.required else ''}")

    steps_html = f"<ol>{''.join(list_items)}</ol>"
    steps_text = "; ".join(text_items)
    ctx = build_template_context(
        event,
        guest,
        extras={
            "ticket_link": ticket_url,
            "qr_code": ticket_url,
            "experience_steps": steps_html,
            "experience_steps_text": steps_text,
        },
    )
    subj, body = template_email_or_default(overrides or {}, "experience_next_steps", ctx)
    if not body:
        return False
    background_tasks.add_task(send_simple_email, guest.email, subj or f"Your next steps — {event.name}", body, event.id, None, guest.id, "experience_next_steps")
    return True


async def _experience_defers_seating(event: Event | None, db: AsyncSession) -> bool:
    if not event or not event.experience_enabled:
        return False
    workflow = await active_workflow(event.id, db)
    if not workflow:
        return False
    return any(step.enabled and step.type == "room_assignment" for step in workflow.steps)


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


async def queue_admission_email(background_tasks: BackgroundTasks, event: Event, guest: Guest, db: AsyncSession) -> bool:
    """Queue the same admitted email used by live check-in without changing check-in state."""
    if not event.notify_email or not guest.email:
        return False

    table_name = None
    if guest.table_id:
        tbl = await db.get(SeatingTable, guest.table_id)
        if tbl:
            table_name = tbl.name

    menu_lines: list[tuple[str, str]] = []
    if event.menu_enabled:
        rows = (await db.execute(
            select(MenuCategory.name, MenuItem.name)
            .join(GuestMenuChoice, GuestMenuChoice.category_id == MenuCategory.id)
            .join(MenuItem, MenuItem.id == GuestMenuChoice.menu_item_id)
            .where(GuestMenuChoice.guest_id == guest.id)
            .order_by(MenuCategory.sort_order, MenuCategory.name)
        )).all()
        menu_lines = [(cat, item) for cat, item in rows]

    ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}" if event.checkin_base_url else None
    hub_url = f"{event.checkin_base_url.rstrip('/')}/r/{guest.invite_token}#guest-hub" if event.checkin_base_url and guest.invite_token else None
    guest_data = {
        "guest_id": guest.id,
        "first_name": guest.first_name,
        "last_name": guest.last_name,
        "email": guest.email,
        "phone": guest.phone,
        "admitted_at": guest.admitted_at or datetime.utcnow(),
        "table_name": table_name,
        "seat_number": guest.seat_number,
        "menu_choices": menu_lines,
        "event_name": event.name,
        "event_id": event.id,
        "event_timezone": event.timezone,
        "message_kind": "experience_admission" if event.experience_enabled else "admission",
        "ticket_url": ticket_url,
        "hub_url": hub_url,
        "menu_enabled": bool(event.menu_enabled),
    }

    overrides = await load_overrides(event.id, db)
    tmpl_ctx = build_template_context(
        event, guest, extras={"table_name": table_name or "", "ticket_link": ticket_url or "", "qr_code": ticket_url or ""}
    )
    subj, intro = _template_email_for_event(overrides, event, "admission_confirmation", "experience_admission_confirmation", tmpl_ctx)
    guest_data["subject_override"] = subj
    guest_data["intro_block_override"] = intro
    background_tasks.add_task(send_admission_email, guest_data)
    await _queue_experience_next_steps_email(background_tasks, event, guest, db, overrides)
    return True


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
        partner_pairing_enabled=event.partner_pairing_enabled,
        experience_enabled=event.experience_enabled,
        live_program_enabled=event.live_program_enabled,
        checkout_enabled=event.checkout_enabled,
        menu_enabled=event.menu_enabled,
        notify_sms=event.notify_sms,
        notify_whatsapp=event.notify_whatsapp,
        registry_enabled=event.registry_enabled,
        registry_token=event.registry_token,
        registry_message=event.registry_message,
        festiome_addon_enabled=event.festiome_addon_enabled,
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


@router.get("/{qr_token}/consent", response_model=PublicConsentOut)
async def view_consent(qr_token: str, db: AsyncSession = Depends(get_db)):
    try:
        guest, event = await _guest_by_token(qr_token, db)
    except HTTPException:
        return PublicConsentOut(status="invalid")
    if not guest.admitted:
        return PublicConsentOut(status="not_admitted")
    form = await _active_consent_form(event.id, db)
    if not form:
        return PublicConsentOut(status="none")
    signature = await _guest_consent_signature(form.id, guest.id, db)
    return PublicConsentOut(status="signed" if signature else "available", form=form, signature=signature)


@router.post("/{qr_token}/consent", response_model=PublicConsentOut)
async def sign_consent(
    qr_token: str,
    data: ConsentSignatureCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    guest, event = await _guest_by_token(qr_token, db)
    if not guest.admitted:
        raise HTTPException(409, "Consent is available after check-in")
    form = await _active_consent_form(event.id, db)
    if not form:
        raise HTTPException(404, "Consent form not found")
    existing = await _guest_consent_signature(form.id, guest.id, db)
    if existing:
        return PublicConsentOut(status="signed", form=form, signature=existing)
    now = datetime.utcnow()
    signature = ConsentSignature(
        event_id=event.id,
        form_id=form.id,
        guest_id=guest.id,
        signer_name=data.signer_name,
        signature_text=data.signature_text,
        signed_at=now,
        ip_address=request.client.host if request.client else None,
        user_agent=(request.headers.get("user-agent") or "")[:500],
    )
    db.add(signature)
    await db.flush()
    await sync_guest_progress(event.id, guest.id, db, source="guest")
    await db.commit()
    await db.refresh(signature)
    return PublicConsentOut(status="signed", form=form, signature=signature)


@router.get("/{qr_token}/consent/download")
async def download_consent(qr_token: str, db: AsyncSession = Depends(get_db)):
    guest, event = await _guest_by_token(qr_token, db)
    if not guest.admitted:
        raise HTTPException(409, "Consent is available after check-in")
    form = await _active_consent_form(event.id, db)
    if not form:
        raise HTTPException(404, "Consent form not found")
    signature = await _guest_consent_signature(form.id, guest.id, db)
    if not signature:
        raise HTTPException(404, "Consent has not been signed yet")
    filename = f"consent-{guest.first_name}-{guest.last_name or guest.id}.html".replace(" ", "-")
    return Response(
        content=_consent_download_html(event, guest, form, signature),
        media_type="text/html",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/{qr_token}/consent/download.pdf")
async def download_consent_pdf(qr_token: str, db: AsyncSession = Depends(get_db)):
    guest, event = await _guest_by_token(qr_token, db)
    if not guest.admitted:
        raise HTTPException(409, "Consent is available after check-in")
    form = await _active_consent_form(event.id, db)
    if not form:
        raise HTTPException(404, "Consent form not found")
    signature = await _guest_consent_signature(form.id, guest.id, db)
    if not signature:
        raise HTTPException(404, "Consent has not been signed yet")
    filename = f"consent-{guest.first_name}-{guest.last_name or guest.id}.pdf".replace(" ", "-")
    return Response(
        content=_consent_pdf_bytes(event, guest, form, signature),
        media_type="application/pdf",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


async def queue_consent_copy_email(
    background_tasks: BackgroundTasks,
    event: Event,
    guest: Guest,
    db: AsyncSession,
) -> bool:
    if not guest.email:
        raise HTTPException(400, "This guest does not have an email address")
    form = await _active_consent_form(event.id, db)
    if not form:
        raise HTTPException(404, "Consent form not found")
    signature = await _guest_consent_signature(form.id, guest.id, db)
    if not signature:
        raise HTTPException(404, "Consent has not been signed yet")
    base_url = (event.checkin_base_url or "").rstrip("/") or "https://festio.events"
    download_url = f"{base_url}/api/scan/{guest.qr_token}/consent/download"
    subject = f"Signed consent copy — {event.name}"
    body = f"""
    <p>Hi {html_escape.escape(guest.first_name)},</p>
    <p>Your signed consent copy for <strong>{html_escape.escape(event.name)}</strong> is ready.</p>
    <p><a href="{html_escape.escape(download_url)}">Download signed consent copy</a></p>
    <p>Signed by {html_escape.escape(signature.signer_name)} on {signature.signed_at.strftime("%Y-%m-%d %H:%M UTC")}.</p>
    """
    if event.experience_enabled:
        overrides = await load_overrides(event.id, db)
        ctx = build_template_context(event, guest, extras={"download_link": download_url})
        tmpl_subject, tmpl_body = template_email_or_default(overrides, "experience_consent_copy", ctx)
        if tmpl_body:
            subject = tmpl_subject or subject
            body = tmpl_body + (
                f"<p>Signed by {html_escape.escape(signature.signer_name)} "
                f"on {signature.signed_at.strftime('%Y-%m-%d %H:%M UTC')}.</p>"
            )
    filename = f"consent-{guest.first_name}-{guest.last_name or guest.id}.pdf".replace(" ", "-")
    background_tasks.add_task(
        send_simple_email,
        guest.email,
        subject,
        body,
        event.id,
        [(filename, _consent_pdf_bytes(event, guest, form, signature), "application/pdf")],
        guest.id,
        "experience_consent_copy",
    )
    signature.sent_copy_at = datetime.utcnow()
    await db.commit()
    return True


@router.post("/{qr_token}/consent/send-copy", response_model=SendConsentCopyOut)
async def send_consent_copy(
    qr_token: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    guest, event = await _guest_by_token(qr_token, db)
    if not guest.admitted:
        raise HTTPException(409, "Consent is available after check-in")
    await queue_consent_copy_email(background_tasks, event, guest, db)
    return SendConsentCopyOut(ok=True, sent_to=guest.email)


@router.get("/{qr_token}/qr.png")
async def ticket_qr_image(qr_token: str, db: AsyncSession = Depends(get_db)):
    """Public — QR image for the guest's own ticket page."""
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        return Response(status_code=404)
    event = await db.get(Event, guest.event_id)
    base_url = event.checkin_base_url if event else "https://festio.events"
    return Response(content=generate_qr_bytes(qr_token, base_url), media_type="image/png")


@router.get("/{qr_token}/checkout-qr.png")
async def ticket_checkout_qr_image(qr_token: str, db: AsyncSession = Depends(get_db)):
    """Public — distinct QR payload for normal-event checkout/exit scans."""
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        return Response(status_code=404)
    event = await db.get(Event, guest.event_id)
    if not event or not event.checkout_enabled:
        return Response(status_code=404)
    return Response(content=generate_qr_for_url(f"festio-checkout:{qr_token}"), media_type="image/png")


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

    base_url = event.checkin_base_url or "https://festio.events"
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
        event_timezone=event.timezone,
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


@router.get("/offline-manifest/{event_id}")
async def offline_manifest(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_official),
):
    event = await db.get(Event, event_id)
    blocked = await checkin_guard(event, current_user, db)
    if blocked:
        raise HTTPException(403, blocked.message)
    guests = (await db.execute(
        select(Guest).where(Guest.event_id == event_id).order_by(Guest.last_name, Guest.first_name)
    )).scalars().all()
    table_ids = {g.table_id for g in guests if g.table_id}
    tables = {}
    if table_ids:
        rows = (await db.execute(select(SeatingTable).where(SeatingTable.id.in_(table_ids)))).scalars().all()
        tables = {t.id: t.name for t in rows}
    zones = (await db.execute(
        select(Zone).where(Zone.event_id == event_id).order_by(Zone.sort_order, Zone.created_at)
    )).scalars().all() if event and event.venue_access_enabled else []
    gates = (await db.execute(
        select(Gate).where(Gate.event_id == event_id, Gate.is_active.is_(True)).order_by(Gate.created_at)
    )).scalars().all() if zones else []
    ticket_types = (await db.execute(
        select(TicketType).where(TicketType.event_id == event_id).order_by(TicketType.sort_order, TicketType.created_at)
    )).scalars().all() if zones else []
    tag_links = (await db.execute(
        select(GuestTagLink).join(Guest, Guest.id == GuestTagLink.guest_id).where(Guest.event_id == event_id)
    )).scalars().all() if zones else []
    tags = (await db.execute(
        select(GuestTag).where(GuestTag.event_id == event_id)
    )).scalars().all() if zones else []
    zone_tag_rules = (await db.execute(
        select(ZoneTagRule).join(Zone, Zone.id == ZoneTagRule.zone_id).where(Zone.event_id == event_id)
    )).scalars().all() if zones else []
    zone_occupancies = {z.id: await zone_occupancy(z.id, db) for z in zones}
    return {
        "event_id": event_id,
        "event_name": event.name if event else "",
        "venue_access_enabled": bool(event and event.venue_access_enabled),
        "generated_at": datetime.utcnow().isoformat(),
        "guests": [{
            "id": g.id,
            "event_id": g.event_id,
            "first_name": g.first_name,
            "last_name": g.last_name,
            "email": g.email,
            "phone": g.phone,
            "qr_token": g.qr_token,
            "admitted": bool(g.admitted),
            "admitted_at": g.admitted_at.isoformat() if g.admitted_at else None,
            "table_name": tables.get(g.table_id or ""),
            "seat_number": g.seat_number,
            "is_vip": bool(g.is_vip),
            "rsvp_status": g.rsvp_status,
            "ticket_type_id": g.ticket_type_id,
        } for g in guests if g.qr_token],
        "zones": [{
            "id": z.id,
            "event_id": z.event_id,
            "name": z.name,
            "capacity": z.capacity,
            "direction_mode": z.direction_mode,
            "is_active": bool(z.is_active),
            "occupancy": zone_occupancies.get(z.id, 0),
        } for z in zones],
        "gates": [{
            "id": g.id,
            "event_id": g.event_id,
            "name": g.name,
            "zone_id": g.zone_id,
            "direction": g.direction,
            "is_active": bool(g.is_active),
        } for g in gates],
        "ticket_types": [{
            "id": tt.id,
            "name": tt.name,
            "allowed_zone_ids": _json_list(tt.allowed_zone_ids),
        } for tt in ticket_types],
        "guest_tag_links": [{"guest_id": row.guest_id, "tag_id": row.tag_id} for row in tag_links],
        "guest_tags": [{"id": tag.id, "name": tag.name} for tag in tags],
        "zone_tag_rules": [{"zone_id": row.zone_id, "tag_id": row.tag_id} for row in zone_tag_rules],
    }


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
    if not event:
        return ScanResult(status="invalid", message="Event not found for this ticket.")
    blocked = await checkin_guard(event, current_user, db)
    if blocked:
        return blocked
    return await perform_admission(guest, event, background_tasks, db)


@router.post("/{qr_token}/checkout", response_model=ScanResult)
async def scan_qr_checkout(
    qr_token: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_official),
):
    guest = (await db.execute(select(Guest).where(Guest.qr_token == qr_token))).scalar_one_or_none()
    if not guest:
        return ScanResult(status="invalid", message="Invalid QR code. This ticket was not found.")
    event = await db.get(Event, guest.event_id)
    if not event:
        return ScanResult(status="invalid", message="Event not found for this ticket.")
    if not event.checkout_enabled:
        return ScanResult(
            status="checkout_disabled",
            message="Check-out is not enabled for this event.",
        )
    blocked = await checkin_guard(event, current_user, db)
    if blocked:
        return blocked
    if not guest.admitted:
        return ScanResult(
            status="not_checked_in",
            message=f"{guest.first_name} {guest.last_name} has not checked in yet.",
            guest=GuestOut.model_validate(guest),
        )

    last_normal_scan = await db.scalar(
        select(ScanEvent)
        .where(ScanEvent.event_id == event.id, ScanEvent.guest_id == guest.id, ScanEvent.zone_id.is_(None), ScanEvent.denied.is_(False))
        .order_by(ScanEvent.scanned_at.desc())
        .limit(1)
    )
    if last_normal_scan and last_normal_scan.direction == "out":
        return ScanResult(
            status="already_checked_out",
            message=f"{guest.first_name} {guest.last_name} was already checked out at {local_hhmm(last_normal_scan.scanned_at, event_tz(event)) or 'unknown'}.",
            guest=GuestOut.model_validate(guest),
        )

    db.add(ScanEvent(event_id=event.id, guest_id=guest.id, zone_id=None, direction="out", scanned_by=current_user.id))
    await db.commit()
    # Reflect the check-out into the guest's experience progress (completes the
    # check_out step + records an ExperienceEvent). Best-effort — never block.
    if event.experience_enabled:
        try:
            await sync_guest_progress(event.id, guest.id, db, source="staff", actor_user_id=current_user.id)
        except Exception:
            pass
    await broadcast(event.id, {
        "type": "checked_out",
        "guest_id": guest.id,
        "name": f"{guest.first_name} {guest.last_name}",
        "email": guest.email,
        "checked_out_at": datetime.utcnow().isoformat(),
    })
    return ScanResult(
        status="checked_out",
        message=f"{guest.first_name} {guest.last_name} has been checked out.",
        guest=GuestOut.model_validate(guest),
    )


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
        admitted_time = local_hhmm(guest.admitted_at, event_tz(event)) or "unknown"
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
            experience_next_steps=await _next_steps_for_scan(event.id, guest.id, db) if event else [],
        )

    # First-come-first-served seat assignment if this guest has no seat yet.
    # Honors couple pairings + table-group restrictions (see assign_next_seat).
    # Keyed on seat_number (not table_id) so pre-assigned-table guests still get a seat.
    defer_seating_to_experience = await _experience_defers_seating(event, db)
    if event and event.seating_enabled and not guest.seat_number and not defer_seating_to_experience:
        seat_error = await assign_next_seat(guest, db)
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
        # Strict seating: an ungrouped guest who still has no seat (their pre-
        # assigned table is full, or every table is full) is blocked rather than
        # admitted seatless. Nothing was committed, so they stay un-admitted.
        if seat_error and not guest.seat_number:
            return ScanResult(
                status="no_seat_available",
                message=f"No seat available for {guest.first_name} {guest.last_name}: {seat_error}",
                guest=GuestOut.model_validate(guest),
            )
        # Surface a concurrent seat collision at a controlled point: the
        # table-name lookup below would otherwise autoflush our freshly-picked
        # seat and raise mid-flight if another scanner just took it.
        if guest.table_id and guest.seat_number:
            try:
                await db.flush()
            except IntegrityError:
                await db.rollback()
                return ScanResult(
                    status="no_seat_available",
                    message=f"That seat was just taken — please scan "
                            f"{guest.first_name} {guest.last_name} again.",
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
    try:
        await db.commit()
    except IntegrityError:
        # Another scanner grabbed this exact seat between our FCFS pick and our
        # commit (the unique index rejected the duplicate). Roll back and ask for
        # a re-scan rather than 500 — the next scan picks the now-correct seat.
        await db.rollback()
        return ScanResult(
            status="no_seat_available",
            message=f"That seat was just taken — please scan {guest.first_name} "
                    f"{guest.last_name} again.",
        )
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
    hub_url = None
    if event and event.checkin_base_url:
        ticket_url = f"{event.checkin_base_url.rstrip('/')}/scan/{guest.qr_token}"
        if guest.invite_token:
            hub_url = f"{event.checkin_base_url.rstrip('/')}/r/{guest.invite_token}#guest-hub"

    guest_data = {
        "guest_id": guest.id,
        "first_name": guest.first_name,
        "last_name": guest.last_name,
        "email": guest.email,
        "phone": guest.phone,
        "admitted_at": guest.admitted_at,
        "table_name": table_name,
        "seat_number": guest.seat_number,
        "menu_choices": menu_lines,
        "event_name": event.name if event else None,
        "event_id": event.id if event else None,
        "event_timezone": event.timezone if event else None,
        "message_kind": "experience_admission" if event and event.experience_enabled else "admission",
        "ticket_url": ticket_url,
        "hub_url": hub_url,
        "menu_enabled": bool(event and event.menu_enabled),
    }
    paid = can_use_paid_channels(event) if event else False
    # Customizable-template overrides for the check-in messages (fall back to the
    # built-in copy when a channel has no override).
    overrides = await load_overrides(event.id, db) if event else {}
    tmpl_ctx = build_template_context(
        event, guest, extras={"table_name": table_name or "", "ticket_link": ticket_url or "", "qr_code": ticket_url or ""}
    )
    chosen = channels_for_flow(event, guest, "admission", paid_ok=paid)
    if "sms" in chosen and take_message_credit(event, "sms"):
        sms_text = _template_channel_for_event(overrides, event, "admission_confirmation", "experience_admission_confirmation", "sms", tmpl_ctx)
        if sms_text is not None:
            background_tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_custom_sms, phone=guest.phone, body=sms_text)
        else:
            background_tasks.add_task(
                send_with_credit_ledger,
                last_credit_ledger_id(event),
                messaging.send_admission_sms,
                phone=guest.phone, first_name=guest.first_name,
                event_name=event.name if event else "the event",
                admitted_at=guest.admitted_at,
                table_name=table_name, seat_number=guest.seat_number,
                event_timezone=event.timezone if event else None,
            )
    if "whatsapp" in chosen and take_message_credit(event, "whatsapp"):
        # WhatsApp initiates → approved template only (free-text overrides 15003).
        background_tasks.add_task(
            send_with_credit_ledger,
            last_credit_ledger_id(event),
            messaging.send_admission_whatsapp,
            phone=guest.phone, first_name=guest.first_name,
            event_name=event.name if event else "the event",
            table_name=table_name, seat_number=guest.seat_number,
        )
    # MMS (image ticket card) — super-admin-enabled per event. Sends the styled
    # admitted card fetched directly from /api/scan/{token}/card.jpg.
    if ("mms" in chosen and messaging.mms_ready() and event.checkin_base_url and take_message_credit(event, "mms")):
        mms_text = (_template_channel_for_event(overrides, event, "admission_confirmation", "experience_admission_confirmation", "mms", tmpl_ctx)
                    or _template_channel_for_event(overrides, event, "admission_confirmation", "experience_admission_confirmation", "sms", tmpl_ctx)
                    or f"Welcome {guest.first_name}! You're checked in to {event.name}.")
        card_url = f"{event.checkin_base_url.rstrip('/')}/api/scan/{guest.qr_token}/card.jpg?admitted=true"
        background_tasks.add_task(send_with_credit_ledger, last_credit_ledger_id(event), messaging.send_mms, phone=guest.phone, body=mms_text, media_url=card_url)
    await db.commit()  # persist message-credit decrements
    await sync_guest_progress(event.id, guest.id, db, source="staff", actor_user_id=None)
    await db.commit()
    experience_next = await _next_steps_for_scan(event.id, guest.id, db) if event else []
    if "email" in chosen:
        subj, intro = _template_email_for_event(overrides, event, "admission_confirmation", "experience_admission_confirmation", tmpl_ctx)
        guest_data["subject_override"] = subj
        guest_data["intro_block_override"] = intro
        background_tasks.add_task(send_admission_email, guest_data)
        await _queue_experience_next_steps_email(background_tasks, event, guest, db, overrides)

    await broadcast(guest.event_id, {
        "type": "admitted",
        "guest_id": guest.id,
        "name": f"{guest.first_name} {guest.last_name}",
        "email": guest.email,
        "admitted_at": guest.admitted_at.isoformat(),
        "is_walk_in": bool(guest.is_walk_in),
    })

    return ScanResult(
        status="admitted",
        message=f"Welcome, {guest.first_name} {guest.last_name}! You are admitted.",
        guest=GuestOut.model_validate(guest),
        table_name=table_name,
        seat_number=guest.seat_number,
        experience_next_steps=experience_next,
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
        if event.seating_enabled and not guest.seat_number and not await _experience_defers_seating(event, db):
            await assign_next_seat(guest, db)
        await sync_guest_progress(event.id, guest.id, db, source="staff", actor_user_id=current_user.id)
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

    await broadcast(event.id, {
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
    event = await db.get(Event, guest.event_id)
    if not event or not event.seating_enabled or not event.partner_pairing_enabled:
        raise HTTPException(403, "Partner pairing is not enabled for this event.")

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

    await sync_guest_progress(event.id, guest.id, db, source="guest")
    await db.commit()
    return {"ok": True, "saved": len(new_rows)}
