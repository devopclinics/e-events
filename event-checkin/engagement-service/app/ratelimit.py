"""Best-effort public endpoint limits. Redis failure deliberately fails open:
durable participation must continue when the realtime tier is unavailable."""
from fastapi import HTTPException, Request

from .realtime import redis


async def enforce_rate_limit(request: Request, scope: str, subject: str, limit: int, window: int = 60) -> None:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    client_ip = forwarded or (request.client.host if request.client else "unknown")
    key = f"engagement:limit:{scope}:{subject}:{client_ip}"
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window)
        if count > limit:
            raise HTTPException(429, "Too many requests — please wait a moment")
    except HTTPException:
        raise
    except Exception:
        return
