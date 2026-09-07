from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from .config import settings

# pool_pre_ping recycles dead connections before use (Postgres/network drops a
# long-idle connection otherwise -> "connection is closed" 500s over long uptime).
# pool_recycle proactively retires connections before the server's idle timeout.
#
# pool_size + max_overflow = 15 connections/pod max. Sized together with
# backend's HPA maxReplicas (festio-infra values.yaml, capped at 4): worst
# case is 4 * 15 = 60 connections from backend, leaving headroom under
# Postgres's max_connections=100 for dashboard-service's fixed pool (10+5)
# and the other single-replica services on the same database. The old
# 20/10 (=30/pod) could reach 300 connections at the previous maxReplicas=10
# -- invisible at idle, but a real risk of connection exhaustion (which
# looks like intermittent slowness/errors, not a clean outage) the first
# time a real traffic spike actually triggered full scale-out.

# statement_timeout / idle_in_transaction_session_timeout cap how long any one
# connection can be held (query stuck, or a task cancelled mid-await abandons
# the transaction). Without these both default to 0 (unlimited) at the DB
# level, so a single stuck request leaks a connection forever instead of
# freeing it back to the pool -- this is what silently exhausted the pool
# across 2026-09-05/06 (dozens of connections stuck 20+ hours, blocking real
# traffic and login). Applied engine-wide since sessions are opened from many
# places (get_db, sync_poller.py, entitlements.py, main.py's outbox tasks),
# not just one dependency. 60s/120s is generous for any real API request or
# migration backfill; DDL_LOCK_TIMEOUT in db_migrate.py separately governs
# lock-wait time for schema changes and is unaffected by this.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=10,
    max_overflow=5,
    connect_args={
        "server_settings": {
            "statement_timeout": "60000",
            "idle_in_transaction_session_timeout": "120000",
        }
    },
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
