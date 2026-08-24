"""Authenticated burst probe for staging. Never invents credentials.
Usage: python scripts/load_probe.py BASE_URL GUEST_JWT ACTIVITY_ID QUESTION_ID OPTION_ID [COUNT]
"""
import asyncio
import sys
import time
import uuid

import httpx


async def main():
    base, token, activity, question, option = sys.argv[1:6]
    count = int(sys.argv[6]) if len(sys.argv) > 6 else 100
    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=15, limits=httpx.Limits(max_connections=100)) as client:
        async def submit(index):
            response = await client.post(f"{base.rstrip('/')}/api/engagement/v1/activities/{activity}/respond", headers={"Authorization": f"Bearer {token}"}, json={"question_id": question, "selected_option_ids": [option], "idempotency_key": f"probe-{index}-{uuid.uuid4()}"})
            return response.status_code
        statuses = await asyncio.gather(*(submit(i) for i in range(count)))
    elapsed = time.perf_counter() - started
    print({"requests": count, "seconds": round(elapsed, 3), "rps": round(count / elapsed, 1), "statuses": {code: statuses.count(code) for code in set(statuses)}})


if __name__ == "__main__":
    if len(sys.argv) < 6: raise SystemExit(__doc__)
    asyncio.run(main())
