import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine
from .config import settings
from .routers import events, guests, scanner, dashboard, seating, menu
from .routers import auth as auth_router
from .routers import invite as invite_router
from . import sync_poller, db_migrate


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Safety net: applies missing tables/columns if the deploy pipeline didn't
    # already run them. The pipeline phase (`python -m app.db_migrate`) is
    # preferred — it fails fast before swapping production.
    await db_migrate.apply(engine)

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
app.include_router(invite_router.router, prefix="/api/invite", tags=["invite"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
