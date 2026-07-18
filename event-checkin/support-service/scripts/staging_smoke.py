"""Non-destructive staging smoke checks for Redis and local inference."""
import asyncio
import json
import time
import uuid
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
from app import main


async def run() -> None:
    suffix = uuid.uuid4().hex
    message_id = f"smoke-{suffix}"
    queue_key = f"support:smoke:queue:{suffix}"
    dedup_key = f"support:smoke:message:{suffix}"
    payload = {"message_id": message_id, "job_id": suffix}
    assert await main.redis_client.ping()
    script = """
    if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
    redis.call('SET', KEYS[1], '1', 'EX', 60)
    redis.call('LPUSH', KEYS[2], ARGV[1])
    return 1
    """
    encoded = json.dumps(payload)
    assert await main.redis_client.eval(script, 2, dedup_key, queue_key, encoded) == 1
    assert await main.redis_client.eval(script, 2, dedup_key, queue_key, encoded) == 0
    raw = await main.redis_client.rpop(queue_key)
    queued = json.loads(raw)
    assert queued["message_id"] == message_id and queued["job_id"]

    first = await main._acquire_concurrency(f"smoke:{suffix}", 1, "job-a")
    second = await main._acquire_concurrency(f"smoke:{suffix}", 1, "job-b")
    assert first and not second
    await main._release_concurrency(f"smoke:{suffix}", "job-a")

    route = await main._local_route("How do I import guests?")
    assert route
    assert route["intent"] in {"faq", "billing", "security", "escalation", "unknown"}
    assert 0 <= route["confidence"] <= 1
    assert isinstance(route["needs_human"], bool)

    await main.redis_client.delete(
        dedup_key,
        queue_key,
        f"support:concurrency:smoke:{suffix}",
    )
    print(json.dumps({"status": "ok", "local_route": route, "completed_at": time.time()}))


if __name__ == "__main__":
    asyncio.run(run())
