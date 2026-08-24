#!/usr/bin/env python3
"""Non-production load/correctness acceptance for an isolated Engagement stack."""
import asyncio
import json
import os
import statistics
import time
import uuid

import asyncpg
import httpx
import jwt
from redis.asyncio import Redis

BASE = os.getenv("ENGAGEMENT_LOAD_BASE", "http://localhost:8060/api/engagement/v1").rstrip("/")
EVENT = os.getenv("ENGAGEMENT_LOAD_EVENT", "isolated-load-event")
ORG = os.getenv("ENGAGEMENT_LOAD_ORG", "isolated-load-org")
SECRET = os.environ["INTERNAL_SERVICE_TOKEN"]


def bearer(subject, role="guest", capabilities=()):
    now = int(time.time())
    return jwt.encode({
        "sub": subject, "name": subject, "event_id": EVENT, "org_id": ORG,
        "role": role, "capabilities": list(capabilities),
        "identity_kind": "guest" if role == "guest" else "staff",
        "iss": "guesthub", "aud": "engagement", "iat": now, "exp": now + 3600,
    }, SECRET, algorithm="HS256")


ADMIN = bearer("load-owner", "owner")


async def api(client, method, path, token, body=None):
    response = await client.request(method, BASE + path, headers={"Authorization": f"Bearer {token}"}, json=body)
    if response.status_code >= 400:
        raise RuntimeError(f"{method} {path}: {response.status_code} {response.text[:200]}")
    return response.json() if response.content else None


async def activity(client, label):
    created = await api(client, "POST", "/activities", ADMIN, {"type": "poll", "title": label, "config": {"live_results_enabled": True}})
    question = await api(client, "POST", f"/activities/{created['id']}/questions", ADMIN, {
        "question_type": "single_choice", "prompt": "Choose one", "options": [{"label": "A"}, {"label": "B"}],
    })
    await api(client, "POST", f"/activities/{created['id']}/status", ADMIN, {"status": "live"})
    await api(client, "POST", f"/questions/{question['id']}/live-state", ADMIN, {"state": "open"})
    return created["id"], question["id"], question["options"][0]["id"]


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(len(ordered) * fraction) - 1))]


async def load_case(client, count):
    activity_id, question_id, option_id = await activity(client, f"LOAD · {count}")
    semaphore = asyncio.Semaphore(100)

    async def submit(index):
        async with semaphore:
            started = time.perf_counter()
            request_headers = {"Authorization": f"Bearer {bearer(f'guest-{count}-{index}')}"}
            request_body = {
                "question_id": question_id, "selected_option_ids": [option_id], "idempotency_key": f"load-{index}-{uuid.uuid4()}",
            }
            # A transport retry represents the weak-Wi-Fi/mobile retry path.
            # The same body and idempotency key must converge on one row.
            for attempt in range(4):
                try:
                    response = await client.post(BASE + f"/activities/{activity_id}/respond", headers=request_headers, json=request_body)
                    break
                except httpx.TransportError:
                    if attempt == 3:
                        raise
                    await asyncio.sleep(.03 * (attempt + 1))
            return response.status_code, (time.perf_counter() - started) * 1000

    started = time.perf_counter()
    outcomes = await asyncio.gather(*(submit(i) for i in range(count)))
    elapsed = time.perf_counter() - started
    statuses = {}
    latencies = []
    for status, latency in outcomes:
        statuses[str(status)] = statuses.get(str(status), 0) + 1
        latencies.append(latency)
    results = await api(client, "GET", f"/activities/{activity_id}/results", ADMIN)
    if statuses != {"200": count} or results["response_count"] != count:
        raise AssertionError(f"load {count} persistence mismatch: {statuses}, results={results['response_count']}")
    return {
        "participants": count, "elapsed_seconds": round(elapsed, 3), "responses_per_second": round(count / elapsed, 1),
        "p50_ms": round(statistics.median(latencies), 1), "p95_ms": round(percentile(latencies, .95), 1),
        "p99_ms": round(percentile(latencies, .99), 1), "statuses": statuses, "persisted": results["response_count"],
    }


async def duplicate_case(client):
    activity_id, question_id, option_id = await activity(client, "LOAD · Concurrent duplicate")
    token = bearer("same-guest")
    body = {"question_id": question_id, "selected_option_ids": [option_id], "idempotency_key": "same-idempotency-key"}
    responses = await asyncio.gather(*(client.post(BASE + f"/activities/{activity_id}/respond", headers={"Authorization": f"Bearer {token}"}, json=body) for _ in range(20)))
    if any(response.status_code != 200 for response in responses):
        raise AssertionError([response.status_code for response in responses])
    ids = {response.json()["response_id"] for response in responses}
    results = await api(client, "GET", f"/activities/{activity_id}/results", ADMIN)
    if len(ids) != 1 or results["response_count"] != 1:
        raise AssertionError(f"concurrent duplicate mismatch ids={len(ids)} count={results['response_count']}")
    return {"requests": 20, "unique_response_ids": len(ids), "persisted": results["response_count"]}


async def sse_case(client):
    activity_id, question_id, option_id = await activity(client, "LOAD · SSE delivery")
    guest = bearer("sse-guest")
    ticket = await api(client, "GET", f"/activities/{activity_id}/realtime-ticket", guest)

    async def next_event(lines):
        event = None
        async for line in lines:
            if line.startswith("event: "):
                event = line.removeprefix("event: ")
            elif not line and event:
                return event
        raise AssertionError("SSE stream ended before an event arrived")

    async with client.stream("GET", BASE + f"/activities/{activity_id}/stream", params={"ticket": ticket["ticket"]}, timeout=None) as stream:
        if stream.status_code != 200:
            raise AssertionError(f"SSE connect returned {stream.status_code}")
        lines = stream.aiter_lines()
        if await asyncio.wait_for(next_event(lines), 5) != "ready":
            raise AssertionError("SSE stream did not become ready")
        started = time.perf_counter()
        submission = asyncio.create_task(client.post(
            BASE + f"/activities/{activity_id}/respond",
            headers={"Authorization": f"Bearer {guest}"},
            json={"question_id": question_id, "selected_option_ids": [option_id], "idempotency_key": "sse-delivery"},
        ))
        event = await asyncio.wait_for(next_event(lines), 5)
        response = await submission
        latency_ms = (time.perf_counter() - started) * 1000
        if response.status_code != 200 or event != "response.submitted":
            raise AssertionError(f"SSE delivery mismatch: response={response.status_code}, event={event}")

    # A fresh EventSource-style connection with the same unexpired ticket must
    # recover immediately after a transport interruption.
    async with client.stream("GET", BASE + f"/activities/{activity_id}/stream", params={"ticket": ticket["ticket"]}, timeout=None) as reconnect:
        if await asyncio.wait_for(next_event(reconnect.aiter_lines()), 5) != "ready":
            raise AssertionError("SSE reconnect did not become ready")
    return {"event": event, "delivery_ms": round(latency_ms, 1), "reconnect": True}


async def dependency_latency():
    redis = Redis.from_url(os.getenv("REDIS_URL", "redis://engagement-redis:6379/0"))
    started = time.perf_counter()
    await redis.ping()
    redis_ms = (time.perf_counter() - started) * 1000
    await redis.aclose()
    return {"redis_ping_ms": round(redis_ms, 2)}


async def monitor_database(stop):
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://", 1)
    connection = await asyncpg.connect(dsn)
    active_samples = []
    total_samples = []
    query_latencies = []
    try:
        max_connections = int(await connection.fetchval("SHOW max_connections"))
        while not stop.is_set():
            started = time.perf_counter()
            row = await connection.fetchrow(
                "SELECT count(*) FILTER (WHERE state = 'active') AS active, count(*) AS total "
                "FROM pg_stat_activity WHERE datname = current_database()"
            )
            query_latencies.append((time.perf_counter() - started) * 1000)
            active_samples.append(row["active"])
            total_samples.append(row["total"])
            await asyncio.sleep(.05)
    finally:
        await connection.close()
    peak_total = max(total_samples, default=0)
    return {
        "max_connections": max_connections,
        "peak_active_connections": max(active_samples, default=0),
        "peak_total_connections": peak_total,
        "peak_connection_utilization_percent": round((peak_total / max_connections) * 100, 1),
        "probe_query_p50_ms": round(statistics.median(query_latencies), 2),
        "probe_query_p95_ms": round(percentile(query_latencies, .95), 2),
    }


async def main():
    limits = httpx.Limits(max_connections=300, max_keepalive_connections=100)
    async with httpx.AsyncClient(timeout=30, limits=limits) as client:
        report = {"environment": "isolated", "loads": []}
        stop_monitor = asyncio.Event()
        database_monitor = asyncio.create_task(monitor_database(stop_monitor))
        try:
            for count in (100, 500, 1000, 5000):
                report["loads"].append(await load_case(client, count))
            burst_seconds = report["loads"][2]["elapsed_seconds"]
            report["burst_1000"] = {
                "elapsed_seconds": burst_seconds,
                "target": "approximately 10 seconds",
                "accepted_window_seconds": 12,
                "meets_requirement": burst_seconds <= 12,
            }
            report["concurrent_duplicate"] = await duplicate_case(client)
            report["sse"] = await sse_case(client)
            report["dependencies"] = await dependency_latency()
        finally:
            stop_monitor.set()
            report["database"] = await database_monitor
    print(json.dumps(report, indent=2))


asyncio.run(main())
