"""Durable retrying processor for verified Resend inbound messages."""
import asyncio
import logging
import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import AsyncSessionLocal
from ..models import Event, ExperienceStep, Guest, InboundEmail, InboundEmailAutomation
from .experience import ExperienceCompletionError, complete_guest_step
from .inbound_email_parser import InboundEmailNormalized, normalize_received_email
from .inbound_guest_matching import match_guest
from .resend_inbound_client import fetch_received_email

logger = logging.getLogger("inbound_email")
TICK_SECONDS = 5
MAX_ATTEMPTS = 8


def _backoff(attempt: int) -> int:
    ceiling = min(1800, 2 ** min(attempt, 10))
    return int(ceiling / 2 + random.uniform(0, ceiling / 2))


def _sender_matches(address: str | None, rule: dict) -> bool:
    if not address:
        return False
    value = str(rule.get("value") or "").strip().lower().removeprefix("@")
    address = address.strip().lower()
    if rule.get("match_type") == "email":
        return address == value
    if rule.get("match_type") == "domain":
        domain = address.rsplit("@", 1)[-1]
        return domain == value or domain.endswith(f".{value}")
    return False


def sender_is_trusted(automation: InboundEmailAutomation, email: InboundEmailNormalized) -> bool:
    authentication = " ".join([
        email.relevant_headers.get("authentication-results", ""),
        email.relevant_headers.get("received-spf", ""),
    ]).casefold()
    if not any(marker in authentication for marker in ("spf=pass", "dkim=pass", "dmarc=pass", "spf pass")):
        return False
    rules = automation.sender_rules or []
    if not rules:
        return False
    forwarder_rules = [rule for rule in rules if rule.get("sender_kind", "forwarder") == "forwarder"]
    original_rules = [rule for rule in rules if rule.get("sender_kind") == "original"]
    if not forwarder_rules or not any(_sender_matches(email.sender, rule) for rule in forwarder_rules):
        return False
    if original_rules and not any(_sender_matches(email.original_sender, rule) for rule in original_rules):
        return False
    return True


def completion_rules_pass(automation: InboundEmailAutomation, email: InboundEmailNormalized) -> bool:
    config = automation.completion_rules or {}
    conditions = config.get("conditions") or []
    if not conditions:
        return False
    outcomes: list[bool] = []
    for condition in conditions:
        actual = email.subject if condition.get("field") == "subject" else email.text
        actual = " ".join(str(actual or "").split()).casefold()
        expected = " ".join(str(condition.get("value") or "").split()).casefold()
        operator = condition.get("operator")
        outcomes.append(
            expected in actual if operator == "contains"
            else actual == expected if operator == "equals"
            else actual.startswith(expected) if operator == "starts_with"
            else False
        )
    return any(outcomes) if config.get("match") == "any" else all(outcomes)


async def _terminal(row: InboundEmail, status: str, code: str, reason: str) -> None:
    row.processing_status = status
    row.failure_code = code
    row.failure_reason = reason
    row.processed_at = datetime.utcnow()


async def process_email(
    db: AsyncSession,
    row: InboundEmail,
    *,
    fetcher=fetch_received_email,
) -> None:
    automation = await db.get(InboundEmailAutomation, row.automation_id) if row.automation_id else None
    if not automation or automation.event_id != row.event_id or automation.org_id != row.org_id:
        await _terminal(row, "invalid", "automation_not_found", "Automation could not be resolved safely.")
        return
    if automation.status != "active":
        await _terminal(row, "needs_review", "automation_paused", "Automation was paused when this email was processed.")
        return

    raw = await fetcher(row.resend_email_id)
    normalized = normalize_received_email(raw)
    row.message_id = normalized.message_id
    row.message_fingerprint = normalized.fingerprint
    row.from_address = normalized.sender
    row.original_sender = normalized.original_sender
    row.subject = normalized.subject[:1000] or None
    row.sanitized_excerpt = " ".join(normalized.text.split())[:1200] or None
    row.relevant_headers = normalized.relevant_headers
    row.attachment_metadata = (raw.get("attachments") or [])[:50]
    row.extracted_identifiers = [item.__dict__ for item in normalized.identifiers]

    duplicate = await db.scalar(select(InboundEmail).where(
        InboundEmail.id != row.id,
        InboundEmail.automation_id == automation.id,
        InboundEmail.message_fingerprint == normalized.fingerprint,
        InboundEmail.processing_status == "completed",
    ).limit(1))
    if duplicate:
        await _terminal(row, "duplicate", "logical_message_duplicate", f"Duplicate of inbound email {duplicate.id}.")
        logger.info("inbound_email.duplicate inbound_email_id=%s duplicate_of=%s", row.id, duplicate.id)
        return

    if not sender_is_trusted(automation, normalized):
        row.sender_status = "untrusted"
        await _terminal(row, "untrusted", "untrusted_sender", "Forwarding or original sender did not match the trusted sender rules.")
        logger.info("inbound_email.rejected inbound_email_id=%s reason=untrusted_sender", row.id)
        return
    row.sender_status = "trusted"
    if not completion_rules_pass(automation, normalized):
        row.rule_status = "failed"
        await _terminal(row, "invalid", "completion_rules_failed", "Email did not satisfy the configured completion rules.")
        logger.info("inbound_email.rejected inbound_email_id=%s reason=completion_rules", row.id)
        return
    row.rule_status = "passed"

    match = await match_guest(db, automation.event_id, normalized)
    row.match_status = match.outcome
    row.match_method = match.method
    row.candidate_guest_ids = list(match.candidate_ids)
    if match.outcome != "matched" or not match.guest_id:
        await _terminal(row, "needs_review", match.outcome, "No unique guest could be identified safely.")
        logger.info("inbound_email.%s inbound_email_id=%s", match.outcome, row.id)
        return

    event = await db.get(Event, automation.event_id)
    guest = await db.get(Guest, match.guest_id)
    step = await db.get(ExperienceStep, automation.step_id)
    if not event or not guest or not step or guest.event_id != event.id:
        await _terminal(row, "invalid", "tenant_scope_mismatch", "Resolved records do not share the automation event.")
        return
    try:
        _, newly_completed = await complete_guest_step(
            db,
            event=event,
            guest=guest,
            step=step,
            source="inbound_email",
            metadata={
                "automation_id": automation.id,
                "inbound_email_id": row.id,
                "resend_email_id": row.resend_email_id,
                "match_method": match.method,
                "processing_method": "automatic",
                "sender": normalized.sender,
                "original_sender": normalized.original_sender,
            },
        )
    except ExperienceCompletionError as exc:
        await _terminal(row, "needs_review", "completion_blocked", str(exc))
        return
    row.processing_status = "completed"
    row.matched_guest_id = guest.id
    row.processed_at = datetime.utcnow()
    row.failure_code = None
    row.failure_reason = None if newly_completed else "Step was already complete; no duplicate activity was created."
    logger.info("inbound_email.completed inbound_email_id=%s automation_id=%s guest_id=%s", row.id, automation.id, guest.id)


async def process_due(*, limit: int = 25, fetcher=fetch_received_email) -> int:
    processed = 0
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(InboundEmail)
            .where(
                InboundEmail.processing_status == "received",
                InboundEmail.next_attempt_at <= datetime.utcnow(),
            )
            .order_by(InboundEmail.received_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )).scalars().all()
        for row in rows:
            row.processing_status = "processing"
            try:
                await process_email(db, row, fetcher=fetcher)
            except Exception as exc:
                row.attempt_count += 1
                row.failure_code = "transient_processing_failure"
                row.failure_reason = str(exc)[:500]
                if row.attempt_count >= MAX_ATTEMPTS:
                    row.processing_status = "failed"
                    row.processed_at = datetime.utcnow()
                else:
                    row.processing_status = "received"
                    row.next_attempt_at = datetime.utcnow() + timedelta(seconds=_backoff(row.attempt_count))
                logger.warning("inbound_email processing failed id=%s attempt=%s error=%s", row.id, row.attempt_count, type(exc).__name__)
            else:
                processed += 1
        await db.commit()
    return processed


async def run() -> None:
    logger.info("inbound_email worker started")
    while True:
        try:
            await process_due()
        except Exception:
            logger.exception("inbound_email worker tick crashed")
        await asyncio.sleep(TICK_SECONDS)
