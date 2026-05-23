from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base
from .config import settings
from .routers import events, guests, scanner, dashboard
from .routers import auth as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="Event Check-In QR System", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(events.router, prefix="/api/events", tags=["events"])
app.include_router(guests.router, prefix="/api/events", tags=["guests"])
app.include_router(scanner.router, prefix="/api/scan", tags=["scanner"])
app.include_router(dashboard.router, prefix="/api/events", tags=["dashboard"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
