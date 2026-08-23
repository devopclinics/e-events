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
from datetime import datetime, timedelta, timezone

import jwt
from redis.asyncio import Redis

from .config import settings

redis = Redis.from_url(settings.redis_url, decode_responses=True)


def _channel(activity_id: str) -> str:
    return f"engagement:activity:{activity_id}"


async def publish(activity_id: str, event: str, data: dict) -> None:
    try:
        await redis.publish(_channel(activity_id), json.dumps({"event": event, "data": data}, default=str))
    except Exception:
        # Redis is a nice-to-have for this feature (live counters); losing a
        # push means a client's next poll/reconnect just catches up instead
        # of the request that triggered it failing outright.
        pass


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
