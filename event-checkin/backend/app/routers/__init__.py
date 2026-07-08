import asyncio
import json
import logging
import os
from typing import Dict, List

logger = logging.getLogger("realtime")

# Local, per-process registry of live SSE connections. Each dashboard EventSource
# on THIS process appends its queue here; the dict is never shared between pods.
sse_subscribers: Dict[str, List[asyncio.Queue]] = {}

# When REDIS_URL is set we fan check-in events out through Redis Pub/Sub so any
# web replica can deliver to the dashboards connected to it. When it is unset we
# fall back to direct in-process delivery — identical to the original single-host
# behavior — so nothing changes until Redis is wired in.
_REDIS_URL = os.environ.get("REDIS_URL", "").strip()
_CHANNEL_PREFIX = "sse:"

_redis = None
_subscriber_task: asyncio.Task | None = None


def _local_deliver(event_id: str, data: dict) -> None:
    for queue in list(sse_subscribers.get(event_id, [])):
        try:
            queue.put_nowait(data)
        except asyncio.QueueFull:
            pass


async def _get_redis():
    global _redis
    if _redis is None:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(_REDIS_URL, decode_responses=True)
    return _redis


async def broadcast(event_id: str, data: dict) -> None:
    """Publish a realtime event to every dashboard watching this event.

    With Redis configured, publish to the event's channel; the per-process
    subscriber (started in the app lifespan) delivers it to local queues on
    every replica. Without Redis, deliver directly in-process. Redis failures
    degrade gracefully to local delivery rather than dropping the event.
    """
    if _REDIS_URL:
        try:
            r = await _get_redis()
            await r.publish(_CHANNEL_PREFIX + event_id, json.dumps(data))
            return
        except Exception:
            logger.exception("redis publish failed; delivering locally")
    _local_deliver(event_id, data)


async def _subscribe_loop() -> None:
    """Listen for all sse:* messages and fan them out to this process's queues."""
    r = await _get_redis()
    pubsub = r.pubsub()
    await pubsub.psubscribe(_CHANNEL_PREFIX + "*")
    logger.info("SSE Redis subscriber started")
    async for msg in pubsub.listen():
        if msg.get("type") != "pmessage":
            continue
        channel = msg.get("channel") or ""
        event_id = channel[len(_CHANNEL_PREFIX):]
        try:
            data = json.loads(msg["data"])
        except (ValueError, TypeError, KeyError):
            continue
        _local_deliver(event_id, data)


async def start_sse_subscriber() -> None:
    """Start the Redis fan-in subscriber if Redis is configured (idempotent)."""
    global _subscriber_task
    if _REDIS_URL and _subscriber_task is None:
        _subscriber_task = asyncio.create_task(_subscribe_loop())


async def stop_sse_subscriber() -> None:
    global _subscriber_task
    if _subscriber_task is not None:
        _subscriber_task.cancel()
        try:
            await _subscriber_task
        except asyncio.CancelledError:
            pass
        _subscriber_task = None
