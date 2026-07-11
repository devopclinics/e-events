"""Small, transactional migration runner owned by the FestioMe service."""
import asyncio
from pathlib import Path

import asyncpg

from .config import settings


async def migrate() -> None:
    dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    connection = await asyncpg.connect(dsn)
    try:
        await connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version varchar(255) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        applied = {row["version"] for row in await connection.fetch("SELECT version FROM schema_migrations")}
        migration_dir = Path(__file__).resolve().parents[1] / "migrations"
        for path in sorted(migration_dir.glob("*.sql")):
            if path.name in applied:
                continue
            async with connection.transaction():
                await connection.execute(path.read_text())
                await connection.execute("INSERT INTO schema_migrations(version) VALUES($1)", path.name)
            print(f"Applied FestioMe migration {path.name}", flush=True)
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(migrate())
