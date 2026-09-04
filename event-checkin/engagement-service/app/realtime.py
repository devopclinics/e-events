"""Live updates for Festio Live — one Redis pub/sub channel per activity.

EventSource can't send an Authorization header, so live streams are gated by
a short-lived "realtime ticket" (a separate, narrowly-scoped JWT minted from
an already-verified staff/guest Identity, audience "engagement-realtime")
rather than the main bearer token — same shape as festiome-service's channel
tickets. engagement-service owns its own Redis instance (engagement-redis);
it is never shared with core Festio's redis or festiome's, keeping this
service's realtime layer fault-isolated like everything else about it.
"""
import json
import re
from datetime import datetime, timedelta, timezone

import jwt
from redis.asyncio import Redis

from .config import settings
from .metrics import REALTIME_PUBLISH_FAILURES

redis = Redis.from_url(
    settings.redis_url,
    decode_responses=True,
    socket_connect_timeout=0.5,
    socket_timeout=1.0,
    health_check_interval=15,
)

DISPLAY_LEASE_SECONDS = 15
_DISPLAY_CLIENT_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


def validate_display_client_id(client_id: str) -> str:
    if not _DISPLAY_CLIENT_RE.fullmatch(client_id or ""):
        raise ValueError("Invalid display client identifier")
    return client_id


async def claim_display(display_id: str, client_id: str) -> bool:
    """First projector owns the display until its stream disconnects."""
    validate_display_client_id(client_id)
    key = f"engagement:display-lease:{display_id}"
    claimed = await redis.set(key, client_id, ex=DISPLAY_LEASE_SECONDS, nx=True)
    if claimed:
        return True
    if await redis.get(key) != client_id:
        return False
    await redis.expire(key, DISPLAY_LEASE_SECONDS)
    return True


async def renew_display(display_id: str, client_id: str) -> bool:
    """Extend an existing lease without allowing a disconnected stream to reclaim it."""
    validate_display_client_id(client_id)
    return bool(await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
        1, f"engagement:display-lease:{display_id}", client_id, DISPLAY_LEASE_SECONDS,
    ))


async def release_display(display_id: str, client_id: str) -> None:
    await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1, f"engagement:display-lease:{display_id}", client_id,
    )


async def display_is_connected(display_id: str) -> bool:
    """Whether some projector currently holds this display's lease, for the
    admin UI's "is anything actually attached?" indicator."""
    try:
        return bool(await redis.exists(f"engagement:display-lease:{display_id}"))
    except Exception:
        return False


async def force_release_display(display_id: str) -> None:
    """Admin override: clear a display's lease regardless of who holds it.
    Unlike release_display, this doesn't check the caller's own client_id --
    it's for staff who can't reach whatever browser/device is stuck holding
    the lease. The held stream's next renewal cycle (~5s, see _sse in
    routers/realtime.py) then fails and it closes itself: this actively
    disconnects the stuck projector, not just clears the way for a new one."""
    await redis.delete(f"engagement:display-lease:{display_id}")


def _channel(activity_id: str) -> str:
    return f"engagement:activity:{activity_id}"


async def publish(activity_id: str, event: str, data: dict) -> None:
    try:
        await redis.publish(_channel(activity_id), json.dumps({"event": event, "data": data}, default=str))
    except Exception:
        # Redis is a nice-to-have for this feature (live counters); losing a
        # push means a client's next poll/reconnect just catches up instead
        # of the request that triggered it failing outright.
        REALTIME_PUBLISH_FAILURES.inc()


async def publish_display(display_id: str, event: str, data: dict) -> None:
    """Push display-only changes without coupling them to an activity."""
    try:
        await redis.publish(
            f"engagement:display:{display_id}",
            json.dumps({"event": event, "data": data}, default=str),
        )
    except Exception:
        REALTIME_PUBLISH_FAILURES.inc()


async def publish_run(run_id: str, event: str, data: dict) -> None:
    """Run-scoped updates keep simultaneous rooms and workflows isolated."""
    try:
        await redis.publish(
            f"engagement:workflow-run:{run_id}",
            json.dumps({"event": event, "data": data}, default=str),
        )
    except Exception:
        REALTIME_PUBLISH_FAILURES.inc()


def mint_realtime_ticket(activity_id: str, subject: str, minutes: int = 180) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": subject, "activity_id": activity_id,
        "iat": now, "exp": now + timedelta(minutes=minutes),
        "aud": "engagement-realtime", "iss": "engagement",
    }, settings.internal_service_token, algorithm="HS256")


def verify_realtime_ticket(ticket: str, activity_id: str) -> None:
    try:
        claims = jwt.decode(ticket, settings.internal_service_token, algorithms=["HS256"], audience="engagement-realtime", issuer="engagement")
    except jwt.PyJWTError:
        raise ValueError("Invalid or expired realtime ticket")
    if claims.get("activity_id") != activity_id:
        raise ValueError("Realtime ticket is for another activity")
