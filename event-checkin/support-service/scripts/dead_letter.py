"""Inspect or replay support dead-letter jobs without exposing message content."""
import argparse
import json
import os

from redis import Redis


DEAD = "support:ai:dead"
QUEUE = "support:ai:jobs"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("list", "replay"))
    parser.add_argument("--job-id")
    args = parser.parse_args()
    client = Redis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"), decode_responses=True)
    jobs = client.lrange(DEAD, 0, -1)
    parsed = []
    for raw in jobs:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"job_id": "invalid", "attempt": None}
        parsed.append((raw, payload))
    if args.action == "list":
        safe = [
            {
                "job_id": payload.get("job_id"),
                "message_id": payload.get("message_id"),
                "conversation_id": payload.get("conversation_id"),
                "attempt": payload.get("attempt"),
                "queued_at": payload.get("queued_at"),
            }
            for _, payload in parsed
        ]
        print(json.dumps(safe, indent=2))
        return 0
    if not args.job_id:
        parser.error("replay requires --job-id")
    matches = [(raw, payload) for raw, payload in parsed if str(payload.get("job_id")) == args.job_id]
    if len(matches) != 1:
        raise SystemExit(f"expected one dead-letter job named {args.job_id!r}, found {len(matches)}")
    raw, payload = matches[0]
    payload["attempt"] = 0
    pipe = client.pipeline(transaction=True)
    pipe.lrem(DEAD, 1, raw)
    pipe.lpush(QUEUE, json.dumps(payload))
    removed, _ = pipe.execute()
    if removed != 1:
        raise SystemExit("job changed during replay; nothing was queued")
    print(json.dumps({"status": "replayed", "job_id": args.job_id}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
