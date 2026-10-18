"""Separately gated email-only clock. No legacy jobs or provider credentials."""
import logging
import os
import threading

from . import email_pilot

INTERVAL_SECONDS = 900
LEASE_SECONDS = 840
LEASE_NAME = "marketing-email-pilot"
logger = logging.getLogger("festio.email_pilot_scheduler")


def enabled():
    return (email_pilot.enabled("pilot")
            and os.getenv("MARKETING_EMAIL_PILOT_SCHEDULER_ENABLED", "false").lower()
            in {"1", "true", "yes"})


class EmailPilotScheduler:
    def __init__(self, runtime, *, interval_seconds=INTERVAL_SECONDS):
        if interval_seconds <= 0:
            raise ValueError("Positive clock interval required")
        self.runtime = runtime
        self.interval_seconds = interval_seconds
        self.stop_event = threading.Event()
        self._thread = None
        self._lock = threading.Lock()

    @property
    def running(self):
        return bool(self._thread and self._thread.is_alive())

    def start(self):
        with self._lock:
            if self.running or not enabled():
                return False
            # No DB/provider calls or immediate send on startup. Malformed
            # policy disables only this clock, not inbound stop processing.
            try:
                email_pilot.config("pilot")
                email_pilot.template_pins()
            except email_pilot.EmailBlocked:
                logger.warning("Email pilot clock not started: policy configuration blocked")
                return False
            self.stop_event.clear()
            self._thread = threading.Thread(
                target=self._loop, name="marketing-email-pilot", daemon=True)
            self._thread.start()
            return True

    def stop(self, *, timeout=30):
        self.stop_event.set()
        thread = self._thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout)
        stopped = not self.running
        if not stopped:
            # An in-flight provider operation cannot be recalled. Its durable
            # claim stays held on forced process termination; never auto-retry.
            logger.warning("Email pilot clock shutdown pending; durable claim remains protected")
        return stopped

    def cancelled(self):
        return self.stop_event.is_set() or not enabled()

    def tick(self):
        m = self.runtime
        if self.cancelled():
            return {"disabled": True}
        # The lease coalesces workers. Durable per-step and global budget claims
        # remain the correctness boundary even if a lease expires mid-operation.
        with m.SessionLocal() as db:
            if not m.acquire_lease(db, LEASE_NAME, seconds=LEASE_SECONDS):
                return {"leased": True}
            if self.cancelled():
                return {"disabled": True}
            operator = m.Identity(subject="email-pilot", email="automation@festio.events",
                                  name="Email pilot", is_superadmin=True, role="superadmin")
            return m.run_automation_service(
                db, operator, email_mode="pilot", stop_requested=self.cancelled)

    def _loop(self):
        # First tick waits a full interval. Shutdown wakes this wait immediately.
        while not self.stop_event.wait(self.interval_seconds):
            try:
                self.tick()
            except Exception as exc:
                # Never log provider bodies, JWTs, client identifiers or content.
                logger.warning("Email pilot tick blocked (%s)", type(exc).__name__)
