import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .database import engine
from .config import settings
from .routers import events, guests, scanner, dashboard, seating, menu, logistics, registry, speakers, partners, reminders, access, trials, demo, classify, messaging, meta_whatsapp, resend_webhooks, templates as templates_router, self_checkin, experience, tasks
from .routers import auth as auth_router
from .routers import invite as invite_router
from .routers import billing as billing_router
from .routers import admin as admin_router
from .routers import design_proxy as design_proxy_router
from .routers import og as og_router
from .routers import floor as floor_router
from .routers import festiome as festiome_router
from .routers import engagement as engagement_router
from .routers import qa_checklist as qa_checklist_router
from .routers import platform_settings as platform_settings_router
from .routers import referrals as referrals_router
from .routers import api_keys as api_keys_router
from .routers import public_api as public_api_router
from .routers import webhooks as webhooks_router
from .routers import org_billing as org_billing_router
from .routers import calendars as calendars_router
from .routers import shortlinks as shortlinks_router
from .routers import xwireless_webhooks as xwireless_webhooks_router
from .routers import ticketing_internal as ticketing_internal_router
from .routers import redesign_telemetry as redesign_telemetry_router
from .routers import training as training_router
from . import sync_poller, db_migrate, entitlements
from .services import festiome_outbox, webhook_outbox, reminder_outbox
from . import routers
from . import storage
from .database import AsyncSessionLocal
from .models import ApiKeyRequestLog

# Override with UPLOADS_DIR for local/test runs; defaults to the in-container path.
UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Safety net: applies missing tables/columns if the deploy pipeline didn't
    # already run them. The pipeline phase (`python -m app.db_migrate`) is
    # preferred — it fails fast before swapping production.
    await db_migrate.apply(engine)

    # Load the Console-editable messaging credit weights (global + per-org
    # overrides) into entitlements.py's in-memory cache so take_message_credit/
    # take_email_credit see them without an async db call on every send.
    async with AsyncSessionLocal() as db:
        await entitlements.reload_credit_rate_cache(db)
        await entitlements.reload_addon_policy_cache(db)

    # Unlike the pollers below, this one must run on every replica (each pod
    # holds its own copy of the caches above) — keeps org-level entitlement/
    # rate changes from a Console save on one pod from going stale on the
    # others until they happen to restart.
    cache_refresh_task = asyncio.create_task(entitlements.run_cache_refresher())

    # Run the guest-list sync poller inside the web process for single-host
    # deploys (default). When scaling out, set RUN_IN_APP_POLLER=false on the
    # web pods and run exactly one dedicated poller (`python -m app.sync_poller`)
    # so events aren't re-imported by every replica.
    run_poller = os.environ.get("RUN_IN_APP_POLLER", "true").lower() not in ("false", "0", "no")
    poller_task = asyncio.create_task(sync_poller.run()) if run_poller else None
    # The transactional outbox is safe on multiple web replicas (rows are
    # claimed with SKIP LOCKED), so it has its own switch and must not silently
    # stop when the single source-list poller is moved to a dedicated process.
    run_festiome_outbox = os.environ.get("RUN_IN_APP_FESTIOME_OUTBOX", "true").lower() not in ("false", "0", "no")
    festiome_task = asyncio.create_task(festiome_outbox.run()) if run_festiome_outbox else None
    # Same SKIP LOCKED-safe multi-replica pattern as the FestioMe outbox, own switch.
    run_webhook_outbox = os.environ.get("RUN_IN_APP_WEBHOOK_OUTBOX", "true").lower() not in ("false", "0", "no")
    webhook_task = asyncio.create_task(webhook_outbox.run()) if run_webhook_outbox else None
    # Reminders scheduler -- same SKIP LOCKED-safe multi-replica claim shape,
    # own switch.
    run_reminder_outbox = os.environ.get("RUN_IN_APP_REMINDER_OUTBOX", "true").lower() not in ("false", "0", "no")
    reminder_outbox_task = asyncio.create_task(reminder_outbox.run()) if run_reminder_outbox else None

    # Start the Redis SSE fan-in subscriber (no-op unless REDIS_URL is set) so
    # dashboard events published by any replica reach the connections on this one.
    await routers.start_sse_subscriber()
    try:
        yield
    finally:
        await routers.stop_sse_subscriber()
        cache_refresh_task.cancel()
        try:
            await cache_refresh_task
        except asyncio.CancelledError:
            pass
        if poller_task is not None:
            poller_task.cancel()
            try:
                await poller_task
            except asyncio.CancelledError:
                pass
        if festiome_task is not None:
            festiome_task.cancel()
            try:
                await festiome_task
            except asyncio.CancelledError:
                pass
        if webhook_task is not None:
            webhook_task.cancel()
            try:
                await webhook_task
            except asyncio.CancelledError:
                pass
        if reminder_outbox_task is not None:
            reminder_outbox_task.cancel()
            try:
                await reminder_outbox_task
            except asyncio.CancelledError:
                pass


app = FastAPI(title="Event Check-In QR System", version="1.0.0", lifespan=lifespan)

# Prometheus metrics at /metrics (scraped internally by kube-prometheus-stack via a
# ServiceMonitor; not routed by the nginx proxy, so it isn't publicly exposed).
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    Instrumentator().instrument(app).expose(app, include_in_schema=False)
except Exception:
    # Metrics are best-effort — never block startup if the dep/instrumentation fails.
    pass

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


@app.middleware("http")
async def _audit_public_api_requests(request, call_next):
    """Logs every /api/public/v1 call (method, path, status) keyed by the
    API key that made it — the audit trail the public-API backlog ticket
    asked for. Runs AFTER the route (and its require_api_key dependency), so
    request.state.api_key_id is already set by the time we get here; skipped
    entirely for the unauthenticated /docs endpoint (no key id to log against)."""
    response = await call_next(request)
    if request.url.path.startswith("/api/public/v1"):
        api_key_id = getattr(request.state, "api_key_id", None)
        if api_key_id:
            async with AsyncSessionLocal() as db:
                db.add(ApiKeyRequestLog(
                    api_key_id=api_key_id, method=request.method,
                    path=request.url.path, status_code=response.status_code,
                ))
                await db.commit()
    return response

app.include_router(auth_router.router, prefix="/api/auth",   tags=["auth"])
app.include_router(events.router,      prefix="/api/events", tags=["events"])
app.include_router(experience.router,  prefix="/api/events", tags=["experience"])
app.include_router(guests.router,      prefix="/api/events", tags=["guests"])
app.include_router(tasks.router,       prefix="/api/events", tags=["tasks"])
app.include_router(tasks.mine_router,  prefix="/api",        tags=["tasks"])
app.include_router(seating.router,     prefix="/api/events", tags=["seating"])
app.include_router(menu.router,        prefix="/api/events", tags=["menu"])
app.include_router(logistics.router,   prefix="/api/events", tags=["logistics"])
app.include_router(logistics.vendor_router, prefix="/api/vendor", tags=["vendor"])
app.include_router(registry.router,    prefix="/api/events", tags=["registry"])
app.include_router(registry.registry_router, prefix="/api/registry", tags=["registry-public"])
app.include_router(speakers.router,    prefix="/api/events", tags=["speakers"])
app.include_router(speakers.speaker_router, prefix="/api/speakers", tags=["speakers-public"])
app.include_router(partners.router,    prefix="/api/events", tags=["partners"])
app.include_router(partners.partner_router, prefix="/api/partners", tags=["partners-public"])
app.include_router(reminders.router,   prefix="/api/events", tags=["reminders"])
app.include_router(access.router,      prefix="/api/events", tags=["access"])
app.include_router(classify.router,    prefix="/api/events", tags=["classify"])
app.include_router(scanner.router,     prefix="/api/scan",   tags=["scanner"])
app.include_router(dashboard.router,   prefix="/api/events", tags=["dashboard"])
app.include_router(invite_router.router, prefix="/api/invite", tags=["invite"])
app.include_router(billing_router.router, prefix="/api/billing", tags=["billing"])
app.include_router(trials.router, prefix="/api", tags=["trials"])
app.include_router(demo.router, prefix="/api", tags=["demo"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["admin"])
app.include_router(messaging.router, prefix="/api/messaging", tags=["messaging"])
app.include_router(meta_whatsapp.router, prefix="/api/webhooks", tags=["webhooks"])
app.include_router(resend_webhooks.router, prefix="/api/webhooks", tags=["webhooks"])
app.include_router(xwireless_webhooks_router.router, prefix="/api/webhooks", tags=["webhooks"])
app.include_router(templates_router.router, prefix="/api/events", tags=["templates"])
app.include_router(self_checkin.router, prefix="/api/e", tags=["self-checkin"])
app.include_router(design_proxy_router.router, prefix="/api/events", tags=["design"])
app.include_router(og_router.router, prefix="/api/og", tags=["og"])
app.include_router(floor_router.router, prefix="/api", tags=["floor-plan"])
app.include_router(festiome_router.router, prefix="/api/events", tags=["FestioMe"])
app.include_router(engagement_router.router, prefix="/api/events", tags=["Festio Live"])
app.include_router(qa_checklist_router.router, prefix="/api/qa-checklist", tags=["qa-checklist"])
app.include_router(platform_settings_router.router, prefix="/api/platform-settings", tags=["platform-settings"])
app.include_router(referrals_router.router, prefix="/api/organizations/me", tags=["referrals"])
app.include_router(referrals_router.admin_router, prefix="/api/organizations", tags=["referrals"])
app.include_router(api_keys_router.router, prefix="/api/organizations/me", tags=["public-api"])
app.include_router(webhooks_router.router, prefix="/api/organizations/me", tags=["webhooks-outbound"])
app.include_router(public_api_router.router, prefix="/api/public/v1", tags=["public-api"])
app.include_router(org_billing_router.router, prefix="/api/organizations/me", tags=["org-billing"])
app.include_router(calendars_router.router, prefix="/api/organizations/me", tags=["calendars"])
app.include_router(calendars_router.public_router, prefix="/api/calendars", tags=["calendars-public"])
app.include_router(shortlinks_router.router, prefix="/api/s", tags=["shortlinks"])
app.include_router(redesign_telemetry_router.router, prefix="/api/telemetry/redesign", tags=["telemetry"])
app.include_router(ticketing_internal_router.router, prefix="/api/internal/ticketing", tags=["ticketing-internal"])
app.include_router(training_router.router, prefix="/api/training", tags=["training"])

# Serve uploaded files (cover images, etc.). When S3 is configured, stream from
# the bucket so any replica can serve any file; otherwise serve from local disk.
if storage.s3_enabled():
    from fastapi import HTTPException
    from fastapi.responses import StreamingResponse

    @app.get("/api/uploads/{subpath:path}")
    async def serve_upload(subpath: str):
        result = storage.open_stream(subpath)
        if result is None:
            raise HTTPException(404, "Not found")
        chunks, content_type = result
        return StreamingResponse(chunks, media_type=content_type)
else:
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
