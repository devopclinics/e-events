import asyncio
from typing import Dict, List

sse_subscribers: Dict[str, List[asyncio.Queue]] = {}


def broadcast(event_id: str, data: dict):
    for queue in list(sse_subscribers.get(event_id, [])):
        try:
            queue.put_nowait(data)
        except asyncio.QueueFull:
            pass
