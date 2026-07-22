"""Floor-plan (venue layout) designer.

One layout per event: tables placed on a canvas, plus decorative elements
(stage, entrance, bar…) and an optional traced background image. Admins edit it
in the app; clients reach it through a share link — a view token (read-only) or
an edit token (drag + save, no login).

The layout is presentation only: it never changes seat assignment or capacity —
those stay owned by seating.py. Tables show live `seated` counts so the plan
doubles as a check-in board.
"""
import html as _html
import os
import secrets
import uuid

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_paid_event_admin, require_paid_event_member
from ..seating_terms import seating_term as _seating_term
from ..config import settings
from ..database import get_db
from .. import storage
from ..models import (
    Event, FloorElement, FloorPlan, Guest, SeatingTable, TableGroup, TableGroupTable, User,
)
from ..schemas import (
    FloorElementOut, FloorPlanOut, FloorPlanSave, FloorTableOut,
)

router = APIRouter()

UPLOADS_DIR = "/app/uploads"
_ALLOWED_IMG = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_GROUP_COLORS = ["#0ea5e9", "#f59e0b", "#10b981", "#a855f7", "#ef4444", "#14b8a6", "#eab308", "#ec4899"]


async def _get_or_make_plan(event_id: str, db: AsyncSession) -> FloorPlan:
    plan = await db.scalar(select(FloorPlan).where(FloorPlan.event_id == event_id))
    if not plan:
        plan = FloorPlan(event_id=event_id)
        db.add(plan)
        await db.flush()
    return plan


async def _build_plan_out(event: Event, plan: FloorPlan, db: AsyncSession, *, editable: bool, expose_tokens: bool) -> FloorPlanOut:
    tables = (await db.execute(
        select(SeatingTable).where(SeatingTable.event_id == event.id)
        .order_by(SeatingTable.sort_order, SeatingTable.name)
    )).scalars().all()

    # Live occupancy per table (guests physically holding a seat).
    seated_rows = (await db.execute(
        select(Guest.table_id, func.count(Guest.id))
        .where(Guest.event_id == event.id, Guest.table_id.isnot(None), Guest.seat_number.isnot(None))
        .group_by(Guest.table_id)
    )).all()
    seated = {tid: n for tid, n in seated_rows}

    # Table -> group name (for color-by-group in the editor).
    grp_rows = (await db.execute(
        select(TableGroupTable.table_id, TableGroup.id, TableGroup.name)
        .join(TableGroup, TableGroup.id == TableGroupTable.table_group_id)
        .where(TableGroup.event_id == event.id)
    )).all()
    groups = {tid: (gid, gname) for tid, gid, gname in grp_rows}

    table_out = []
    for t in tables:
        gid, gname = groups.get(t.id, (None, None))
        table_out.append(FloorTableOut(
            id=t.id, name=t.name, capacity=t.capacity, category=t.category,
            table_group_id=gid, table_group_name=gname, seated=seated.get(t.id, 0),
            pos_x=t.pos_x, pos_y=t.pos_y, shape=t.shape or "round", rotation=t.rotation or 0,
        ))

    elements = (await db.execute(
        select(FloorElement).where(FloorElement.event_id == event.id)
    )).scalars().all()

    return FloorPlanOut(
        event_id=event.id, event_name=event.name,
        seating_term=_seating_term(event),
        width=plan.width, height=plan.height,
        bg_image_url=plan.bg_image_url, bg_opacity=plan.bg_opacity,
        editable=editable,
        share_token=plan.share_token if expose_tokens else None,
        edit_token=plan.edit_token if expose_tokens else None,
        tables=table_out,
        elements=[FloorElementOut.model_validate(e) for e in elements],
    )


async def _apply_save(event_id: str, plan: FloorPlan, data: FloorPlanSave, db: AsyncSession) -> None:
    if data.width is not None:
        plan.width = max(200, min(data.width, 20000))
    if data.height is not None:
        plan.height = max(200, min(data.height, 20000))
    if data.bg_image_url is not None:
        plan.bg_image_url = data.bg_image_url or None
    if data.bg_opacity is not None:
        plan.bg_opacity = max(0, min(data.bg_opacity, 100))

    # Table placements — only positions/shape/rotation, never capacity/seating.
    if data.tables:
        owned = {
            t.id: t for t in (await db.execute(
                select(SeatingTable).where(SeatingTable.event_id == event_id)
            )).scalars().all()
        }
        for pos in data.tables:
            t = owned.get(pos.id)
            if not t:
                continue
            if pos.pos_x is not None:
                t.pos_x = pos.pos_x
            if pos.pos_y is not None:
                t.pos_y = pos.pos_y
            if pos.shape in ("round", "rect"):
                t.shape = pos.shape
            if pos.rotation is not None:
                t.rotation = int(pos.rotation) % 360

    # Elements — full replace: whatever the editor sends is the new set.
    existing = {
        e.id: e for e in (await db.execute(
            select(FloorElement).where(FloorElement.event_id == event_id)
        )).scalars().all()
    }
    keep: set[str] = set()
    for el in data.elements:
        row = existing.get(el.id) if el.id else None
        if row is None:
            row = FloorElement(event_id=event_id, type=el.type)
            db.add(row)
        row.type = el.type
        row.label = el.label
        row.pos_x, row.pos_y = el.pos_x, el.pos_y
        row.width, row.height = max(8, el.width), max(8, el.height)
        row.rotation = int(el.rotation) % 360
        row.color = el.color
        await db.flush()
        keep.add(row.id)
    for eid, row in existing.items():
        if eid not in keep:
            await db.delete(row)


# ── Admin (logged-in) ────────────────────────────────────────────────────────

@router.get("/events/{event_id}/floor-plan", response_model=FloorPlanOut)
async def get_floor_plan(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_member)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    plan = await _get_or_make_plan(event_id, db)
    out = await _build_plan_out(event, plan, db, editable=True, expose_tokens=True)
    await db.commit()
    return out


@router.put("/events/{event_id}/floor-plan", response_model=FloorPlanOut)
async def save_floor_plan(event_id: str, data: FloorPlanSave, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    plan = await _get_or_make_plan(event_id, db)
    await _apply_save(event_id, plan, data, db)
    await db.commit()
    fresh = await _get_or_make_plan(event_id, db)
    return await _build_plan_out(event, fresh, db, editable=True, expose_tokens=True)


@router.post("/events/{event_id}/floor-plan/share", response_model=FloorPlanOut)
async def make_share_links(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    """Mint (or return existing) view + edit share tokens for the client."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    plan = await _get_or_make_plan(event_id, db)
    if not plan.share_token:
        plan.share_token = secrets.token_urlsafe(16)
    if not plan.edit_token:
        plan.edit_token = secrets.token_urlsafe(16)
    await db.commit()
    return await _build_plan_out(event, plan, db, editable=True, expose_tokens=True)


# ── Client share links (no login) ────────────────────────────────────────────

async def _plan_by_token(token: str, db: AsyncSession) -> tuple[Event, FloorPlan, bool]:
    plan = await db.scalar(
        select(FloorPlan).where((FloorPlan.share_token == token) | (FloorPlan.edit_token == token))
    )
    if not plan:
        raise HTTPException(404, "Floor plan link is not valid")
    event = await db.get(Event, plan.event_id)
    if not event:
        raise HTTPException(404, "Floor plan link is not valid")
    can_edit = plan.edit_token == token
    return event, plan, can_edit


@router.get("/floor/{token}", response_model=FloorPlanOut)
async def get_shared_plan(token: str, db: AsyncSession = Depends(get_db)):
    event, plan, can_edit = await _plan_by_token(token, db)
    return await _build_plan_out(event, plan, db, editable=can_edit, expose_tokens=False)


@router.put("/floor/{token}", response_model=FloorPlanOut)
async def save_shared_plan(token: str, data: FloorPlanSave, db: AsyncSession = Depends(get_db)):
    event, plan, can_edit = await _plan_by_token(token, db)
    if not can_edit:
        raise HTTPException(403, "This link is view-only")
    await _apply_save(event.id, plan, data, db)
    await db.commit()
    fresh = await _get_or_make_plan(event.id, db)
    return await _build_plan_out(event, fresh, db, editable=True, expose_tokens=False)


# ── Background image upload ───────────────────────────────────────────────────

@router.post("/events/{event_id}/floor-plan/bg")
async def upload_floor_bg(event_id: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_admin)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if file.content_type not in _ALLOWED_IMG:
        raise HTTPException(400, "Use a JPEG, PNG, WebP or GIF image.")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image too large — maximum 10 MB.")
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get(file.content_type, "jpg")
    filename = f"{event_id}-floor-{uuid.uuid4().hex[:8]}.{ext}"
    url = storage.save(f"floor/{filename}", data, file.content_type)
    plan = await _get_or_make_plan(event_id, db)
    plan.bg_image_url = url
    await db.commit()
    return {"url": url}


# ── Printable PDF (rendered by design-service) ────────────────────────────────

def _auto_grid(tables: list[FloorTableOut], width: int) -> None:
    """Give unplaced tables a grid position so the export/first-open isn't empty."""
    col = 0
    x0, y0, step = 60, 60, 180
    per_row = max(1, (width - 120) // step)
    n = 0
    for t in tables:
        if t.pos_x is None or t.pos_y is None:
            t.pos_x = x0 + (n % per_row) * step
            t.pos_y = y0 + (n // per_row) * step
            n += 1
        col += 1


def _floor_svg(plan: FloorPlanOut) -> str:
    _auto_grid(plan.tables, plan.width)
    color_by_group: dict[str, str] = {}
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{plan.width}" height="{plan.height}" '
             f'viewBox="0 0 {plan.width} {plan.height}" style="background:#f8fafc;border:1px solid #cbd5e1">']
    if plan.bg_image_url:
        parts.append(f'<image href="{_html.escape(plan.bg_image_url)}" x="0" y="0" width="{plan.width}" '
                     f'height="{plan.height}" opacity="{plan.bg_opacity/100:.2f}" preserveAspectRatio="xMidYMid slice"/>')
    for el in plan.elements:
        parts.append(f'<g transform="rotate({el.rotation} {el.pos_x + el.width/2} {el.pos_y + el.height/2})">'
                     f'<rect x="{el.pos_x}" y="{el.pos_y}" width="{el.width}" height="{el.height}" rx="6" '
                     f'fill="{_html.escape(el.color or "#e2e8f0")}" stroke="#94a3b8"/>'
                     f'<text x="{el.pos_x + el.width/2}" y="{el.pos_y + el.height/2 + 4}" text-anchor="middle" '
                     f'font-family="sans-serif" font-size="13" fill="#334155">{_html.escape(el.label or el.type)}</text></g>')
    for t in plan.tables:
        size = max(52, 44 + t.capacity * 4)
        cx, cy = t.pos_x + size / 2, t.pos_y + size / 2
        if t.table_group_id:
            fill = color_by_group.setdefault(t.table_group_id, _GROUP_COLORS[len(color_by_group) % len(_GROUP_COLORS)])
        else:
            fill = "#0ea5e9"
        if t.shape == "rect":
            shape = f'<rect x="{t.pos_x}" y="{t.pos_y}" width="{size}" height="{size*0.7}" rx="8" fill="{fill}" fill-opacity="0.18" stroke="{fill}" stroke-width="2"/>'
            cy = t.pos_y + size * 0.35
        else:
            shape = f'<circle cx="{cx}" cy="{cy}" r="{size/2}" fill="{fill}" fill-opacity="0.18" stroke="{fill}" stroke-width="2"/>'
        parts.append(
            f'<g transform="rotate({t.rotation} {cx} {cy})">{shape}'
            f'<text x="{cx}" y="{cy - 2}" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="700" fill="#0f172a">{_html.escape(t.name)}</text>'
            f'<text x="{cx}" y="{cy + 15}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#475569">{t.seated}/{t.capacity} seats</text></g>'
        )
    parts.append('</svg>')
    return "".join(parts)


def _floor_html(plan: FloorPlanOut) -> str:
    rows = "".join(
        f'<tr><td>{_html.escape(t.name)}</td><td>{t.capacity}</td>'
        f'<td>{_html.escape(t.table_group_name or "—")}</td></tr>'
        for t in sorted(plan.tables, key=lambda x: x.name)
    )
    total_seats = sum(t.capacity for t in plan.tables)
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
      body{{font-family:sans-serif;margin:20px;color:#0f172a}}
      h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#64748b;font-size:13px;margin-bottom:14px}}
      table{{border-collapse:collapse;margin-top:16px;font-size:13px;width:100%}}
      th,td{{border:1px solid #e2e8f0;padding:6px 10px;text-align:left}} th{{background:#f1f5f9}}
    </style></head><body>
      <h1>{_html.escape(plan.event_name)} — Floor plan</h1>
      <div class="sub">{len(plan.tables)} {_html.escape(plan.seating_term.lower())}s · {total_seats} seats</div>
      {_floor_svg(plan)}
      <table><thead><tr><th>{_html.escape(plan.seating_term)}</th><th>Seats</th><th>Group</th></tr></thead><tbody>{rows}</tbody></table>
    </body></html>"""


@router.get("/events/{event_id}/floor-plan.pdf")
async def floor_plan_pdf(event_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_paid_event_member)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    plan = await _get_or_make_plan(event_id, db)
    out = await _build_plan_out(event, plan, db, editable=False, expose_tokens=False)
    await db.commit()
    html = _floor_html(out)
    url = settings.design_service_url.rstrip("/") + "/api/v1/design/render-pdf"
    headers = {}
    token = os.getenv("DESIGN_INTERNAL_TOKEN", "")
    if token:
        headers["X-Internal-Token"] = token
    try:
        async with httpx.AsyncClient(timeout=45) as c:
            r = await c.post(url, json={"html": html, "width": f"{out.width + 60}px", "height": f"{out.height + 260}px"}, headers=headers)
    except httpx.HTTPError:
        raise HTTPException(502, "Floor-plan PDF service is unavailable")
    if r.status_code != 200:
        raise HTTPException(502, "Could not render the floor-plan PDF")
    safe = "".join(ch for ch in event.name if ch.isalnum() or ch in " -_")[:40].strip() or "floor-plan"
    return Response(content=r.content, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{safe} floor plan.pdf"'})
