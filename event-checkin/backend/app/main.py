import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .database import engine
from .config import settings
from .routers import events, guests, scanner, dashboard, seating, menu, logistics, registry, access, trials, classify, messaging, meta_whatsapp, resend_webhooks, templates as templates_router, self_checkin, experience
from .routers import auth as auth_router
from .routers import invite as invite_router
from .routers import billing as billing_router
from .routers import admin as admin_router
from .routers import design_proxy as design_proxy_router
from .routers import og as og_router
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

# The Capacitor native WebView serves the app from these origins, so the API
# must allow them or every request from the mobile app fails CORS.
_CAPACITOR_ORIGINS = ["https://localhost", "capacitor://localhost", "ionic://localhost"]
_cors_origins = [settings.frontend_url, *_CAPACITOR_ORIGINS] + [
    o.strip() for o in settings.cors_extra_origins.split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/api/auth",   tags=["auth"])
app.include_router(events.router,      prefix="/api/events", tags=["events"])
app.include_router(experience.router,  prefix="/api/events", tags=["experience"])
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
app.include_router(meta_whatsapp.router, prefix="/api/webhooks", tags=["webhooks"])
app.include_router(resend_webhooks.router, prefix="/api/webhooks", tags=["webhooks"])
app.include_router(templates_router.router, prefix="/api/events", tags=["templates"])
app.include_router(self_checkin.router, prefix="/api/e", tags=["self-checkin"])
app.include_router(design_proxy_router.router, prefix="/api/events", tags=["design"])
app.include_router(og_router.router, prefix="/api/og", tags=["og"])

# Serve uploaded files (cover images, etc.)
try:
    os.makedirs(UPLOADS_DIR, exist_ok=True)
except OSError:
    # The default in-container path (/app/uploads) isn't writable when running
    # outside the container (CI, local pytest) — fall back to a temp dir so the
    # app still imports. Prod keeps using UPLOADS_DIR unchanged.
    import tempfile
    UPLOADS_DIR = os.path.join(tempfile.gettempdir(), "eqr_uploads")
    os.makedirs(UPLOADS_DIR, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
