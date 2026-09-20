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


class DisplayDisconnectedError(Exception):
    """A staff disconnect persists across automatic browser reconnects."""


def validate_display_client_id(client_id: str) -> str:
    if not _DISPLAY_CLIENT_RE.fullmatch(client_id or ""):
        raise ValueError("Invalid display client identifier")
    return client_id


def _display_keys(display_id):
    return (f"engagement:display-clients:{display_id}",
            f"engagement:display-revoked:{display_id}",
            f"engagement:display-lease:{display_id}")


# Use Redis time and a single atomic script, so concurrent clients/replicas
# cannot exceed capacity. Import the legacy lease during a rolling upgrade.
_PRESENCE_SETUP = """
local stamp = redis.call('TIME')
local now = stamp[1] * 1000 + math.floor(stamp[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local legacy = redis.call('GET', KEYS[3])
if legacy then
    if redis.call('SISMEMBER', KEYS[2], legacy) == 1 then
        redis.call('DEL', KEYS[3])
    elseif not redis.call('ZSCORE', KEYS[1], legacy) then
        local ttl = redis.call('PTTL', KEYS[3])
        if ttl > 0 then redis.call('ZADD', KEYS[1], now + ttl, legacy) end
    end
end
"""
_CLAIM_DISPLAY = _PRESENCE_SETUP + """
local revoked = redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1
if revoked and ARGV[4] ~= '1' then return -1 end
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) and redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
if revoked then redis.call('SREM', KEYS[2], ARGV[1]) end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) * 2)
redis.call('SET', KEYS[3], ARGV[1], 'PX', ARGV[3], 'NX')
return 1
"""
_RENEW_DISPLAY = _PRESENCE_SETUP + """
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 or not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('PEXPIRE', KEYS[3], ARGV[2]) end
return 1
"""
_RELEASE_DISPLAY = """
redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
return 1
"""
_REVOKE_DISPLAY = _PRESENCE_SETUP + """
local clients = ARGV[1] ~= '' and {ARGV[1]} or redis.call('ZRANGE', KEYS[1], 0, -1)
for _, client in ipairs(clients) do
    redis.call('SADD', KEYS[2], client)
    redis.call('ZREM', KEYS[1], client)
    if redis.call('GET', KEYS[3]) == client then redis.call('DEL', KEYS[3]) end
end
return #clients
"""


async def claim_display(display_id: str, client_id: str, *, reconnect: bool = False) -> bool:
    validate_display_client_id(client_id)
    result = await redis.eval(
        _CLAIM_DISPLAY, 3, *_display_keys(display_id), client_id,
        settings.display_connection_limit, DISPLAY_LEASE_SECONDS * 1000,
        '1' if reconnect else '0',
    )
    if result == -1:
        raise DisplayDisconnectedError("This screen was disconnected. Choose Reconnect to join again.")
    return bool(result)


async def renew_display(display_id: str, client_id: str) -> bool:
    validate_display_client_id(client_id)
    return bool(await redis.eval(
        _RENEW_DISPLAY, 3, *_display_keys(display_id), client_id, DISPLAY_LEASE_SECONDS * 1000,
    ))


async def release_display(display_id: str, client_id: str) -> None:
    validate_display_client_id(client_id)
    await redis.eval(_RELEASE_DISPLAY, 3, *_display_keys(display_id), client_id)


async def display_devices(display_id: str) -> list[dict]:
    rows = await redis.eval(
        _PRESENCE_SETUP + "return redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')",
        3, *_display_keys(display_id),
    )
    return [
        {'client_id': rows[index], 'last_seen_at': datetime.fromtimestamp(
            float(rows[index + 1]) / 1000 - DISPLAY_LEASE_SECONDS, timezone.utc)}
        for index in range(0, len(rows), 2)
    ]


async def display_is_connected(display_id: str) -> bool:
    try:
        return bool(await display_devices(display_id))
    except Exception:
        return False


async def force_release_display(display_id: str, client_id: str | None = None) -> None:
    """Revoke selected present clients until they explicitly rejoin.

    No expiry: a browser left open overnight must not seize the screen again.
    The admin-only operation grows this set; explicit rejoin removes its ID.
    """
    if client_id:
        validate_display_client_id(client_id)
    await redis.eval(_REVOKE_DISPLAY, 3, *_display_keys(display_id), client_id or '')


async def forget_display(display_id: str) -> None:
    await redis.delete(*_display_keys(display_id))


def _channel(activity_id: str) -> str:
    return f"engagement:activity:{activity_id}"


async def publish(activity_id: str, event: str, data: dict) -> None:
    from .display_snapshots import invalidate_public_snapshot
    await invalidate_public_snapshot(activity_id, event)
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
