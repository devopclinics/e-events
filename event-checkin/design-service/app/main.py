"""Festio design-service — decoupled design/template layer.

Holds template families, per-event design config, and theme payloads. Never
imports core event logic; core services call it by API and always have a safe
fallback if it's down. Runs on DESIGN_SERVICE_PORT (default 8010).
"""
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .catalog import build_catalog
from .routers import design

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s design-service %(message)s",
)
logger = logging.getLogger("design-service")

app = FastAPI(title="Festio Design Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(design.router)


@app.on_event("startup")
def _startup() -> None:
    os.makedirs(settings.storage_path, exist_ok=True)
    logger.info("catalog ready: %d template families", len(build_catalog()))


@app.get("/health")
def health():
    return {"status": "ok", "service": "design-service", "templates": len(build_catalog())}
