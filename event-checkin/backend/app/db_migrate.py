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
    # Prevent duplicate table names within the same event.
    # First rename any pre-existing duplicates (e.g. "Table 1" → "Table 1 (2)")
    # so the unique constraint can be created without a UniqueViolationError.
    """
    WITH dups AS (
        SELECT id,
               name || ' (' || ROW_NUMBER() OVER (PARTITION BY event_id, name ORDER BY id) || ')' AS new_name,
               ROW_NUMBER() OVER (PARTITION BY event_id, name ORDER BY id) AS rn
        FROM seating_tables
    )
    UPDATE seating_tables
    SET name = dups.new_name
    FROM dups
    WHERE seating_tables.id = dups.id
      AND dups.rn > 1;
    """,
    """
    DO $$ BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'uq_seating_table_event_name'
        ) THEN
            ALTER TABLE seating_tables ADD CONSTRAINT uq_seating_table_event_name UNIQUE (event_id, name);
        END IF;
    END $$;
    """,
    # ── Table Groups ──────────────────────────────────────────────────────────
    # table_groups and table_group_tables are new tables — create_all handles
    # them. The guest.table_group_id FK is auto-patched by the ORM diff.
    # Unique constraint on table_groups.tag per event.
    """
    DO $$ BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'uq_table_group_event_tag'
        ) THEN
            ALTER TABLE table_groups ADD CONSTRAINT uq_table_group_event_tag UNIQUE (event_id, tag);
        END IF;
    END $$;
    """,
    # ── Message Templates ─────────────────────────────────────────────────────
    # message_templates is a new table — create_all handles it.
    """
    DO $$ BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'uq_msg_template'
        ) THEN
            ALTER TABLE message_templates ADD CONSTRAINT uq_msg_template UNIQUE (scope, event_id, template_key);
        END IF;
    END $$;
    """,
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
