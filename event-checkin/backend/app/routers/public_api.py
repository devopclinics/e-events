"""Public API (Gatsby gap-backlog item): read-only v1 surface for third-party
integrations, authenticated via X-API-Key (see auth.py:require_api_key) and
rate-limited per key. Deliberately small and curated for a first cut — see
docs() below for the full contract, which doubles as the "docs page" the
backlog ticket asked for.
"""
import copy

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    ApiKey, ConsentForm, ConsentSignature, Event, ExperienceEvent, ExperienceStep, ExperienceWorkflow,
    Guest, GuestExperienceProgress, SeatingTable, TableGroup,
)
from ..schemas import (
    PublicConsentFormOut, PublicConsentFormUpsert, PublicConsentSignatureOut,
    PublicEventOut, PublicExperienceStepIn, PublicExperienceStepOut, PublicExperienceStepReorder,
    PublicExperienceStepUpdate, PublicExperienceWorkflowCreate, PublicExperienceWorkflowOut,
    PublicFeedbackReminderRequest, PublicGuestCreate, PublicGuestOut, PublicGuestUpdate,
    PublicSeatingTableCreate, PublicSeatingTableOut, PublicSeatingTableUpdate,
    PublicStepsBulkCreate, PublicTableGroupCreate, PublicTableGroupOut, PublicTableGroupTablesUpdate,
    PublicTableGroupUpdate,
)
from ..auth import _PAID_REQUIRED, require_api_key, require_read_write_api_key
from ..entitlements import assert_within_guest_cap
from ..ratelimit import api_key_rate_limit
from ..services.webhook_outbox import queue_webhook_event
from .guests import _normalize_phone, delete_guest_cascade
from .seating import (
    _clean_group_name, _ensure_unique_group_tag, _ensure_unique_table_name, _group_out,
    _set_group_tables, _table_out, delete_table_cascade, delete_table_group_cascade,
)
from .experience import (
    _active_consent, _assert_experience_plan, _ensure_draft, _feedback_nonresponders, _feedback_results_data,
    _load_scoped_workflow, _step_key_exists, delete_step_cascade, send_feedback_reminders_cascade,
)
from ..services.experience import (
    active_workflow, archive_workflow, create_workflow, list_workflows, publish_workflow,
    unarchive_workflow, unpublish_workflow,
)

router = APIRouter()

# Generous enough for legitimate polling integrations, tight enough to stop a
# runaway script — 120 requests/minute per key.
_limit = api_key_rate_limit(limit=120, window=60)


def build_scoped_openapi_schema(app) -> dict:
    """Scoped OpenAPI schema covering ONLY the Public API's own paths — not the
    full internal admin API. Used by the authenticated interactive-explorer
    endpoint in api_keys.py (org owner + active subscription only — this
    schema is NOT served unauthenticated; browsing it requires being logged
    into the app as the org owner, unlike the prose docs at /api/public/v1/docs
    and /api-docs, which stay public on purpose).

    Built by post-filtering the app's full generated schema (copied, not
    mutated in place — app.openapi() returns FastAPI's cached schema object,
    shared across requests) rather than passing a route subset to
    get_openapi(), since this FastAPI version wraps included routers lazily
    and app.routes doesn't expose flattened APIRoute objects to filter by path.
    """
    prefix = "/api/public/v1"
    full = app.openapi()
    paths = {p: v for p, v in full.get("paths", {}).items() if p.startswith(prefix)}
    schema = {
        "openapi": full.get("openapi", "3.1.0"),
        "info": {
            "title": "Festio Public API", "version": "1.0.0",
            "description": "Third-party integration API. Auth: X-API-Key header. "
                            "Prose docs: /api-docs. Machine contract: /api/public/v1/docs.",
        },
        "paths": copy.deepcopy(paths),
        "components": copy.deepcopy(full.get("components", {})),
    }
    schema["components"]["securitySchemes"] = {
        "ApiKeyAuth": {"type": "apiKey", "in": "header", "name": "X-API-Key"},
    }
    schema["security"] = [{"ApiKeyAuth": []}]
    return schema


@router.get("/docs")
async def public_api_docs():
    """Machine- and human-readable contract for this API — the 'docs page'
    the backlog ticket asked for. No auth required so prospects can read it
    before they have a key."""
    return {
        "human_readable_docs": "/api-docs",
        "auth": {
            "header": "X-API-Key",
            "how_to_get_a_key": "Sign in to Festio, go to Organization Settings → API Keys, and create one. "
                                 "The full key is shown once at creation — store it somewhere safe.",
        },
        "rate_limit": "120 requests/minute per key",
        "interactive_explorer": "Sign in to Festio → Organization Settings → API Keys → "
                                 "\"Open interactive API explorer\" (requires an active API Access subscription).",
        "endpoints": [
            {"method": "GET", "path": "/api/public/v1/events", "description": "List your organization's events."},
            {"method": "GET", "path": "/api/public/v1/events/{event_id}", "description": "Get one event."},
            {"method": "GET", "path": "/api/public/v1/events/{event_id}/guests",
             "description": "List guests for one of your events."},
            {"method": "POST", "path": "/api/public/v1/events/{event_id}/guests",
             "description": "Add a guest. Requires a read-write API key.",
             "requires": "read_write API key (API Access subscription)"},
            {"method": "PATCH", "path": "/api/public/v1/guests/{guest_id}",
             "description": "Edit a guest's core fields. Requires a read-write API key.",
             "requires": "read_write API key (API Access subscription)"},
            {"method": "DELETE", "path": "/api/public/v1/guests/{guest_id}",
             "description": "Remove a guest. Requires a read-write API key.",
             "requires": "read_write API key (API Access subscription)"},

            {"method": "GET", "path": "/api/public/v1/events/{event_id}/tables",
             "description": "List seating tables. Requires an Event Pass (event.is_paid)."},
            {"method": "POST", "path": "/api/public/v1/events/{event_id}/tables",
             "description": "Create a table.", "requires": "read_write API key + Event Pass"},
            {"method": "PATCH", "path": "/api/public/v1/tables/{table_id}",
             "description": "Edit a table.", "requires": "read_write API key + Event Pass"},
            {"method": "DELETE", "path": "/api/public/v1/tables/{table_id}",
             "description": "Delete a table (guests on it are detached, not blocked).",
             "requires": "read_write API key + Event Pass"},

            {"method": "GET", "path": "/api/public/v1/events/{event_id}/table-groups",
             "description": "List table groups. Requires an Event Pass."},
            {"method": "POST", "path": "/api/public/v1/events/{event_id}/table-groups",
             "description": "Create a table group.", "requires": "read_write API key + Event Pass"},
            {"method": "PATCH", "path": "/api/public/v1/table-groups/{group_id}",
             "description": "Edit a table group.", "requires": "read_write API key + Event Pass"},
            {"method": "PUT", "path": "/api/public/v1/table-groups/{group_id}/tables",
             "description": "Replace a group's member tables.", "requires": "read_write API key + Event Pass"},
            {"method": "DELETE", "path": "/api/public/v1/table-groups/{group_id}",
             "description": "Delete a table group (409 if any guest is still assigned to it).",
             "requires": "read_write API key + Event Pass"},

            {"method": "GET", "path": "/api/public/v1/events/{event_id}/experience/workflows",
             "description": "List Experience workflows."},
            {"method": "GET", "path": "/api/public/v1/experience/workflows/{workflow_id}",
             "description": "Get one workflow with its steps."},
            {"method": "POST", "path": "/api/public/v1/events/{event_id}/experience/workflows",
             "description": "Create a workflow — steps can be supplied inline as a JSON array.",
             "requires": "read_write API key + event on Pro (tier300) plan or higher"},
            {"method": "DELETE", "path": "/api/public/v1/experience/workflows/{workflow_id}",
             "description": "Delete a workflow (409 unless it's still a draft).",
             "requires": "read_write API key + Pro plan"},
            {"method": "POST", "path": "/api/public/v1/experience/workflows/{workflow_id}/publish",
             "description": "Publish a draft workflow.", "requires": "read_write API key + Pro plan"},
            {"method": "POST", "path": "/api/public/v1/experience/workflows/{workflow_id}/unpublish",
             "description": "Revert a published workflow to draft.", "requires": "read_write API key + Pro plan"},
            {"method": "POST", "path": "/api/public/v1/experience/workflows/{workflow_id}/archive",
             "description": "Archive a workflow.", "requires": "read_write API key + Pro plan"},
            {"method": "POST", "path": "/api/public/v1/experience/workflows/{workflow_id}/unarchive",
             "description": "Restore an archived workflow to draft.", "requires": "read_write API key + Pro plan"},
            {"method": "POST", "path": "/api/public/v1/experience/workflows/{workflow_id}/steps",
             "description": "Add one step to a draft workflow.", "requires": "read_write API key + Pro plan"},
            {"method": "POST", "path": "/api/public/v1/experience/workflows/{workflow_id}/steps/bulk",
             "description": "Add up to 100 steps to a draft workflow in one call (JSON array).",
             "requires": "read_write API key + Pro plan"},
            {"method": "PATCH", "path": "/api/public/v1/experience/steps/{step_id}",
             "description": "Edit a draft workflow's step.", "requires": "read_write API key + Pro plan"},
            {"method": "DELETE", "path": "/api/public/v1/experience/steps/{step_id}",
             "description": "Delete a draft workflow's step.", "requires": "read_write API key + Pro plan"},
            {"method": "POST", "path": "/api/public/v1/experience/workflows/{workflow_id}/steps/reorder",
             "description": "Reorder a draft workflow's steps.", "requires": "read_write API key + Pro plan"},

            {"method": "GET", "path": "/api/public/v1/events/{event_id}/experience/consent-form",
             "description": "Get the currently active consent form, if any."},
            {"method": "PUT", "path": "/api/public/v1/events/{event_id}/experience/consent-form",
             "description": "Create a new consent form version (deactivates the prior one).",
             "requires": "read_write API key + Pro plan"},
            {"method": "DELETE", "path": "/api/public/v1/events/{event_id}/experience/consent-form",
             "description": "Soft-disable the active consent form.", "requires": "read_write API key + Pro plan"},
            {"method": "GET", "path": "/api/public/v1/events/{event_id}/experience/consent-signatures",
             "description": "List guests who have signed consent."},

            {"method": "GET", "path": "/api/public/v1/events/{event_id}/experience/feedback/results",
             "description": "Aggregated feedback results per feedback step."},
            {"method": "POST", "path": "/api/public/v1/events/{event_id}/experience/feedback/{step_id}/reminders",
             "description": "Send a reminder to non-responders (spends message credits, sends real messages).",
             "requires": "read_write API key + Pro plan"},
        ],
    }


@router.get("/events", response_model=list[PublicEventOut])
async def list_events(
    request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_api_key), _: None = Depends(_limit),
):
    rows = (await db.execute(
        select(Event).where(Event.org_id == api_key.org_id).order_by(Event.event_date.desc())
    )).scalars().all()
    return rows


@router.get("/events/{event_id}", response_model=PublicEventOut)
async def get_event(
    event_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_api_key), _: None = Depends(_limit),
):
    event = await db.get(Event, event_id)
    if not event or event.org_id != api_key.org_id:
        raise HTTPException(404, "Event not found")
    return event


@router.get("/events/{event_id}/guests", response_model=list[PublicGuestOut])
async def list_guests(
    event_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_api_key), _: None = Depends(_limit),
):
    event = await db.get(Event, event_id)
    if not event or event.org_id != api_key.org_id:
        raise HTTPException(404, "Event not found")
    rows = (await db.execute(select(Guest).where(Guest.event_id == event_id))).scalars().all()
    return rows


# ── Guest writes — read_write scope only ─────────────────────────────────────

@router.post("/events/{event_id}/guests", response_model=PublicGuestOut, status_code=201)
async def create_guest(
    event_id: str, data: PublicGuestCreate, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    """Mirrors guests.py::add_guest's validation and cap enforcement."""
    event = await db.get(Event, event_id)
    if not event or event.org_id != api_key.org_id:
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

    guest = Guest(event_id=event_id, first_name=first, last_name=last, email=email,
                  phone=phone, is_vip=bool(data.is_vip))
    db.add(guest)
    await db.commit()
    await db.refresh(guest)
    if await queue_webhook_event(db, org_id=event.org_id, event_type="guest.created", payload={
        "guest_id": guest.id, "event_id": event.id,
        "first_name": guest.first_name, "last_name": guest.last_name,
        "email": guest.email, "rsvp_status": guest.rsvp_status,
    }):
        await db.commit()
    return guest


async def _get_org_guest(guest_id: str, api_key: ApiKey, db: AsyncSession) -> tuple[Guest, Event]:
    guest = await db.get(Guest, guest_id)
    if not guest:
        raise HTTPException(404, "Guest not found")
    event = await db.get(Event, guest.event_id)
    if not event or event.org_id != api_key.org_id:
        raise HTTPException(404, "Guest not found")
    return guest, event


@router.patch("/guests/{guest_id}", response_model=PublicGuestOut)
async def update_guest(
    guest_id: str, data: PublicGuestUpdate, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    """Same editable-field set as the internal GuestUpdate schema."""
    guest, event = await _get_org_guest(guest_id, api_key, db)
    if data.first_name is not None:
        guest.first_name = data.first_name.strip()
    if data.last_name is not None:
        guest.last_name = data.last_name.strip()
    if data.email is not None:
        guest.email = data.email.strip() or None
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
    await db.commit()
    await db.refresh(guest)
    return guest


@router.delete("/guests/{guest_id}", status_code=204)
async def remove_guest(
    guest_id: str, background_tasks: BackgroundTasks, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    """Reuses guests.py's cascade-cleanup helper rather than duplicating it."""
    guest, event = await _get_org_guest(guest_id, api_key, db)
    if not await delete_guest_cascade(event.id, guest_id, background_tasks, db):
        raise HTTPException(404, "Guest not found")


# ── Tables + table groups — read_write scope only, event.is_paid required ────
# (mirrors seating.py's own require_paid_event_member/admin: seating is itself
# a paid module, so both reads and writes are gated, unlike guests.)

async def _get_org_paid_event(event_id: str, api_key: ApiKey, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event or event.org_id != api_key.org_id:
        raise HTTPException(404, "Event not found")
    if not event.is_paid:
        raise HTTPException(402, _PAID_REQUIRED)
    return event


async def _get_org_table(table_id: str, api_key: ApiKey, db: AsyncSession) -> tuple[SeatingTable, Event]:
    table = await db.get(SeatingTable, table_id)
    if not table:
        raise HTTPException(404, "Table not found")
    event = await db.get(Event, table.event_id)
    if not event or event.org_id != api_key.org_id:
        raise HTTPException(404, "Table not found")
    if not event.is_paid:
        raise HTTPException(402, _PAID_REQUIRED)
    return table, event


async def _get_org_table_group(group_id: str, api_key: ApiKey, db: AsyncSession) -> tuple[TableGroup, Event]:
    group = await db.get(TableGroup, group_id)
    if not group:
        raise HTTPException(404, "Table group not found")
    event = await db.get(Event, group.event_id)
    if not event or event.org_id != api_key.org_id:
        raise HTTPException(404, "Table group not found")
    if not event.is_paid:
        raise HTTPException(402, _PAID_REQUIRED)
    return group, event


def _public_table_out(internal_out) -> PublicSeatingTableOut:
    return PublicSeatingTableOut(**internal_out.model_dump(exclude={"pos_x", "pos_y", "shape", "rotation"}))


def _public_group_out(internal_out) -> PublicTableGroupOut:
    return PublicTableGroupOut(**internal_out.model_dump())


@router.get("/events/{event_id}/tables", response_model=list[PublicSeatingTableOut])
async def list_tables(
    event_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_api_key), _: None = Depends(_limit),
):
    await _get_org_paid_event(event_id, api_key, db)
    rows = (await db.execute(
        select(SeatingTable).where(SeatingTable.event_id == event_id).order_by(SeatingTable.sort_order, SeatingTable.name)
    )).scalars().all()
    return [_public_table_out(await _table_out(t, db)) for t in rows]


@router.post("/events/{event_id}/tables", response_model=PublicSeatingTableOut, status_code=201)
async def create_table(
    event_id: str, data: PublicSeatingTableCreate, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    await _get_org_paid_event(event_id, api_key, db)
    name = await _ensure_unique_table_name(event_id, data.name, db)
    table = SeatingTable(event_id=event_id, name=name, capacity=data.capacity, category=data.category,
                        sort_order=data.sort_order or 0)
    db.add(table)
    await db.commit()
    await db.refresh(table)
    if await queue_webhook_event(db, org_id=api_key.org_id, event_type="table.created", payload={
        "table_id": table.id, "event_id": event_id, "name": table.name, "capacity": table.capacity,
    }):
        await db.commit()
    return _public_table_out(await _table_out(table, db))


@router.patch("/tables/{table_id}", response_model=PublicSeatingTableOut)
async def update_table(
    table_id: str, data: PublicSeatingTableUpdate, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    table, event = await _get_org_table(table_id, api_key, db)
    if data.name is not None:
        table.name = await _ensure_unique_table_name(event.id, data.name, db, exclude_id=table_id)
    if data.capacity is not None:
        table.capacity = data.capacity
    if data.category is not None:
        table.category = data.category
    if data.sort_order is not None:
        table.sort_order = data.sort_order
    await db.commit()
    await db.refresh(table)
    return _public_table_out(await _table_out(table, db))


@router.delete("/tables/{table_id}", status_code=204)
async def remove_table(
    table_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    table, event = await _get_org_table(table_id, api_key, db)
    if await delete_table_cascade(event.id, table_id, db):
        if await queue_webhook_event(db, org_id=api_key.org_id, event_type="table.deleted",
                                      payload={"table_id": table_id, "event_id": event.id}):
            await db.commit()


@router.get("/events/{event_id}/table-groups", response_model=list[PublicTableGroupOut])
async def list_table_groups(
    event_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_api_key), _: None = Depends(_limit),
):
    await _get_org_paid_event(event_id, api_key, db)
    rows = (await db.execute(
        select(TableGroup).where(TableGroup.event_id == event_id).order_by(TableGroup.sort_order, TableGroup.name)
    )).scalars().all()
    return [_public_group_out(await _group_out(g, db)) for g in rows]


@router.post("/events/{event_id}/table-groups", response_model=PublicTableGroupOut, status_code=201)
async def create_table_group(
    event_id: str, data: PublicTableGroupCreate, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    await _get_org_paid_event(event_id, api_key, db)
    name = _clean_group_name(data.name)
    tag = await _ensure_unique_group_tag(event_id, data.tag or name, db)
    group = TableGroup(event_id=event_id, name=name, tag=tag, description=data.description,
                       sort_order=data.sort_order or 0)
    db.add(group)
    await db.flush()
    if data.table_ids:
        await _set_group_tables(group, data.table_ids, event_id, db)
    await db.commit()
    await db.refresh(group)
    if await queue_webhook_event(db, org_id=api_key.org_id, event_type="table_group.created", payload={
        "table_group_id": group.id, "event_id": event_id, "name": group.name,
    }):
        await db.commit()
    return _public_group_out(await _group_out(group, db))


@router.patch("/table-groups/{group_id}", response_model=PublicTableGroupOut)
async def update_table_group(
    group_id: str, data: PublicTableGroupUpdate, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    group, event = await _get_org_table_group(group_id, api_key, db)
    if data.name is not None:
        group.name = _clean_group_name(data.name)
    if data.tag is not None:
        group.tag = await _ensure_unique_group_tag(event.id, data.tag, db, exclude_id=group_id)
    if data.description is not None:
        group.description = data.description
    if data.sort_order is not None:
        group.sort_order = data.sort_order
    if data.table_ids is not None:
        await _set_group_tables(group, data.table_ids, event.id, db)
    await db.commit()
    await db.refresh(group)
    return _public_group_out(await _group_out(group, db))


@router.put("/table-groups/{group_id}/tables", response_model=PublicTableGroupOut)
async def set_table_group_tables(
    group_id: str, data: PublicTableGroupTablesUpdate, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    group, event = await _get_org_table_group(group_id, api_key, db)
    await _set_group_tables(group, data.table_ids, event.id, db)
    await db.commit()
    await db.refresh(group)
    return _public_group_out(await _group_out(group, db))


@router.delete("/table-groups/{group_id}", status_code=204)
async def remove_table_group(
    group_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    group, event = await _get_org_table_group(group_id, api_key, db)
    if await delete_table_group_cascade(event.id, group_id, db):
        if await queue_webhook_event(db, org_id=api_key.org_id, event_type="table_group.deleted",
                                      payload={"table_group_id": group_id, "event_id": event.id}):
            await db.commit()


# ── Experience — read_write scope + tier300 ("experience_enabled") on writes.
# Reads are NOT tier-gated, matching the internal router's own reads. Two
# independent gates apply on every write: the org's API Access subscription
# (checked at read-write key issuance) AND this specific event's plan tier.

async def _get_org_event(event_id: str, api_key: ApiKey, db: AsyncSession) -> Event:
    event = await db.get(Event, event_id)
    if not event or event.org_id != api_key.org_id:
        raise HTTPException(404, "Event not found")
    return event


async def _get_org_workflow(workflow_id: str, api_key: ApiKey, db: AsyncSession) -> tuple[ExperienceWorkflow, Event]:
    raw = await db.get(ExperienceWorkflow, workflow_id)
    if not raw:
        raise HTTPException(404, "Workflow not found")
    event = await db.get(Event, raw.event_id)
    if not event or event.org_id != api_key.org_id:
        raise HTTPException(404, "Workflow not found")
    workflow = await _load_scoped_workflow(raw.event_id, workflow_id, db)
    return workflow, event


async def _get_org_step(step_id: str, api_key: ApiKey, db: AsyncSession) -> tuple[ExperienceStep, ExperienceWorkflow, Event]:
    step = await db.get(ExperienceStep, step_id)
    if not step:
        raise HTTPException(404, "Step not found")
    workflow, event = await _get_org_workflow(step.workflow_id, api_key, db)
    return step, workflow, event


@router.get("/events/{event_id}/experience/workflows", response_model=list[PublicExperienceWorkflowOut])
async def list_experience_workflows(
    event_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_api_key), _: None = Depends(_limit),
):
    await _get_org_event(event_id, api_key, db)
    return await list_workflows(event_id, db)


@router.get("/experience/workflows/{workflow_id}", response_model=PublicExperienceWorkflowOut)
async def get_experience_workflow(
    workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_api_key), _: None = Depends(_limit),
):
    workflow, _event = await _get_org_workflow(workflow_id, api_key, db)
    return workflow


@router.post("/events/{event_id}/experience/workflows", response_model=PublicExperienceWorkflowOut, status_code=201)
async def create_experience_workflow(
    event_id: str, data: PublicExperienceWorkflowCreate, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    """`steps` is accepted inline as a JSON array in this one call."""
    event = await _get_org_event(event_id, api_key, db)
    _assert_experience_plan(event)
    keys = [step.key for step in data.steps]
    if len(keys) != len(set(keys)):
        raise HTTPException(400, "Step keys must be unique within a workflow")
    return await create_workflow(
        event, db, name=data.name, step_specs=[step.model_dump() for step in data.steps], actor_user_id=None,
    )


@router.delete("/experience/workflows/{workflow_id}", status_code=204)
async def remove_experience_workflow(
    workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    workflow, event = await _get_org_workflow(workflow_id, api_key, db)
    _assert_experience_plan(event)
    if workflow.status != "draft":
        raise HTTPException(409, "Only draft workflows can be deleted. Archive published or historical workflows instead.")
    await db.execute(sa_delete(GuestExperienceProgress).where(GuestExperienceProgress.workflow_id == workflow.id))
    await db.execute(sa_delete(ExperienceEvent).where(ExperienceEvent.workflow_id == workflow.id))
    await db.delete(workflow)
    await db.commit()


@router.post("/experience/workflows/{workflow_id}/publish", response_model=PublicExperienceWorkflowOut)
async def publish_experience_workflow(
    workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    workflow, event = await _get_org_workflow(workflow_id, api_key, db)
    _assert_experience_plan(event)
    if workflow.status != "draft":
        raise HTTPException(409, "Only draft workflows can be published")
    if not any(step.enabled for step in workflow.steps):
        raise HTTPException(400, "A workflow must have at least one enabled step before publishing")
    existing_published = await db.scalar(
        select(ExperienceWorkflow).where(
            ExperienceWorkflow.event_id == event.id, ExperienceWorkflow.id != workflow.id,
            ExperienceWorkflow.status == "published",
        ).limit(1)
    )
    if existing_published:
        raise HTTPException(409, f"Unpublish '{existing_published.name}' before publishing another workflow")
    published = await publish_workflow(workflow, event, db, actor_user_id=None)
    if await queue_webhook_event(db, org_id=api_key.org_id, event_type="experience.workflow_published", payload={
        "workflow_id": workflow.id, "event_id": event.id, "name": workflow.name, "version": workflow.version,
    }):
        await db.commit()
    return published


@router.post("/experience/workflows/{workflow_id}/unpublish", response_model=PublicExperienceWorkflowOut)
async def unpublish_experience_workflow(
    workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    workflow, event = await _get_org_workflow(workflow_id, api_key, db)
    _assert_experience_plan(event)
    if workflow.status != "published":
        raise HTTPException(409, "Only published workflows can be unpublished")
    return await unpublish_workflow(workflow, event, db, actor_user_id=None)


@router.post("/experience/workflows/{workflow_id}/archive", response_model=PublicExperienceWorkflowOut)
async def archive_experience_workflow(
    workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    workflow, event = await _get_org_workflow(workflow_id, api_key, db)
    _assert_experience_plan(event)
    if workflow.status == "archived":
        raise HTTPException(409, "Workflow is already archived")
    return await archive_workflow(workflow, event, db, actor_user_id=None)


@router.post("/experience/workflows/{workflow_id}/unarchive", response_model=PublicExperienceWorkflowOut)
async def unarchive_experience_workflow(
    workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    workflow, event = await _get_org_workflow(workflow_id, api_key, db)
    _assert_experience_plan(event)
    if workflow.status != "archived":
        raise HTTPException(409, "Only archived workflows can be unarchived")
    return await unarchive_workflow(workflow, db, actor_user_id=None)


@router.post("/experience/workflows/{workflow_id}/steps", response_model=PublicExperienceStepOut, status_code=201)
async def create_experience_step(
    workflow_id: str, data: PublicExperienceStepIn, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    workflow, event = await _get_org_workflow(workflow_id, api_key, db)
    _assert_experience_plan(event)
    _ensure_draft(workflow)
    if await _step_key_exists(workflow.id, data.key, db):
        raise HTTPException(409, "A step with this key already exists in the workflow")
    step = ExperienceStep(workflow_id=workflow.id, **data.model_dump())
    db.add(step)
    await db.commit()
    await db.refresh(step)
    return step


@router.post("/experience/workflows/{workflow_id}/steps/bulk", response_model=list[PublicExperienceStepOut], status_code=201)
async def bulk_create_experience_steps(
    workflow_id: str, data: PublicStepsBulkCreate, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    """General-purpose bulk step add — the "steps in JSON" endpoint for adding
    to an already-existing draft workflow (as opposed to inline at creation).
    Unlike the internal program/import, type/config are caller-supplied, not
    hardcoded to the narrow agenda-segment shape."""
    workflow, event = await _get_org_workflow(workflow_id, api_key, db)
    _assert_experience_plan(event)
    _ensure_draft(workflow)
    requested = [item.key for item in data.steps]
    if len(requested) != len(set(requested)):
        raise HTTPException(422, "Step keys must be unique within the request")
    existing = {step.key for step in workflow.steps}
    conflict = next((key for key in requested if key in existing), None)
    if conflict:
        raise HTTPException(409, f"A step with key '{conflict}' already exists")
    created = []
    for item in data.steps:
        step = ExperienceStep(workflow_id=workflow.id, **item.model_dump())
        db.add(step)
        created.append(step)
    await db.commit()
    for step in created:
        await db.refresh(step)
    return created


@router.patch("/experience/steps/{step_id}", response_model=PublicExperienceStepOut)
async def update_experience_step(
    step_id: str, data: PublicExperienceStepUpdate, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    step, workflow, event = await _get_org_step(step_id, api_key, db)
    _assert_experience_plan(event)
    _ensure_draft(workflow)
    payload = data.model_dump(exclude_unset=True)
    if "key" in payload and await _step_key_exists(workflow.id, payload["key"], db, exclude_step_id=step.id):
        raise HTTPException(409, "A step with this key already exists in the workflow")
    for field, value in payload.items():
        setattr(step, field, value)
    await db.commit()
    await db.refresh(step)
    return step


@router.delete("/experience/steps/{step_id}", status_code=204)
async def remove_experience_step(
    step_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    step, workflow, event = await _get_org_step(step_id, api_key, db)
    _assert_experience_plan(event)
    _ensure_draft(workflow)
    if not await delete_step_cascade(event.id, workflow, step_id, db):
        raise HTTPException(404, "Step not found")


@router.post("/experience/workflows/{workflow_id}/steps/reorder", response_model=PublicExperienceWorkflowOut)
async def reorder_experience_steps(
    workflow_id: str, data: PublicExperienceStepReorder, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    workflow, event = await _get_org_workflow(workflow_id, api_key, db)
    _assert_experience_plan(event)
    _ensure_draft(workflow)
    current_ids = {step.id for step in workflow.steps}
    requested_ids = set(data.step_ids)
    if len(data.step_ids) != len(requested_ids) or requested_ids != current_ids:
        raise HTTPException(400, "Reorder must include each workflow step exactly once")
    steps_by_id = {step.id: step for step in workflow.steps}
    for index, step_id in enumerate(data.step_ids):
        steps_by_id[step_id].sort_order = (index + 1) * 10
    await db.commit()
    workflow, _event = await _get_org_workflow(workflow_id, api_key, db)
    return workflow


# ── Consent forms + signatures ───────────────────────────────────────────────

@router.get("/events/{event_id}/experience/consent-form", response_model=PublicConsentFormOut | None)
async def get_consent_form(
    event_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_api_key), _: None = Depends(_limit),
):
    await _get_org_event(event_id, api_key, db)
    return await _active_consent(event_id, db)


@router.put("/events/{event_id}/experience/consent-form", response_model=PublicConsentFormOut)
async def save_consent_form(
    event_id: str, data: PublicConsentFormUpsert, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    event = await _get_org_event(event_id, api_key, db)
    _assert_experience_plan(event)
    prior = await _active_consent(event_id, db)
    if prior:
        prior.is_active = False
    latest_version = await db.scalar(
        select(ConsentForm.version).where(ConsentForm.event_id == event_id).order_by(ConsentForm.version.desc()).limit(1)
    )
    form = ConsentForm(
        event_id=event_id, title=data.title, body=data.body, require_signature=data.require_signature,
        version=(latest_version or 0) + 1, created_by=None,
    )
    db.add(form)
    await db.commit()
    await db.refresh(form)
    return form


@router.delete("/events/{event_id}/experience/consent-form")
async def disable_consent_form(
    event_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    event = await _get_org_event(event_id, api_key, db)
    _assert_experience_plan(event)
    form = await _active_consent(event_id, db)
    if not form:
        return {"disabled": False, "message": "Consent form is already disabled"}
    form.is_active = False
    workflow = await active_workflow(event_id, db)
    consent_step = next((step for step in (workflow.steps if workflow else []) if step.type == "consent" and step.enabled), None)
    if workflow:
        db.add(ExperienceEvent(
            event_id=event_id, workflow_id=workflow.id, step_id=consent_step.id if consent_step else None,
            actor_user_id=None, event_type="consent_form_disabled", source="admin",
            payload={"form_id": form.id, "form_version": form.version},
        ))
    await db.commit()
    return {"disabled": True, "form_id": form.id}


@router.get("/events/{event_id}/experience/consent-signatures", response_model=list[PublicConsentSignatureOut])
async def list_consent_signatures(
    event_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_api_key), _: None = Depends(_limit),
):
    await _get_org_event(event_id, api_key, db)
    rows = (await db.execute(
        select(ConsentSignature).where(ConsentSignature.event_id == event_id).order_by(ConsentSignature.signed_at.desc())
    )).scalars().all()
    return rows


# ── Feedback ──────────────────────────────────────────────────────────────────

@router.get("/events/{event_id}/experience/feedback/results")
async def feedback_results(
    event_id: str, request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_api_key), _: None = Depends(_limit),
):
    """Raw dict passthrough — the shape is inherently dynamic per question
    type (rating/nps/choice/text each shape `aggregates` differently), same
    as the internal endpoint's own choice to skip a response_model."""
    await _get_org_event(event_id, api_key, db)
    return await _feedback_results_data(event_id, db)


@router.post("/events/{event_id}/experience/feedback/{step_id}/reminders")
async def send_feedback_reminders(
    event_id: str, step_id: str, data: PublicFeedbackReminderRequest, background_tasks: BackgroundTasks,
    request: Request, db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(require_read_write_api_key), _: None = Depends(_limit),
):
    """Real send action — spends message credits and queues actual SMS/email/
    WhatsApp sends via the same accounting as the internal admin action."""
    event = await _get_org_event(event_id, api_key, db)
    _assert_experience_plan(event)
    _, step, guests = await _feedback_nonresponders(event_id, step_id, db)
    return await send_feedback_reminders_cascade(
        event, step, guests, data.channels, data.subject, data.message, background_tasks, db,
    )
