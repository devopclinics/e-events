"""Gift Registry add-on — mark-only (no money moves through the platform).

Organizers list physical items (external buy links), cash funds (a target plus
their own payment instructions), and links to external registries. Guests reserve
items or pledge to funds; the actual purchase/transfer happens off-platform.

Two routers:
  * `router`          — admin endpoints at /api/events, paid-gated + registry_enabled.
  * `registry_router` — public, no-auth, at /api/registry.
"""
import html as _html
import ipaddress
import re
import uuid
from datetime import datetime
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

import httpx
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, Organization, RegistryItem, RegistryClaim, AffiliateStore, User, Guest
from ..schemas import (
    RegistryItemCreate, RegistryItemUpdate, RegistryItemOut,
    RegistrySettingsUpdate, RegistrySettingsOut,
    RegistryClaimCreate, RegistryClaimOut, RegistryPageOut,
    RegistryUnfurlRequest, RegistryUnfurlOut,
)
from ..auth import require_paid_event_admin, require_paid_event_member
from ..entitlements import can_use_paid_channels, take_message_credit
from ..template_resolve import load_overrides, channel_text as template_channel_text, channel_text_or_default, email_or_default
from services import messaging
from services.email_service import send_simple_email
from services.templates import build_context as build_template_context
from .guests import _BROWSER_UA

router = APIRouter()
registry_router = APIRouter()


# ── Affiliate link rewriting ──────────────────────────────────────────────────

async def _active_stores(db: AsyncSession) -> list[AffiliateStore]:
    return list((await db.execute(
        select(AffiliateStore).where(AffiliateStore.active.is_(True))
    )).scalars().all())


def apply_affiliate(url: str | None, stores: list[AffiliateStore]) -> str | None:
    """If url's host matches an active affiliate store, set/replace that store's
    query param with the affiliate id. Returns the (possibly rewritten) url."""
    if not url:
        return url
    try:
        parsed = urlparse(url)
    except Exception:
        return url
    host = (parsed.hostname or "").lower()
    if not host or parsed.scheme not in ("http", "https"):
        return url
    store = next((s for s in stores if host == s.domain.lower() or host.endswith("." + s.domain.lower())), None)
    if not store:
        return url
    q = [(k, v) for (k, v) in parse_qsl(parsed.query, keep_blank_values=True) if k != store.param_key]
    q.append((store.param_key, store.param_value))
    return urlunparse(parsed._replace(query=urlencode(q)))


# ── helpers ───────────────────────────────────────────────────────────────────

async def _registry_event(event_id: str, db: AsyncSession) -> Event:
    ev = await db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    if not ev.registry_enabled:
        raise HTTPException(400, "Registry is not enabled for this event")
    return ev


async def _org_currency(event: Event, db: AsyncSession) -> str:
    org = await db.get(Organization, event.org_id)
    return (org.currency if org else None) or "USD"


async def ensure_registry_token(event: Event, db: AsyncSession) -> str:
    """Lazily mint the event's unguessable registry token. Caller's session is
    committed here so the token persists. New events already get one via the
    column default; this backfills events created before the token existed."""
    if not event.registry_token:
        event.registry_token = str(uuid.uuid4())
        await db.commit()
        await db.refresh(event)
    return event.registry_token


async def _claim_totals(item_id: str, db: AsyncSession) -> tuple[int, int, int]:
    """Returns (reserved_qty, raised_minor, claim_count) for an item."""
    row = (await db.execute(
        select(
            func.coalesce(func.sum(RegistryClaim.quantity), 0),
            func.coalesce(func.sum(RegistryClaim.amount_minor), 0),
            func.count(RegistryClaim.id),
        ).where(RegistryClaim.item_id == item_id)
    )).one()
    return int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)


async def _item_out(item: RegistryItem, db: AsyncSession,
                    stores: list[AffiliateStore] | None = None) -> RegistryItemOut:
    reserved, raised, count = await _claim_totals(item.id, db)
    remaining = None
    if item.kind == "item":
        remaining = max((item.quantity_wanted or 0) - reserved, 0)
    return RegistryItemOut(
        id=item.id, event_id=item.event_id, kind=item.kind, title=item.title,
        description=item.description, image_url=item.image_url, external_url=item.external_url,
        amount_minor=item.amount_minor, currency=item.currency,
        quantity_wanted=item.quantity_wanted, payment_instructions=item.payment_instructions,
        sort_order=item.sort_order, is_active=item.is_active,
        buy_url=apply_affiliate(item.external_url, stores or []),
        reserved_qty=reserved, remaining=remaining, raised_minor=raised, claim_count=count,
    )


async def _get_item(event_id: str, item_id: str, db: AsyncSession) -> RegistryItem:
    item = await db.get(RegistryItem, item_id)
    if not item or item.event_id != event_id:
        raise HTTPException(404, "Registry item not found")
    return item


# ── Admin: items CRUD ─────────────────────────────────────────────────────────

@router.get("/{event_id}/registry/items", response_model=list[RegistryItemOut])
async def list_items(event_id: str, db: AsyncSession = Depends(get_db),
                     _: User = Depends(require_paid_event_member)):
    await _registry_event(event_id, db)
    rows = (await db.execute(
        select(RegistryItem).where(RegistryItem.event_id == event_id)
        .order_by(RegistryItem.sort_order, RegistryItem.created_at)
    )).scalars().all()
    return [await _item_out(i, db) for i in rows]


@router.post("/{event_id}/registry/items", response_model=RegistryItemOut, status_code=201)
async def create_item(event_id: str, data: RegistryItemCreate, db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    ev = await _registry_event(event_id, db)
    currency = (data.currency or await _org_currency(ev, db)).upper()
    item = RegistryItem(
        event_id=event_id, kind=data.kind, title=data.title, description=data.description,
        image_url=data.image_url, external_url=data.external_url, amount_minor=data.amount_minor,
        currency=currency, quantity_wanted=data.quantity_wanted or 1,
        payment_instructions=data.payment_instructions, sort_order=data.sort_order,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return await _item_out(item, db)


@router.put("/{event_id}/registry/items/{item_id}", response_model=RegistryItemOut)
async def update_item(event_id: str, item_id: str, data: RegistryItemUpdate,
                      db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    await _registry_event(event_id, db)
    item = await _get_item(event_id, item_id, db)
    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "currency" and v:
            v = v.upper()
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return await _item_out(item, db)


@router.delete("/{event_id}/registry/items/{item_id}", status_code=204)
async def delete_item(event_id: str, item_id: str, db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    await _registry_event(event_id, db)
    item = await _get_item(event_id, item_id, db)
    await db.delete(item)
    await db.commit()


@router.get("/{event_id}/registry/settings", response_model=RegistrySettingsOut)
async def get_settings(event_id: str, db: AsyncSession = Depends(get_db),
                       _: User = Depends(require_paid_event_member)):
    ev = await _registry_event(event_id, db)
    token = await ensure_registry_token(ev, db)
    return RegistrySettingsOut(registry_message=ev.registry_message, registry_token=token)


@router.put("/{event_id}/registry/settings", response_model=RegistrySettingsOut)
async def update_settings(event_id: str, data: RegistrySettingsUpdate,
                          db: AsyncSession = Depends(get_db),
                          _: User = Depends(require_paid_event_admin)):
    ev = await _registry_event(event_id, db)
    if data.registry_message is not None:
        ev.registry_message = data.registry_message
    token = await ensure_registry_token(ev, db)
    return RegistrySettingsOut(registry_message=ev.registry_message, registry_token=token)


@router.post("/{event_id}/registry/send-message")
async def send_registry_message(
    event_id: str,
    background_tasks: BackgroundTasks,
    body: dict = Body(default={}),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_paid_event_admin),
):
    """Send the gift-list link to confirmed guests through enabled channels."""
    ev = await _registry_event(event_id, db)
    token = await ensure_registry_token(ev, db)
    requested = body.get("channels") or ["email", "sms", "whatsapp"]
    channels = [c for c in requested if c in {"email", "sms", "whatsapp"}]
    if not channels:
        raise HTTPException(400, "Choose email, SMS and/or WhatsApp")

    base = (ev.checkin_base_url or "").rstrip("/")
    registry_url = f"{base}/registry/{token}" if base else f"/registry/{token}"
    guests = list((await db.execute(
        select(Guest).where(Guest.event_id == event_id, Guest.rsvp_status == "confirmed")
    )).scalars().all())
    overrides = await load_overrides(event_id, db)

    queued = 0
    skipped_no_contact = 0
    skipped_no_credits = 0
    for guest in guests:
        sent_any = False
        ctx = build_template_context(ev, guest, extras={
            "rsvp_link": registry_url,
            "message": ev.registry_message or "",
        })
        if "email" in channels and ev.notify_email and guest.email:
            subj, html = email_or_default(overrides, "registry_message", ctx)
            if html:
                background_tasks.add_task(
                    send_simple_email,
                    guest.email, subj or f"Gift registry — {ev.name}", html, ev.id,
                )
                sent_any = True

        if ("sms" in channels and can_use_paid_channels(ev) and ev.notify_sms
                and guest.phone and guest.sms_consent):
            if take_message_credit(ev):
                sms = channel_text_or_default(overrides, "registry_message", "sms", ctx)
                if sms:
                    background_tasks.add_task(messaging.send_custom_sms, phone=guest.phone, body=sms)
                    sent_any = True
            else:
                skipped_no_credits += 1

        if ("whatsapp" in channels and can_use_paid_channels(ev) and ev.notify_whatsapp
                and guest.phone and guest.whatsapp_consent):
            if take_message_credit(ev):
                wa = template_channel_text(overrides, "registry_message", "whatsapp", ctx)
                if wa is not None:
                    background_tasks.add_task(messaging.send_custom_whatsapp, phone=guest.phone, body=wa)
                else:
                    background_tasks.add_task(
                        messaging.send_registry_whatsapp,
                        phone=guest.phone, event_name=ev.name, registry_url=registry_url,
                    )
                sent_any = True
            else:
                skipped_no_credits += 1

        if sent_any:
            queued += 1
        else:
            skipped_no_contact += 1

    await db.commit()
    return {
        "queued": queued,
        "skipped_no_contact": skipped_no_contact,
        "skipped_no_credits": skipped_no_credits,
    }


@router.get("/{event_id}/registry/claims", response_model=list[RegistryClaimOut])
async def list_claims(event_id: str, db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_member)):
    await _registry_event(event_id, db)
    rows = (await db.execute(
        select(RegistryClaim, RegistryItem)
        .join(RegistryItem, RegistryItem.id == RegistryClaim.item_id)
        .where(RegistryItem.event_id == event_id)
        .order_by(RegistryClaim.created_at.desc())
    )).all()
    return [
        RegistryClaimOut(
            id=c.id, item_id=c.item_id, item_title=i.title,
            claimer_name=c.claimer_name, claimer_email=c.claimer_email,
            quantity=c.quantity, amount_minor=c.amount_minor, message=c.message,
            created_at=c.created_at,
        )
        for c, i in rows
    ]


# ── Link unfurl (auto-fill item details from a product page) ──────────────────

_META_RE = re.compile(r'<meta\b[^>]*>', re.I)
_ATTR_RE = re.compile(r'([\w:-]+)\s*=\s*"([^"]*)"')
_TITLE_RE = re.compile(r'<title[^>]*>(.*?)</title>', re.I | re.S)


def _parse_meta(html_text: str) -> dict:
    props: dict[str, str] = {}
    for tag in _META_RE.findall(html_text):
        attrs = {k.lower(): v for k, v in _ATTR_RE.findall(tag)}
        key = attrs.get("property") or attrs.get("name")
        content = attrs.get("content")
        if key and content is not None:
            props.setdefault(key.lower(), _html.unescape(content.strip()))
    return props


def _is_blocked_host(host: str) -> bool:
    """Lightweight SSRF guard — block loopback/private/link-local/reserved."""
    h = (host or "").lower()
    if not h or h == "localhost" or h.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except ValueError:
        return False  # a hostname (not an IP literal) — allowed


def _price_to_minor(amount: str | None) -> int | None:
    if not amount:
        return None
    try:
        return round(float(str(amount).replace(",", "").strip()) * 100)
    except (ValueError, TypeError):
        return None


@router.post("/{event_id}/registry/unfurl", response_model=RegistryUnfurlOut)
async def unfurl_link(event_id: str, data: RegistryUnfurlRequest,
                      db: AsyncSession = Depends(get_db),
                      _: User = Depends(require_paid_event_admin)):
    """Best-effort: fetch a product page and read its Open Graph/meta tags to
    auto-fill a registry item. Failures return an empty result (fill by hand)."""
    await _registry_event(event_id, db)
    url = (data.url or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(422, "Enter a valid http(s) product link")
    if _is_blocked_host(parsed.hostname):
        raise HTTPException(400, "That URL can't be fetched")
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=15,
            headers={"User-Agent": _BROWSER_UA, "Accept": "text/html,*/*"},
        ) as client:
            resp = await client.get(url)
        text = resp.text[:600000]
    except Exception:
        return RegistryUnfurlOut()  # soft fail — admin fills manually
    meta = _parse_meta(text)
    title = meta.get("og:title")
    if not title:
        m = _TITLE_RE.search(text)
        title = _html.unescape(m.group(1).strip()) if m else None
    amount_minor = _price_to_minor(meta.get("product:price:amount") or meta.get("og:price:amount"))
    currency = (meta.get("product:price:currency") or meta.get("og:price:currency") or "").upper() or None
    return RegistryUnfurlOut(
        title=title, image_url=meta.get("og:image"),
        amount_minor=amount_minor, currency=currency, site_name=meta.get("og:site_name"),
    )


# ── Public registry page (no auth, by unguessable token) ──────────────────────

async def _event_by_token(token: str, db: AsyncSession) -> Event:
    ev = await db.scalar(select(Event).where(Event.registry_token == token))
    if not ev or not ev.registry_enabled:
        raise HTTPException(404, "Registry not found")
    return ev


@registry_router.get("/{token}", response_model=RegistryPageOut)
async def public_registry(token: str, db: AsyncSession = Depends(get_db)):
    ev = await _event_by_token(token, db)
    stores = await _active_stores(db)
    rows = (await db.execute(
        select(RegistryItem)
        .where(RegistryItem.event_id == ev.id, RegistryItem.is_active.is_(True))
        .order_by(RegistryItem.sort_order, RegistryItem.created_at)
    )).scalars().all()
    return RegistryPageOut(
        event_name=ev.name, couples_name=ev.couples_name,
        registry_message=ev.registry_message,
        items=[await _item_out(i, db, stores) for i in rows],
    )


@registry_router.post("/{token}/items/{item_id}/claim", response_model=RegistryItemOut, status_code=201)
async def claim_item(token: str, item_id: str, data: RegistryClaimCreate,
                     db: AsyncSession = Depends(get_db)):
    ev = await _event_by_token(token, db)
    item = await db.get(RegistryItem, item_id)
    if not item or item.event_id != ev.id or not item.is_active:
        raise HTTPException(404, "Registry item not found")
    if item.kind == "link":
        raise HTTPException(400, "External links can't be reserved")
    if not (data.claimer_name or "").strip():
        raise HTTPException(422, "Please enter your name")

    if item.kind == "item":
        qty = max(int(data.quantity or 1), 1)
        reserved, _raised, _c = await _claim_totals(item.id, db)
        if reserved + qty > (item.quantity_wanted or 0):
            raise HTTPException(409, "Sorry — this gift has already been fully reserved")
        db.add(RegistryClaim(
            item_id=item.id, claimer_name=data.claimer_name.strip(),
            claimer_email=data.claimer_email, quantity=qty, message=data.message,
        ))
    else:  # fund
        if not data.amount_minor or data.amount_minor <= 0:
            raise HTTPException(422, "Please enter a contribution amount")
        db.add(RegistryClaim(
            item_id=item.id, claimer_name=data.claimer_name.strip(),
            claimer_email=data.claimer_email, quantity=1,
            amount_minor=data.amount_minor, message=data.message,
        ))

    await db.commit()
    await db.refresh(item)
    return await _item_out(item, db)
