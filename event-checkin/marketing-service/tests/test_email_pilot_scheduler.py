"""Real threads, mocked providers, disposable DBs; no live clock or network."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import threading
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy import select, func

from app.email_pilot_scheduler import EmailPilotScheduler, LEASE_NAME, INTERVAL_SECONDS
from test_email_pilot import pilot, add, signed_ready, get_lead
from test_engagement_reliability import service  # Fixture dependency for imported pilot.


@pytest.fixture
def scheduled(pilot, monkeypatch):
    monkeypatch.setenv("MARKETING_EMAIL_PILOT_SCHEDULER_ENABLED", "true")
    clock = EmailPilotScheduler(pilot[0], interval_seconds=0.01)
    try:
        yield pilot, clock
    finally:
        clock.stop(timeout=2)


@pytest.mark.parametrize("missing", ["clock", "pilot", "test_only"])
def test_disabled_defaults_never_touch_db_or_other_jobs(pilot, monkeypatch, missing):
    m = pilot[0]
    monkeypatch.delenv("MARKETING_EMAIL_PILOT_SCHEDULER_ENABLED", raising=False)
    if missing != "clock":
        monkeypatch.setenv("MARKETING_EMAIL_PILOT_SCHEDULER_ENABLED", "true")
        monkeypatch.setenv("MARKETING_EMAIL_PILOT_ENABLED", "false")
    if missing == "test_only":
        monkeypatch.setenv("MARKETING_EMAIL_TEST_ENABLED", "true")
    clock = EmailPilotScheduler(m)
    lease = Mock()
    monkeypatch.setattr(m, "acquire_lease", lease)
    assert not clock.start()
    assert clock.tick()["disabled"]
    assert not clock.running
    lease.assert_not_called()
    pilot[3].assert_not_called()


def test_actual_startup_is_idempotent_and_shutdown_wakes_interval(scheduled):
    p, unused = scheduled
    m = p[0]
    m.start_email_pilot_scheduler()
    clock = m.app.state.email_pilot_scheduler
    try:
        assert clock.running and clock.interval_seconds == INTERVAL_SECONDS == 900
        thread = clock._thread
        m.start_email_pilot_scheduler()
        assert m.app.state.email_pilot_scheduler is clock and clock._thread is thread
        p[3].assert_not_called()  # No immediate startup send.
        asyncio.run(m.stop_email_pilot_scheduler())
        assert not clock.running
    finally:
        clock.stop(timeout=2)


def test_bad_policy_disables_clock_without_disabling_health(scheduled, monkeypatch):
    p, clock = scheduled
    monkeypatch.delenv("MARKETING_EMAIL_PILOT_TEMPLATES")
    assert not clock.start()
    assert p[1].get("/health").status_code == 200
    p[3].assert_not_called()


def test_two_workers_share_dedicated_lease_and_never_call_legacy_jobs(scheduled, monkeypatch):
    p, first = scheduled
    m = p[0]
    add(p)
    second = EmailPilotScheduler(m)
    social, retention = Mock(), Mock()
    monkeypatch.setattr(m, "run_scheduled_social", social)
    monkeypatch.setattr(m, "run_gdpr_retention", retention)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda c: c.tick(), [first, second]))
    assert sum(result.get("sent", 0) for result in results) == 1
    assert sum(result.get("leased", False) for result in results) == 1
    assert p[3].call_count == 1
    social.assert_not_called()
    retention.assert_not_called()
    assert not m.outbound_enabled()
    with m.SessionLocal() as db:
        assert db.scalar(select(func.count(m.AutomationLease.name)).where(
            m.AutomationLease.name == LEASE_NAME)) == 1


def test_next_tick_still_respects_global_24h_budget(scheduled, monkeypatch):
    p, clock = scheduled
    m = p[0]
    lead_id = add(p)
    assert clock.tick()["sent"] == 1
    moment = m.now()
    monkeypatch.setattr(m, "now", lambda: moment + timedelta(minutes=15))
    with m.SessionLocal() as db:
        db.get(m.Lead, lead_id).next_follow_up_at = m.now() - timedelta(seconds=1)
        db.commit()
    assert clock.tick()["sent"] == 0
    assert p[3].call_count == 1


def test_stale_signed_readiness_is_never_sent_by_clock(scheduled):
    p, clock = scheduled
    m = p[0]
    add(p)
    p[4].side_effect = lambda *a, **k: signed_ready(
        m, a[0], k["params"], data={"checked_at": (m.now() - timedelta(minutes=1)).isoformat()})
    assert clock.tick()["sent"] == 0
    p[3].assert_not_called()


def test_uncertain_send_stays_paused_across_tick_restart(scheduled, monkeypatch):
    p, clock = scheduled
    m = p[0]
    lead_id = add(p)
    p[3].side_effect = httpx.ReadTimeout("synthetic uncertain")
    assert clock.tick()["failed"] == 1
    assert get_lead(m, lead_id).automation_paused
    moment = m.now()
    monkeypatch.setattr(m, "now", lambda: moment + timedelta(days=2))
    replacement = EmailPilotScheduler(m)
    assert replacement.tick()["sent"] == 0
    assert p[3].call_count == 1
    with m.SessionLocal() as db:
        assert db.scalar(select(m.email_pilot.EmailDispatch.status)) == "uncertain"


@pytest.mark.parametrize("point", ["before_claim", "after_claim", "gate_disabled"])
def test_stop_or_clock_gate_disable_cancels_before_provider(scheduled, monkeypatch, point):
    p, clock = scheduled
    m = p[0]
    add(p)
    calls = []
    def barrier(*args, **kwargs):
        calls.append(1)
        if len(calls) == (1 if point == "before_claim" else 2):
            if point == "gate_disabled":
                monkeypatch.setenv("MARKETING_EMAIL_PILOT_SCHEDULER_ENABLED", "false")
            else:
                clock.stop_event.set()
        return signed_ready(m, args[0], kwargs["params"])
    p[4].side_effect = barrier
    assert clock.tick()["sent"] == 0
    p[3].assert_not_called()
    with m.SessionLocal() as db:
        dispatch = db.scalar(select(m.email_pilot.EmailDispatch))
        if point == "before_claim":
            assert dispatch is None
        else:
            assert dispatch.status == "cancelled" and dispatch.attempts == 0
        assert db.scalar(select(func.count(m.SendAttempt.id))) == 0


def test_shutdown_finishes_inflight_bookkeeping_but_never_starts_next_recipient(scheduled):
    p, clock = scheduled
    m = p[0]
    add(p, 0)
    add(p, 1)
    entered, release = threading.Event(), threading.Event()
    original = p[3].side_effect
    def provider(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        return original(*args, **kwargs)
    p[3].side_effect = provider
    try:
        assert clock.start()
        assert entered.wait(3)
        with ThreadPoolExecutor(max_workers=1) as pool:
            shutdown = pool.submit(clock.stop, timeout=3)
            assert clock.stop_event.wait(1)
            release.set()
            assert shutdown.result(timeout=4)
        assert not clock.running and p[3].call_count == 1
        with m.SessionLocal() as db:
            rows = db.scalars(select(m.email_pilot.EmailDispatch)).all()
            assert len(rows) == 1 and rows[0].status == "accepted"
    finally:
        release.set()


def test_loop_recovers_from_tick_failure_without_logging_sensitive_text(scheduled, monkeypatch, caplog):
    p, clock = scheduled
    done = threading.Event()
    calls = []
    def tick():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("synthetic-sensitive-body-must-not-log")
        done.set()
        clock.stop_event.set()
    monkeypatch.setattr(clock, "tick", tick)
    assert clock.start()
    assert done.wait(3)
    assert clock.stop(timeout=2)
    assert len(calls) == 2
    assert "RuntimeError" in caplog.text and "synthetic-sensitive-body" not in caplog.text
    p[3].assert_not_called()


def test_lease_expiry_overlap_still_cannot_duplicate_dispatch(scheduled, monkeypatch):
    p, first = scheduled
    m = p[0]
    lead_id = add(p)
    entered, release = threading.Event(), threading.Event()
    original = p[3].side_effect
    def provider(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        return original(*args, **kwargs)
    p[3].side_effect = provider
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            sending = pool.submit(first.tick)
            assert entered.wait(3)
            moment = m.now()
            monkeypatch.setattr(m, "now", lambda: moment + timedelta(minutes=15))
            overlapping = EmailPilotScheduler(m).tick()
            assert overlapping.get("sent", 0) == 0
            release.set()
            assert sending.result(timeout=4)["sent"] == 1
        assert p[3].call_count == 1
        assert get_lead(m, lead_id).automation_paused  # Conservative reconciliation after stale overlap.
    finally:
        release.set()


def test_real_lifespan_disabled_defaults_never_start_clock(pilot, monkeypatch):
    m, client = pilot[:2]
    monkeypatch.delenv("MARKETING_EMAIL_PILOT_SCHEDULER_ENABLED", raising=False)
    from fastapi.testclient import TestClient
    with TestClient(m.app) as lifespan_client:
        assert lifespan_client.get("/health").status_code == 200
        clock = m.app.state.email_pilot_scheduler
        assert not clock.running
    assert not clock.running
    pilot[3].assert_not_called()


def test_real_lifespan_enabled_clock_starts_and_stops_without_immediate_send(scheduled):
    p, unused = scheduled
    m = p[0]
    from fastapi.testclient import TestClient
    with TestClient(m.app) as client:
        assert client.get("/health").status_code == 200
        clock = m.app.state.email_pilot_scheduler
        assert clock.running and clock.interval_seconds == 900
        p[3].assert_not_called()
    assert not clock.running and clock.stop_event.is_set()


def test_bounded_shutdown_timeout_leaves_inflight_claim_protected(scheduled):
    p, clock = scheduled
    m = p[0]
    add(p)
    entered, release = threading.Event(), threading.Event()
    original = p[3].side_effect
    def provider(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        return original(*args, **kwargs)
    p[3].side_effect = provider
    try:
        assert clock.start() and entered.wait(3)
        assert clock.stop(timeout=0) is False
        assert clock.stop_event.is_set()
        with m.SessionLocal() as db:
            row = db.scalar(select(m.email_pilot.EmailDispatch))
            assert row.status == "sending"
            assert db.scalar(select(func.count(m.email_pilot.EmailCap.key)).where(
                m.email_pilot.EmailCap.uncertain.is_(True))) >= 1
        release.set()
        assert clock.stop(timeout=3)
        assert p[3].call_count == 1
    finally:
        release.set()
