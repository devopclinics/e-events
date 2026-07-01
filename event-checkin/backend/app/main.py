import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .database import engine
from .config import settings
from .routers import events, guests, scanner, dashboard, seating, menu, logistics, registry, access, trials, classify, messaging, templates as templates_router, self_checkin
from .routers import auth as auth_router
from .routers import invite as invite_router
from .routers import billing as billing_router
from .routers import admin as admin_router
from .routers import design_proxy as design_proxy_router
from . import sync_poller, db_migrate

# Override with UPLOADS_DIR for local/test runs; defaults to the in-container path.
UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")


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
app.include_router(logistics.router,   prefix="/api/events", tags=["logistics"])
app.include_router(logistics.vendor_router, prefix="/api/vendor", tags=["vendor"])
app.include_router(registry.router,    prefix="/api/events", tags=["registry"])
app.include_router(registry.registry_router, prefix="/api/registry", tags=["registry-public"])
app.include_router(access.router,      prefix="/api/events", tags=["access"])
app.include_router(classify.router,    prefix="/api/events", tags=["classify"])
app.include_router(scanner.router,     prefix="/api/scan",   tags=["scanner"])
app.include_router(dashboard.router,   prefix="/api/events", tags=["dashboard"])
app.include_router(invite_router.router, prefix="/api/invite", tags=["invite"])
app.include_router(billing_router.router, prefix="/api/billing", tags=["billing"])
app.include_router(trials.router, prefix="/api", tags=["trials"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["admin"])
app.include_router(messaging.router, prefix="/api/messaging", tags=["messaging"])
app.include_router(templates_router.router, prefix="/api/events", tags=["templates"])
app.include_router(self_checkin.router, prefix="/api/e", tags=["self-checkin"])
app.include_router(design_proxy_router.router, prefix="/api/events", tags=["design"])

# Serve uploaded files (cover images, etc.)
os.makedirs(UPLOADS_DIR, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
