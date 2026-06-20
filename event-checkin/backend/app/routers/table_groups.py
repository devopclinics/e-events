"""Table Group CRUD + guest-assignment endpoints.

Groups allow an organizer to cluster tables (e.g. "VIP Tables", "Family Tables")
and optionally restrict guests to only sit within their assigned group.
"""
import csv
import io
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from ..database import get_db
from ..models import Event, SeatingTable, TableGroup, TableGroupTable, Guest, User
from ..schemas import (
    TableGroupCreate, TableGroupUpdate, TableGroupOut,
    TableGroupAssignRequest,
    BulkTableGroupImportRequest, BulkTableGroupImportResult, BulkImportError, BulkTableGroupRow,
)
from ..auth import require_admin, get_current_user

router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────

async def _group_out(group: TableGroup, db: AsyncSession) -> TableGroupOut:
    """Build the full output payload for a group."""
    # Tables in this group
    rows = (await db.execute(
        select(SeatingTable)
        .join(TableGroupTable, TableGroupTable.table_id == SeatingTable.id)
        .where(TableGroupTable.table_group_id == group.id)
    )).scalars().all()

    # Total capacity = sum of table capacities
    total_capacity = sum(t.capacity for t in rows)

    # Assigned guests = guests whose table_id is in one of these tables
    table_ids = [t.id for t in rows]
    assigned_count = 0
    if table_ids:
        assigned_count = await db.scalar(
            select(func.count(Guest.id)).where(Guest.table_group_id == group.id)
        ) or 0

    # Guests tagged to this group (regardless of whether seated yet)
    tagged_count = await db.scalar(
        select(func.count(Guest.id)).where(Guest.table_group_id == group.id)
    ) or 0

    return TableGroupOut(
        id=group.id,
        event_id=group.event_id,
        name=group.name,
        tag=group.tag,
        description=group.description,
        created_at=group.created_at,
        table_ids=[t.id for t in rows],
        table_names=[t.name for t in rows],
        total_capacity=total_capacity,
        tagged_guest_count=tagged_count,
        assigned_seat_count=assigned_count,
    )


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/{event_id}/table-groups", response_model=list[TableGroupOut])
async def list_table_groups(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    groups = (await db.execute(
        select(TableGroup).where(TableGroup.event_id == event_id).order_by(TableGroup.name)
    )).scalars().all()
    return [await _group_out(g, db) for g in groups]


@router.post("/{event_id}/table-groups", response_model=TableGroupOut, status_code=201)
async def create_table_group(
    event_id: str,
    data: TableGroupCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    if not await db.get(Event, event_id):
        raise HTTPException(404, "Event not found")

    tag = data.tag.strip().lower().replace(" ", "_")
    conflict = await db.scalar(
        select(TableGroup).where(TableGroup.event_id == event_id, TableGroup.tag == tag)
    )
    if conflict:
        raise HTTPException(409, f"A table group with tag '{tag}' already exists for this event")

    group = TableGroup(
        event_id=event_id,
        name=data.name.strip(),
        tag=tag,
        description=data.description,
    )
    db.add(group)
    await db.flush()  # get group.id

    # Attach initial tables if provided
    for table_id in (data.table_ids or []):
        table = await db.get(SeatingTable, table_id)
        if not table or table.event_id != event_id:
            raise HTTPException(400, f"Table '{table_id}' not found in this event")
        db.add(TableGroupTable(table_group_id=group.id, table_id=table_id))

    await db.commit()
    await db.refresh(group)
    return await _group_out(group, db)


@router.put("/{event_id}/table-groups/{group_id}", response_model=TableGroupOut)
async def update_table_group(
    event_id: str,
    group_id: str,
    data: TableGroupUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    group = await db.get(TableGroup, group_id)
    if not group or group.event_id != event_id:
        raise HTTPException(404, "Table group not found")

    if data.name is not None:
        group.name = data.name.strip()
    if data.tag is not None:
        new_tag = data.tag.strip().lower().replace(" ", "_")
        if new_tag != group.tag:
            conflict = await db.scalar(
                select(TableGroup).where(
                    TableGroup.event_id == event_id,
                    TableGroup.tag == new_tag,
                    TableGroup.id != group_id,
                )
            )
            if conflict:
                raise HTTPException(409, f"A table group with tag '{new_tag}' already exists")
        group.tag = new_tag
    if data.description is not None:
        group.description = data.description

    # Replace table memberships if provided
    if data.table_ids is not None:
        await db.execute(
            delete(TableGroupTable).where(TableGroupTable.table_group_id == group_id)
        )
        for table_id in data.table_ids:
            table = await db.get(SeatingTable, table_id)
            if not table or table.event_id != event_id:
                raise HTTPException(400, f"Table '{table_id}' not found in this event")
            db.add(TableGroupTable(table_group_id=group_id, table_id=table_id))

    await db.commit()
    await db.refresh(group)
    return await _group_out(group, db)


@router.delete("/{event_id}/table-groups/{group_id}", status_code=204)
async def delete_table_group(
    event_id: str,
    group_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    group = await db.get(TableGroup, group_id)
    if not group or group.event_id != event_id:
        raise HTTPException(404, "Table group not found")

    # Check for active guest assignments
    tagged = await db.scalar(
        select(func.count(Guest.id)).where(Guest.table_group_id == group_id)
    ) or 0
    if tagged > 0:
        raise HTTPException(
            409,
            f"Cannot delete — {tagged} guest(s) are assigned to this group. "
            "Reassign or clear their table group first.",
        )

    await db.delete(group)
    await db.commit()


# ── Bulk import ──────────────────────────────────────────────────────────────

def _parse_group_csv(csv_text: str) -> list[BulkTableGroupRow]:
    rows = []
    reader = csv.DictReader(io.StringIO(csv_text.strip()))
    if reader.fieldnames and len(reader.fieldnames) >= 2:
        fields = [f.lower() for f in reader.fieldnames]
        name_key = next((reader.fieldnames[i] for i, f in enumerate(fields) if 'name' in f), reader.fieldnames[0])
        tag_key  = next((reader.fieldnames[i] for i, f in enumerate(fields) if 'tag' in f), reader.fieldnames[1] if len(reader.fieldnames) > 1 else None)
        desc_key = next((reader.fieldnames[i] for i, f in enumerate(fields) if 'desc' in f), None)
        tbl_key  = next((reader.fieldnames[i] for i, f in enumerate(fields) if 'table' in f), None)
        for row in reader:
            rows.append(BulkTableGroupRow(
                name=(row.get(name_key) or '').strip(),
                tag=(row.get(tag_key) or '').strip() if tag_key else '',
                description=(row.get(desc_key) or '').strip() or None if desc_key else None,
                tables=(row.get(tbl_key) or '').strip() or None if tbl_key else None,
            ))
    return rows


@router.post("/{event_id}/table-groups/bulk", response_model=BulkTableGroupImportResult, status_code=201)
async def bulk_create_table_groups(
    event_id: str,
    data: BulkTableGroupImportRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    if not await db.get(Event, event_id):
        raise HTTPException(404, "Event not found")

    if data.csv_text:
        try:
            raw_rows = _parse_group_csv(data.csv_text)
        except Exception as exc:
            raise HTTPException(400, f"CSV parse error: {exc}")
    elif data.rows:
        raw_rows = data.rows
    else:
        raise HTTPException(400, "Provide either rows (JSON array) or csv_text")

    if not raw_rows:
        raise HTTPException(400, "No rows found in input")

    # Pre-load existing tags and tables by name for this event
    existing_tags: set[str] = set(
        (await db.execute(select(TableGroup.tag).where(TableGroup.event_id == event_id))).scalars().all()
    )
    tables_by_name: dict[str, SeatingTable] = {
        t.name.lower(): t
        for t in (await db.execute(select(SeatingTable).where(SeatingTable.event_id == event_id))).scalars().all()
    }

    errors: list[BulkImportError] = []
    to_create: list[tuple[BulkTableGroupRow, str, list[str]]] = []  # (row, norm_tag, table_ids)
    seen_tags: set[str] = set()
    skipped = 0

    for i, row in enumerate(raw_rows, start=1):
        name = row.name.strip()
        raw_tag = row.tag.strip()
        norm_tag = raw_tag.lower().replace(" ", "_")

        if not name:
            errors.append(BulkImportError(row=i, reason="name is required", data={"name": name, "tag": raw_tag}))
            if data.mode == "strict": break
            continue
        if not norm_tag:
            errors.append(BulkImportError(row=i, reason="tag is required", data={"name": name}))
            if data.mode == "strict": break
            continue

        # Duplicate tag in payload
        if norm_tag in seen_tags:
            errors.append(BulkImportError(row=i, reason=f"duplicate tag '{norm_tag}' in import", data={"name": name, "tag": norm_tag}))
            if data.mode == "strict": break
            continue
        seen_tags.add(norm_tag)

        # Duplicate tag in DB
        if norm_tag in existing_tags:
            if data.on_duplicate == "error":
                errors.append(BulkImportError(row=i, reason=f"tag '{norm_tag}' already exists", data={"name": name, "tag": norm_tag}))
                if data.mode == "strict": break
            else:
                skipped += 1
            continue

        # Resolve table names to IDs
        table_ids: list[str] = []
        table_errors: list[str] = []
        if row.tables:
            for tname in [t.strip() for t in row.tables.split(',') if t.strip()]:
                tbl = tables_by_name.get(tname.lower())
                if not tbl:
                    table_errors.append(tname)
                else:
                    table_ids.append(tbl.id)
        if table_errors:
            errors.append(BulkImportError(row=i, reason=f"unknown tables: {', '.join(table_errors)}", data={"name": name, "tag": norm_tag}))
            if data.mode == "strict": break
            continue

        to_create.append((row, norm_tag, table_ids))

    if data.mode == "strict" and errors:
        return BulkTableGroupImportResult(created=0, skipped=0, errors=errors, dry_run=data.dry_run)

    if data.dry_run:
        return BulkTableGroupImportResult(
            created=len(to_create),
            skipped=skipped,
            errors=errors,
            dry_run=True,
        )

    created_ids: list[str] = []
    for row, norm_tag, table_ids in to_create:
        group = TableGroup(
            event_id=event_id,
            name=row.name.strip(),
            tag=norm_tag,
            description=row.description,
        )
        db.add(group)
        await db.flush()
        for tid in table_ids:
            db.add(TableGroupTable(table_group_id=group.id, table_id=tid))
        created_ids.append(group.id)

    await db.commit()
    return BulkTableGroupImportResult(
        created=len(to_create),
        skipped=skipped,
        errors=errors,
        created_ids=created_ids,
        dry_run=False,
    )


# ── Guest assignment ──────────────────────────────────────────────────────────

@router.post("/{event_id}/table-groups/{group_id}/assign-guests", response_model=dict)
async def assign_guests_to_group(
    event_id: str,
    group_id: str,
    data: TableGroupAssignRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Bulk-assign a list of guests to this table group.
    Pass group_id=null in the body to clear the assignment."""
    group = await db.get(TableGroup, group_id)
    if not group or group.event_id != event_id:
        raise HTTPException(404, "Table group not found")

    updated = 0
    for guest_id in data.guest_ids:
        guest = await db.get(Guest, guest_id)
        if not guest or guest.event_id != event_id:
            continue
        guest.table_group_id = group_id
        updated += 1

    await db.commit()
    return {"updated": updated}


@router.delete("/{event_id}/table-groups/{group_id}/assign-guests", response_model=dict)
async def clear_guests_from_group(
    event_id: str,
    group_id: str,
    data: TableGroupAssignRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Bulk-clear the table group assignment for a list of guests."""
    group = await db.get(TableGroup, group_id)
    if not group or group.event_id != event_id:
        raise HTTPException(404, "Table group not found")

    updated = 0
    for guest_id in data.guest_ids:
        guest = await db.get(Guest, guest_id)
        if not guest or guest.event_id != event_id:
            continue
        if guest.table_group_id == group_id:
            guest.table_group_id = None
            updated += 1

    await db.commit()
    return {"updated": updated}
