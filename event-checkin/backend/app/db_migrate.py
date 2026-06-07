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
import logging
import sys
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.schema import CreateColumn
from .database import engine, Base
from . import models  # noqa: F401 — ensure all models register on Base.metadata

logger = logging.getLogger("db_migrate")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

_PG_DIALECT = postgresql.dialect()


# Escape hatch for migrations the ORM-diff auto-patcher can't express:
# data backfills, column renames, type changes, server_default tweaks,
# index/constraint adds, etc. Plain ORM column additions DO NOT need an
# entry here — apply() auto-generates ALTERs for those.
SCHEMA_PATCHES: list[str] = [
    "ALTER TABLE guest_menu_choices DROP CONSTRAINT IF EXISTS uq_guest_category",
    # Relax menu_item_id: a row may now hold a combination_id instead (combo categories).
    # Original table created the column NOT NULL; auto-patch only adds columns,
    # so this constraint-drop has to live here.
    "ALTER TABLE guest_menu_choices ALTER COLUMN menu_item_id DROP NOT NULL",
    # guests.email was created NOT NULL; events with rsvp_collect_email=False now
    # register guests with no email. Auto-patch only adds columns, so relax here.
    "ALTER TABLE guests ALTER COLUMN email DROP NOT NULL",

    # ── Multi-tenancy backfill (idempotent) — see docs/PHASE1-MULTITENANCY-PLAN.md.
    # Runs after create_all (organizations/memberships tables) and auto-patch
    # (events.org_id, users.is_platform_superadmin). Safe to re-run every deploy.
    #
    # 1) Default organization for all pre-existing data.
    "INSERT INTO organizations (id, name, slug, region, currency, plan, created_at) "
    "SELECT '00000000-0000-0000-0000-000000000001', 'vsgs', 'vsgs', 'US', 'USD', 'free', now() "
    "WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001')",
    # 2) Attach orphan events to the default org.
    "UPDATE events SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL",
    # 3) Membership for every existing user (legacy admins -> owner, else staff).
    "INSERT INTO memberships (id, org_id, user_id, role, created_at) "
    "SELECT gen_random_uuid()::text, '00000000-0000-0000-0000-000000000001', u.id, "
    "CASE WHEN u.role = 'admin' THEN 'owner' ELSE 'staff' END, now() "
    "FROM users u WHERE NOT EXISTS ("
    "SELECT 1 FROM memberships m WHERE m.org_id = '00000000-0000-0000-0000-000000000001' AND m.user_id = u.id)",
    # 4) Operator superadmin (no-op until that account exists; D3 also sets it at sign-in).
    "UPDATE users SET is_platform_superadmin = TRUE WHERE email = 'info@devopclinics.com'",
    # 5) D4: every event now has an org (backfilled above + create_event stamps it).
    "ALTER TABLE events ALTER COLUMN org_id SET NOT NULL",
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
            ("tier50",      "tier", "Up to 50 guests",     "50",   100,  2900,  2500000,  1),
            ("tier150",     "tier", "Up to 150 guests",    "150",  300,  5900,  5500000,  2),
            ("tier300",     "tier", "Up to 300 guests",    "300",  600,  9900,  9500000,  3),
            ("unlimited",   "tier", "300+ (unlimited)",    "NULL", 1500, 14900, 15000000, 4),
            ("credits_100", "pack", "100 message credits", "NULL", 100,  500,   500000,   1),
            ("credits_500", "pack", "500 message credits", "NULL", 500,  2000,  2000000,  2),
            ("credits_2000","pack", "2,000 message credits","NULL",2000, 6000,  6000000,  3),
        ]
    ],
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


async def apply(eng: AsyncEngine) -> None:
    """Create missing tables, auto-generate + run column ALTERs, then run any
    manual SCHEMA_PATCHES. Idempotent."""
    # 1. New tables.
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 2. Auto-generated patches from ORM-vs-DB diff.
    auto = await auto_patch(eng)
    if auto:
        logger.info("Auto-generated %d ALTER patch(es) from ORM diff:", len(auto))
        for stmt in auto:
            logger.info("  %s", stmt)
    else:
        logger.info("No ORM/DB column drift detected")

    # 3. Apply auto patches + any manual escape-hatch patches.
    async with eng.begin() as conn:
        for stmt in auto:
            await conn.execute(text(stmt))
        for stmt in SCHEMA_PATCHES:
            await conn.execute(text(stmt))

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
