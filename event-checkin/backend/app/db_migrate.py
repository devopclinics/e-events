"""Database migration runner.

Two responsibilities:
  1. Apply schema changes (create new tables + ALTER existing tables).
  2. Verify the live schema matches the SQLAlchemy ORM after applying.

Called from two places:
  - app/main.py lifespan  — safety net so a backend that boots without the
    pipeline (e.g. local dev) still gets the right schema.
  - deploy.sh phase 3.5    — fail-fast check before swapping prod containers.

Run standalone:
    python -m app.db_migrate
Exits 0 on success, 1 on any failure.
"""
import asyncio
import os
import logging
import sys
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.schema import CreateColumn
from .config import settings
from .database import engine, Base
from . import models  # noqa: F401 — ensure all models register on Base.metadata

logger = logging.getLogger("db_migrate")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

_PG_DIALECT = postgresql.dialect()


# Escape hatch for migrations the ORM-diff auto-patcher can't express:
# data backfills, column renames, type changes, server_default tweaks,
# index/constraint adds, etc. Plain ORM column additions DO NOT need an
# entry here — apply() auto-generates ALTERs for those.
def _guarded_drop_not_null(table: str, column: str) -> str:
    """DROP NOT NULL only while the column is still NOT NULL. A bare
    ALTER takes an AccessExclusiveLock on every deploy even when it is a
    no-op — against a live multi-replica backend that queues/deadlocks
    (bit us on the 2.0.56 promote). The guard makes re-runs lock-free."""
    return (
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}' "
        "AND is_nullable = 'NO') THEN "
        f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL; "
        "END IF; END $$"
    )


SCHEMA_PATCHES: list[str] = [
    # Guarded: only touches the table while the constraint still exists.
    "DO $$ BEGIN "
    "IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_guest_category') THEN "
    "ALTER TABLE guest_menu_choices DROP CONSTRAINT uq_guest_category; "
    "END IF; END $$",
    # Relax menu_item_id: a row may now hold a combination_id instead (combo categories).
    # Original table created the column NOT NULL; auto-patch only adds columns,
    # so this constraint-drop has to live here.
    _guarded_drop_not_null("guest_menu_choices", "menu_item_id"),
    # guests.email was created NOT NULL; events with rsvp_collect_email=False now
    # register guests with no email. Auto-patch only adds columns, so relax here.
    _guarded_drop_not_null("guests", "email"),
    # Payments are org-level audit rows; deleting an event detaches them.
    _guarded_drop_not_null("payments", "event_id"),

    # ── Multi-tenancy backfill (idempotent) — see docs/PHASE1-MULTITENANCY-PLAN.md.
    # Runs after create_all (organizations/memberships tables) and auto-patch
    # (events.org_id, users.is_platform_superadmin). Safe to re-run every deploy.
    #
    # 1) Default organization for all pre-existing data.
    "INSERT INTO organizations (id, name, slug, region, currency, plan, created_at, is_active) "
    "SELECT '00000000-0000-0000-0000-000000000001', 'vsgs', 'vsgs', 'US', 'USD', 'free', now(), TRUE "
    "WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001')",
    # 2) Attach orphan events to the default org.
    "UPDATE events SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL",
    # 3) Membership in the default org for every PRE-EXISTING (legacy) user.
    #    CRITICAL: the cutoff makes this legacy-only. Without it this runs every
    #    deploy and auto-enrolls brand-new signups (who already have their own
    #    org) as staff in the shared default org — a cross-tenant leak letting
    #    them see other tenants' events. New users get only their personal org
    #    (provisioned in get_current_user); they must never land here.
    "INSERT INTO memberships (id, org_id, user_id, role, created_at) "
    "SELECT gen_random_uuid()::text, '00000000-0000-0000-0000-000000000001', u.id, "
    "CASE WHEN u.role = 'admin' THEN 'owner' ELSE 'staff' END, now() "
    "FROM users u WHERE u.created_at < TIMESTAMP '2026-06-07 02:30:00' AND NOT EXISTS ("
    "SELECT 1 FROM memberships m WHERE m.org_id = '00000000-0000-0000-0000-000000000001' AND m.user_id = u.id)",
    # 3b) Clean up leaks already created by the un-cutoff'd step 3: remove the
    #     auto-added default-org STAFF membership from any post-cutoff self-signup
    #     who owns their own org. Idempotent. Leaves legacy members, deliberate
    #     'admin'/'owner' grants, and invite-only users (no own org) untouched.
    "DELETE FROM memberships m USING users u "
    "WHERE m.user_id = u.id "
    "AND m.org_id = '00000000-0000-0000-0000-000000000001' AND m.role = 'staff' "
    "AND u.created_at >= TIMESTAMP '2026-06-07 02:30:00' "
    "AND EXISTS (SELECT 1 FROM memberships o WHERE o.user_id = m.user_id "
    "AND o.role = 'owner' AND o.org_id <> '00000000-0000-0000-0000-000000000001')",
    # 4) Operator superadmin (no-op until that account exists; D3 also sets it at sign-in).
    "UPDATE users SET is_platform_superadmin = TRUE WHERE email = 'info@devopclinics.com'",
    # 5) D4: every event now has an org (backfilled above + create_event stamps it).
    #    Guarded: only take the AccessExclusiveLock when org_id is still nullable
    #    (a not-yet-migrated DB). On already-migrated DBs this is a no-op and
    #    grabs no lock — a bare SET NOT NULL re-locks `events` every deploy and
    #    deadlocks against the live backend's reads.
    "DO $$ BEGIN "
    "IF EXISTS (SELECT 1 FROM information_schema.columns "
    "WHERE table_name = 'events' AND column_name = 'org_id' AND is_nullable = 'YES') THEN "
    "ALTER TABLE events ALTER COLUMN org_id SET NOT NULL; "
    "END IF; END $$",
    # 6) Phase 2: grandfather all PRE-EXISTING events to a comp (unlimited, paid)
    #    tier so entitlement gates never break events created before billing.
    #    Fixed cutoff → idempotent and never touches events created afterward.
    "UPDATE events SET is_paid = TRUE, paid_channels = TRUE, plan_tier = 'comp', "
    "message_credits = 100000 "
    "WHERE created_at < TIMESTAMP '2026-06-07 02:30:00' AND plan_tier = 'free'",

    # 7) Phase 3: seed editable pricing plans (idempotent; superadmin can edit later).
    *[
        "INSERT INTO pricing_plans (key, kind, label, guest_cap, credits, usd, ngn, active, sort_order) "
        f"SELECT '{k}', '{kind}', '{label}', {cap}, {cr}, {usd}, {ngn}, TRUE, {so} "
        f"WHERE NOT EXISTS (SELECT 1 FROM pricing_plans WHERE key = '{k}')"
        for (k, kind, label, cap, cr, usd, ngn, so) in [
            ("tier50",      "tier", "Starter · up to 50 guests",     "50",   100,  2900,  2900000,  1),
            ("tier150",     "tier", "Standard · up to 150 guests",   "150",  300,  5900,  6500000,  2),
            ("tier300",     "tier", "Pro · up to 300 guests",        "300",  700,  9900,  11000000, 3),
            ("scale",       "tier", "Scale · up to 1,000 guests",    "1000", 2000, 14900, 18000000, 4),
            ("credits_100", "pack", "100 message credits", "NULL", 100,  600,   500000,   1),
            ("credits_500", "pack", "500 message credits", "NULL", 500,  2500,  2000000,  2),
            ("credits_2000","pack", "2,000 message credits","NULL",2000, 8000,  7000000,  3),
        ]
    ],
    # Keep live pricing aligned with the current public packaging. This is
    # intentionally idempotent and updates rows seeded by earlier releases.
    "UPDATE pricing_plans SET label='Starter · up to 50 guests', guest_cap=50, credits=100, usd=2900, ngn=2900000, active=TRUE, sort_order=1 WHERE key='tier50'",
    "UPDATE pricing_plans SET label='Standard · up to 150 guests', guest_cap=150, credits=300, usd=5900, ngn=6500000, active=TRUE, sort_order=2 WHERE key='tier150'",
    "UPDATE pricing_plans SET label='Pro · up to 300 guests', guest_cap=300, credits=700, usd=9900, ngn=11000000, active=TRUE, sort_order=3 WHERE key='tier300'",
    "UPDATE pricing_plans SET label='Scale · up to 1,000 guests', guest_cap=1000, credits=2000, usd=14900, ngn=18000000, active=TRUE, sort_order=4 WHERE key='scale'",
    "UPDATE pricing_plans SET label='Legacy Scale · up to 1,000 guests', guest_cap=1000, credits=2000, usd=14900, ngn=18000000, active=FALSE WHERE key='unlimited'",
    "UPDATE pricing_plans SET usd=600, ngn=500000 WHERE key='credits_100'",
    "UPDATE pricing_plans SET usd=2500, ngn=2000000 WHERE key='credits_500'",
    "UPDATE pricing_plans SET usd=8000, ngn=7000000 WHERE key='credits_2000'",
    # RSVP links: backfill an unguessable share token on older events and add a
    # uniqueness constraint where the auto-patcher only added the bare column.
    "UPDATE events SET rsvp_token = gen_random_uuid()::text WHERE rsvp_token IS NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_events_rsvp_token_unique ON events (rsvp_token)",

    # Seat uniqueness: a (event, table, seat) triple holds at most one guest.
    # 1) Free any duplicate seats the pre-constraint code may have created —
    #    keep the earliest-admitted guest at the seat, null the seat on the rest
    #    so they get reseated on next scan. Idempotent (no-op once clean).
    "UPDATE guests SET seat_number = NULL WHERE id IN ("
    "SELECT id FROM (SELECT id, ROW_NUMBER() OVER ("
    "PARTITION BY event_id, table_id, seat_number "
    "ORDER BY admitted_at IS NULL, admitted_at, id) AS rn "
    "FROM guests WHERE table_id IS NOT NULL AND seat_number IS NOT NULL) d "
    "WHERE d.rn > 1)",
    # 2) Add the partial unique index (mirrors the ORM Index on Guest, which only
    #    create_all'd on fresh DBs; existing prod tables get it here).
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_table_seat ON guests "
    "(event_id, table_id, seat_number) "
    "WHERE table_id IS NOT NULL AND seat_number IS NOT NULL",

    # ── dashboard-service (Results command center) composite indexes ──────────
    # scan_events already existed pre-dashboard-service with only single-column
    # indexes; the ORM's __table_args__ Index() only auto-creates on a fresh
    # table, so existing installs need these added here.
    "CREATE INDEX IF NOT EXISTS ix_scan_events_event_scanned_at ON scan_events (event_id, scanned_at)",
    "CREATE INDEX IF NOT EXISTS ix_scan_events_event_guest_scanned_at ON scan_events (event_id, guest_id, scanned_at)",
]


def _render_python_default(default_arg) -> str | None:
    """Translate a Python literal default to a SQL DEFAULT value.
    Returns None for callables or unknown types (caller skips DEFAULT)."""
    # bool BEFORE int — bool is a subclass of int in Python.
    if isinstance(default_arg, bool):
        return "TRUE" if default_arg else "FALSE"
    if isinstance(default_arg, (int, float)):
        return str(default_arg)
    if isinstance(default_arg, str):
        escaped = default_arg.replace("'", "''")
        return f"'{escaped}'"
    return None


def _column_add_ddl(col) -> str:
    """Build a column definition suitable for ALTER TABLE ADD COLUMN.

    SQLAlchemy's CreateColumn emits type + NOT NULL but omits:
      - Python-side defaults (they're INSERT-time, not DDL)
      - FOREIGN KEY references (rendered as table-level constraints by CreateTable)

    Both are appended here so the ALTER succeeds on tables with existing rows
    (DEFAULT) and so referential integrity is preserved (REFERENCES).
    """
    base = str(CreateColumn(col).compile(dialect=_PG_DIALECT)).strip()

    # Inject DEFAULT for NOT NULL columns so the ALTER doesn't fail on tables
    # with existing rows.
    needs_default = "NOT NULL" in base and "DEFAULT" not in base.upper()
    if needs_default and col.default is not None and not col.default.is_callable:
        sql_default = _render_python_default(col.default.arg)
        if sql_default is not None:
            base = base.replace("NOT NULL", f"NOT NULL DEFAULT {sql_default}")
        else:
            logger.warning(
                "Column %s.%s is NOT NULL with a non-scalar default — ALTER may fail "
                "on tables with existing rows. Add a server_default or a manual "
                "entry in SCHEMA_PATCHES.",
                col.table.name, col.name,
            )

    # Append FK references inline.
    for fk in col.foreign_keys:
        target = fk.target_fullname  # e.g. "seating_tables.id"
        if "." in target:
            t, c = target.split(".", 1)
            base += f" REFERENCES {t}({c})"

    return base


async def auto_patch(eng: AsyncEngine) -> list[str]:
    """Diff ORM-declared columns against live DB; return ALTER statements
    for columns present in the ORM but missing from the live schema."""
    async with eng.connect() as conn:
        live_tables = {
            row[0] for row in await conn.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname='public'")
            )
        }
        live_cols: dict[str, set[str]] = {}
        for tname, cname in await conn.execute(text(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema='public'"
        )):
            live_cols.setdefault(tname, set()).add(cname)

    patches: list[str] = []
    for table_name, table in Base.metadata.tables.items():
        if table_name not in live_tables:
            # New table — create_all handles it; nothing to ALTER.
            continue
        existing = live_cols.get(table_name, set())
        for col in table.columns:
            if col.name in existing:
                continue
            patches.append(
                f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {_column_add_ddl(col)}"
            )
    return patches


# DDL vs a live backend: never queue behind traffic (lock_timeout) and treat
# lock timeouts/deadlocks as retryable — every statement here is idempotent.
# The 2.0.56 promote deadlocked twice against the running replicas before the
# third attempt won; this makes each attempt fail fast and retry in-process.
DDL_LOCK_TIMEOUT = os.getenv("MIGRATE_LOCK_TIMEOUT", "5s")
DDL_LOCK_ATTEMPTS = max(1, int(os.getenv("MIGRATE_LOCK_ATTEMPTS", "10")))
DDL_RETRY_WAIT_SECONDS = float(os.getenv("MIGRATE_RETRY_WAIT_SECONDS", "5"))


def _is_lock_contention(exc: Exception) -> bool:
    s = str(exc).lower()
    return "deadlock detected" in s or "lock timeout" in s


async def _apply_patches_once(eng: AsyncEngine, auto: list[str]) -> None:
    async with eng.begin() as conn:
        await conn.execute(text(f"SET lock_timeout = '{DDL_LOCK_TIMEOUT}'"))
        for stmt in auto:
            await conn.execute(text(stmt))
        for stmt in SCHEMA_PATCHES:
            await conn.execute(text(stmt))


def _pg_literal(s: str) -> str:
    """Single-quote a string for interpolation into DDL (CREATE ROLE has no
    bind-parameter form). Values come from server-side settings, not user
    input, but escape quotes defensively anyway."""
    return "'" + s.replace("'", "''") + "'"


async def provision_dashboard_ro(eng: AsyncEngine) -> None:
    """Idempotently create/refresh the dashboard-service read-only Postgres
    role: SELECT on every current table, plus a default-privilege so future
    tables are readable without a manual grant. Runs every deploy — cheap,
    and keeps the role's password in sync if it's ever rotated via env var.

    Without this, a fresh prod database has no `dashboard_ro` role at all —
    dashboard-service was only ever provisioned by hand on staging."""
    db_name = eng.url.database
    pw = _pg_literal(settings.dashboard_ro_db_password)
    async with eng.begin() as conn:
        await conn.execute(text(
            "DO $$ BEGIN "
            "IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashboard_ro') THEN "
            f"CREATE ROLE dashboard_ro LOGIN PASSWORD {pw}; "
            "END IF; END $$"
        ))
        # Keep the password current even if the role already existed (e.g. rotation).
        await conn.execute(text(f"ALTER ROLE dashboard_ro PASSWORD {pw}"))
        await conn.execute(text(f'GRANT CONNECT ON DATABASE "{db_name}" TO dashboard_ro'))
        await conn.execute(text("GRANT USAGE ON SCHEMA public TO dashboard_ro"))
        await conn.execute(text("GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_ro"))
        await conn.execute(text(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_ro"
        ))
    logger.info("dashboard_ro role provisioned/refreshed (db=%s)", db_name)


async def apply(eng: AsyncEngine) -> None:
    """Create missing tables, auto-generate + run column ALTERs, then run any
    manual SCHEMA_PATCHES. Idempotent."""
    # 1. New tables.
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 1.5 Read-only role for dashboard-service — see provision_dashboard_ro.
    await provision_dashboard_ro(eng)

    # 2. Auto-generated patches from ORM-vs-DB diff.
    auto = await auto_patch(eng)
    if auto:
        logger.info("Auto-generated %d ALTER patch(es) from ORM diff:", len(auto))
        for stmt in auto:
            logger.info("  %s", stmt)
    else:
        logger.info("No ORM/DB column drift detected")

    # 3. Apply auto patches + any manual escape-hatch patches, retrying on
    # lock contention with the live backend.
    for attempt in range(1, DDL_LOCK_ATTEMPTS + 1):
        try:
            await _apply_patches_once(eng, auto)
            break
        except Exception as exc:
            if not _is_lock_contention(exc) or attempt == DDL_LOCK_ATTEMPTS:
                raise
            logger.warning(
                "DDL lock contention (attempt %d/%d): %s — retrying in %.0fs",
                attempt, DDL_LOCK_ATTEMPTS, str(exc).splitlines()[0], DDL_RETRY_WAIT_SECONDS,
            )
            await asyncio.sleep(DDL_RETRY_WAIT_SECONDS)

    logger.info(
        "Applied %d auto + %d manual schema patches",
        len(auto), len(SCHEMA_PATCHES),
    )


async def verify(eng: AsyncEngine) -> list[str]:
    """Compare ORM-declared schema against information_schema.

    Returns a list of mismatches (empty = healthy)."""
    mismatches: list[str] = []
    async with eng.connect() as conn:
        # Pull all existing public-schema tables + columns once.
        tables_q = await conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public'")
        )
        live_tables = {row[0] for row in tables_q}

        cols_q = await conn.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema='public'"
            )
        )
        live_cols: dict[str, set[str]] = {}
        for tname, cname in cols_q:
            live_cols.setdefault(tname, set()).add(cname)

    for table_name, table in Base.metadata.tables.items():
        if table_name not in live_tables:
            mismatches.append(f"missing table: {table_name}")
            continue
        declared_cols = {c.name for c in table.columns}
        missing = declared_cols - live_cols.get(table_name, set())
        for col in sorted(missing):
            mismatches.append(f"missing column: {table_name}.{col}")

    return mismatches


async def run() -> int:
    """Apply + verify. Returns process exit code (0 ok, 1 fail)."""
    try:
        await apply(engine)
    except Exception:
        logger.exception("Schema apply failed")
        return 1

    mismatches = await verify(engine)
    if mismatches:
        logger.error("Schema verification found %d issue(s):", len(mismatches))
        for m in mismatches:
            logger.error("  - %s", m)
        return 1

    logger.info(
        "Schema verified: %d tables, %d columns match the ORM",
        len(Base.metadata.tables),
        sum(len(t.columns) for t in Base.metadata.tables.values()),
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
