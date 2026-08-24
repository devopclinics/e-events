"""Festio Live (engagement-service) — standalone microservice for live
quizzes, polls, surveys, ratings, and feedback.

Never imports the main backend or its database. Trusts only the scoped JWT
minted by the main backend's POST /api/auth/live-token (staff) or
POST /api/events/{id}/live/guest-token (guest) — see app/auth.py.

Activity + question CRUD, question bank, guest participation with idempotent
responses, leaderboard, Q&A, word cloud, AI feedback analysis, and live
updates (SSE over engagement-service's own Redis) — see the architecture
doc's phased plan for what's still deliberately out of scope.
Runs on port 8060.
"""
import logging
import json
import time
import uuid

from fastapi import FastAPI
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import activities, analytics, bank, moderation, operations, participate, program_sync, qna, realtime

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s engagement-service %(message)s")
logger = logging.getLogger("engagement-service")
from .metrics import DEPENDENCY_HEALTH, DEPENDENCY_LATENCY, HTTP_LATENCY, HTTP_REQUESTS

app = FastAPI(title="Festio Live — engagement-service", version="0.1.0")


@app.middleware("http")
async def observe_http(request, call_next):
    started = time.perf_counter()
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
    except Exception:
        logger.exception(json.dumps({"event": "http.error", "request_id": request_id, "method": request.method, "path": request.url.path}))
        raise
    finally:
        route = request.scope.get("route")
        path = getattr(route, "path", request.url.path)
        elapsed = time.perf_counter() - started
        HTTP_REQUESTS.labels(request.method, path, str(status)).inc()
        HTTP_LATENCY.labels(request.method, path).observe(elapsed)
        logger.info(json.dumps({"event": "http.request", "request_id": request_id, "method": request.method, "path": path, "status": status, "duration_ms": round(elapsed * 1000, 2)}))
    response.headers["X-Request-ID"] = request_id
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(",") if settings.cors_origins else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(activities.router)
app.include_router(bank.router)
app.include_router(participate.router)
app.include_router(qna.router)
app.include_router(moderation.router)
app.include_router(analytics.router)
app.include_router(realtime.router)
app.include_router(operations.router)
app.include_router(program_sync.router)
app.include_router(program_sync.internal_router)


@app.on_event("startup")
async def on_startup():
    logger.info("engagement-service ready (configured=%s)", bool(settings.internal_service_token))


@app.get("/health")
@app.get("/api/engagement/health", include_in_schema=False)
def health():
    return {"status": "ok", "service": "engagement-service"}


@app.get("/health/live")
@app.get("/api/engagement/health/live", include_in_schema=False)
def health_live():
    return {"status": "ok"}


@app.get("/metrics", include_in_schema=False)
@app.get("/api/engagement/metrics", include_in_schema=False)
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/health/ready")
@app.get("/api/engagement/health/ready", include_in_schema=False)
async def health_ready():
    from fastapi import HTTPException
    from sqlalchemy import text
    from .database import SessionLocal
    try:
        started = time.perf_counter()
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
        DEPENDENCY_LATENCY.labels("postgres").observe(time.perf_counter() - started)
        DEPENDENCY_HEALTH.labels("postgres").set(1)
    except Exception as exc:  # noqa: BLE001 — readiness probe, fail closed with non-200
        DEPENDENCY_HEALTH.labels("postgres").set(0)
        raise HTTPException(503, f"Not ready: {exc}")
    redis_status = "ok"
    try:
        from .realtime import redis
        started = time.perf_counter()
        await redis.ping()
        DEPENDENCY_LATENCY.labels("redis").observe(time.perf_counter() - started)
        DEPENDENCY_HEALTH.labels("redis").set(1)
    except Exception:
        redis_status = "degraded"
        DEPENDENCY_HEALTH.labels("redis").set(0)
    return {"status": "ok", "database": "ok", "redis": redis_status}
