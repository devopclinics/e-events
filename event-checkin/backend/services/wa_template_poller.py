"""Background loop: poll pending WhatsApp template submissions against Bird
and flip status to approved/rejected once Meta finishes reviewing, notifying
the submitter exactly once per transition. Same run()-loop shape as
reminder_outbox.py / engagement_sync_outbox.py -- started from app/main.py's
lifespan, gated by RUN_IN_APP_WA_TEMPLATE_POLLER."""
import asyncio
import logging
from datetime import datetime

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import WhatsAppTemplateSubmission
from services import bird_templates
from services.wa_template_submissions import notify_status_change

logger = logging.getLogger("wa_template_poller")

POLL_INTERVAL_SECONDS = 120


async def _tick() -> None:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(WhatsAppTemplateSubmission).where(WhatsAppTemplateSubmission.status == "pending_review")
        )).scalars().all()
        for sub in rows:
            if not sub.bird_project_id:
                continue
            try:
                status, reason = await bird_templates.check_status(sub.bird_project_id)
            except Exception:
                logger.exception("wa_template_poller: status check failed submission=%s", sub.id)
                continue
            sub.last_checked_at = datetime.utcnow()
            if status != "pending_review":
                sub.status = status
                sub.reject_reason = reason
                await notify_status_change(db, sub)
                sub.last_notified_status = status
            await db.commit()


async def run() -> None:
    if not bird_templates.enabled():
        logger.info("wa_template_poller: Bird not configured, poller idle")
        return
    while True:
        try:
            await _tick()
        except Exception:
            logger.exception("wa_template_poller: tick failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
