"""Lightweight fixed-window rate limiting for public, unauthenticated endpoints.

Keyed by a path parameter (default: event_code) rather than raw client IP, so a
whole venue behind one NAT'd WiFi (hundreds of phones sharing one public IP via
Cloudflare's CF-Connecting-IP) isn't throttled as a single client. Falls back to
client IP only when the keying param is absent.

Backed by Redis (shared across replicas) when REDIS_URL is set; otherwise a
per-process in-memory counter — a coarse first layer that still works single-host.
Fails open: if the backend errors, the request is allowed rather than dropped.
"""
import logging
import os
import time
from fastapi import Request, HTTPException

logger = logging.getLogger("ratelimit")

_REDIS_URL = os.environ.get("REDIS_URL", "").strip()
_ENABLED = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() not in ("false", "0", "no")

_redis = None
# in-memory fallback: bucket key -> count (keys embed the time window, so stale
# windows are simply never touched again; we prune opportunistically).
_local: dict[str, int] = {}
_local_last_prune = 0.0


async def _get_redis():
    global _redis
    if _redis is None:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(_REDIS_URL, decode_responses=True)
    return _redis


def _prune_local(now: float) -> None:
    global _local_last_prune, _local
    if now - _local_last_prune < 60:
        return
    _local_last_prune = now
    # Keys look like "rl:<scope>:<ident>:<window_index>"; drop old windows.
    if len(_local) > 10000:
        _local = {}


async def _hit(key: str, limit: int, window: int) -> bool:
    """Increment the counter for `key`; return True if still within `limit`."""
    if _REDIS_URL:
        try:
            r = await _get_redis()
            count = await r.incr(key)
            if count == 1:
                await r.expire(key, window)
            return count <= limit
        except Exception:
            logger.exception("redis rate-limit backend failed; allowing request")
            return True  # fail open
    now = time.time()
    _prune_local(now)
    count = _local.get(key, 0) + 1
    _local[key] = count
    return count <= limit


def rate_limit(*, limit: int, window: int, scope: str, key: str = "event_code"):
    """FastAPI dependency: allow `limit` requests per `window` seconds per key.

    `key` names a path parameter to bucket by (default event_code); when it's
    missing on the route, falls back to the real client IP.
    """
    async def _dep(request: Request) -> None:
        if not _ENABLED:
            return
        ident = request.path_params.get(key)
        if not ident:
            ident = request.headers.get("cf-connecting-ip") or (
                request.client.host if request.client else "unknown"
            )
        window_index = int(time.time()) // window
        bucket = f"rl:{scope}:{ident}:{window_index}"
        if not await _hit(bucket, limit, window):
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please slow down and try again in a moment.",
            )

    return _dep
