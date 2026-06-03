import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from .database import engine, Base
from .config import settings
from .routers import events, guests, scanner, dashboard, seating, menu, system
from .routers import auth as auth_router
from . import sync_poller


# Idempotent column additions for tables that already existed when these
# fields were introduced. Postgres-only — uses IF NOT EXISTS.
_SCHEMA_PATCHES = [
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS source_url VARCHAR(1000)",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS source_sync_interval_seconds INTEGER DEFAULT 60",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS source_last_sync_at TIMESTAMP",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS source_last_error TEXT",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _SCHEMA_PATCHES:
            await conn.execute(text(stmt))

    poller_task = asyncio.create_task(sync_poller.run())
    try:
        yield
    finally:
        poller_task.cancel()
        try:
            await poller_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Event Check-In QR System", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/api/auth",   tags=["auth"])
app.include_router(events.router,      prefix="/api/events", tags=["events"])
app.include_router(guests.router,      prefix="/api/events", tags=["guests"])
app.include_router(seating.router,     prefix="/api/events", tags=["seating"])
app.include_router(menu.router,        prefix="/api/events", tags=["menu"])
app.include_router(scanner.router,     prefix="/api/scan",   tags=["scanner"])
app.include_router(dashboard.router,   prefix="/api/events", tags=["dashboard"])
app.include_router(system.router,      prefix="/api/system", tags=["system"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
