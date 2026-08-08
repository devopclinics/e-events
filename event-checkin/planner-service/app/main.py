"""Festio planner-service — standalone event planning suite: budget, vendors,
timeline (milestones/tasks), day-of runsheet, document vault.

Never imports the main backend or its database. Trusts only the scoped JWT
minted by the main backend's POST /api/auth/planner-token (see app/auth.py).
Runs on port 8040.
"""
import logging
import os
import uuid

import jwt
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import SessionLocal
from .models import PlannerAuditEvent
from .routers import budget, dashboard, documents, procurement, runsheet, timeline, vendors

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s planner-service %(message)s",
)
logger = logging.getLogger("planner-service")

app = FastAPI(title="Festio Planner Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(",") if settings.cors_origins else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router)
app.include_router(budget.router)
app.include_router(vendors.router)
app.include_router(procurement.router)
app.include_router(timeline.router)
app.include_router(runsheet.router)
app.include_router(documents.router)


@app.middleware("http")
async def audit_planner_mutations(request, call_next):
    """Record every authenticated planner mutation, including rejected ones.

    The business transaction remains owned by its route; the audit row is
    append-only and deliberately contains no request body or secrets.
    """
    response = await call_next(request)
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"} or not request.url.path.startswith("/api/planner/"):
        return response
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer ") or not settings.internal_service_token:
        return response
    try:
        claims = jwt.decode(authorization[7:], settings.internal_service_token, algorithms=["HS256"], audience="planner", issuer="guesthub")
        async with SessionLocal() as db:
            db.add(PlannerAuditEvent(
                id=str(uuid.uuid4()), event_id=str(claims.get("event_id") or ""),
                org_id=str(claims.get("org_id") or ""), actor_subject=str(claims.get("sub") or "unknown"),
                actor_email=str(claims.get("email") or ""), method=request.method,
                path=request.url.path, outcome="success" if response.status_code < 400 else "denied",
                status_code=response.status_code,
            ))
            await db.commit()
    except Exception:
        logger.exception("Could not append planner audit event")
    return response


@app.on_event("startup")
def _startup() -> None:
    os.makedirs(settings.upload_dir, exist_ok=True)
    logger.info("planner-service ready")


@app.get("/health")
def health():
    return {"status": "ok", "service": "planner-service"}
