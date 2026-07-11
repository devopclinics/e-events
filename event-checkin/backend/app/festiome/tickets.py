"""Short-lived, single-use stream tickets for the SSE endpoint.

EventSource can't send an Authorization header, so instead of putting a Firebase
token or guest pass token in the URL (where it leaks into logs/history), the
client first POSTs an authenticated request to mint a ticket, then connects with
that opaque, ~60s, single-use ticket. Redis-backed so it works across replicas;
falls back to an in-process store when Redis isn't configured.
"""
from __future__ import annotations

import json
import os
import secrets
import time

_REDIS_URL = os.environ.get("REDIS_URL", "").strip()
_PREFIX = "festiome:tkt:"
_redis = None
_local: dict[str, tuple[dict, float]] = {}


async def _r():
    global _redis
    if _redis is None:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(_REDIS_URL, decode_responses=True)
    return _redis


async def issue(payload: dict, ttl: int = 60) -> str:
    tok = secrets.token_urlsafe(24)
    if _REDIS_URL:
        try:
            await (await _r()).setex(_PREFIX + tok, ttl, json.dumps(payload))
            return tok
        except Exception:
            pass
    _local[tok] = (payload, time.time() + ttl)
    return tok


async def consume(tok: str) -> dict | None:
    """Return the ticket payload once, then invalidate it. None if missing/expired."""
    if not tok:
        return None
    if _REDIS_URL:
        try:
            r = await _r()
            key = _PREFIX + tok
            val = await r.get(key)
            if val is None:
                return None
            await r.delete(key)  # single-use
            return json.loads(val)
        except Exception:
            pass
    item = _local.pop(tok, None)
    if not item:
        return None
    payload, exp = item
    return payload if exp > time.time() else None
