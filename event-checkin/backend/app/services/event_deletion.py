"""Delete event-owned rows in foreign-key order, within the caller's transaction."""
from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Base, Event, Payment, QuickInviteAlias


async def delete_event_data(db: AsyncSession, event_id: str) -> None:
    # These are organization records, not event-owned data. Keep their audit
    # history and detach the optional event association before removing the event.
    for model in (Payment, QuickInviteAlias):
        await db.execute(update(model).where(model.event_id == event_id).values(event_id=None))

    root = Event.__table__
    retained = {Payment.__table__, QuickInviteAlias.__table__}
    scopes = {root: root.c.id == event_id}
    ordered = [root]
    owned = {root}
    while True:
        descendants = {
            table for table in Base.metadata.tables.values() if table not in retained
            and any(fk.column.table in owned for fk in table.foreign_keys)
        }
        if descendants <= owned:
            break
        owned |= descendants
    pending = owned - {root}
    # Event-scoped tables own their descendants (answers, deliveries, task
    # attachments, etc.). Direct event_id always takes precedence over links to
    # another record, so unrelated events cannot be pulled into the deletion.
    while pending:
        ready = []
        for table in sorted(pending, key=lambda table: table.name):
            parents = {fk.column.table for fk in table.foreign_keys} - {table}
            if not parents.intersection(scopes):
                continue
            # Wait for other event descendants so all FK dependencies are known.
            if parents.intersection(pending):
                continue
            event_fk = next((fk for fk in table.foreign_keys if fk.column.table is root), None)
            child_scopes = [
                fk.parent.in_(select(fk.column).where(scopes[fk.column.table]))
                for fk in table.foreign_keys
                if fk.column.table in scopes and fk.column.table not in {table, root}
            ]
            if event_fk is not None:
                scope = event_fk.parent == event_id
                # Some delivery receipts identify only their guest. They still
                # belong to that guest's event when event_id is absent.
                if event_fk.parent.nullable and child_scopes:
                    scope = or_(scope, and_(event_fk.parent.is_(None), or_(*child_scopes)))
            else:
                scope = or_(*child_scopes)
            ready.append((table, scope))
        if not ready:
            raise RuntimeError(
                "Cyclic event deletion dependencies: " + ", ".join(sorted(table.name for table in pending))
            )
        for table, scope in ready:
            scopes[table] = scope
            ordered.append(table)
            pending.remove(table)

    for table in reversed(ordered):
        await db.execute(delete(table).where(scopes[table]))
