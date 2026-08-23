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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import activities, analytics, bank, participate, qna, realtime

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s engagement-service %(message)s")
logger = logging.getLogger("engagement-service")

app = FastAPI(title="Festio Live — engagement-service", version="0.1.0")

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
app.include_router(analytics.router)
app.include_router(realtime.router)


@app.on_event("startup")
async def on_startup():
    logger.info("engagement-service ready (configured=%s)", bool(settings.internal_service_token))


@app.get("/health")
def health():
    return {"status": "ok", "service": "engagement-service"}


@app.get("/health/live")
def health_live():
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready():
    from fastapi import HTTPException
    from sqlalchemy import text
    from .database import SessionLocal
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "ok"}
    except Exception as exc:  # noqa: BLE001 — readiness probe, fail closed with non-200
        raise HTTPException(503, f"Not ready: {exc}")
