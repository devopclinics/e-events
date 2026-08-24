"""Durable Festio Live background worker. Jobs remain queued across restarts."""
import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select, update

from .config import settings
from .database import SessionLocal
from .models import ActivityQuestion, EngagementActivity, FeedbackAnalysis, ModerationItem, ParticipantResponse, ProgramSession
from .metrics import AI_JOBS
from .realtime import publish

logger = logging.getLogger("engagement-worker")
AUTO_CLOSE_TICK_SECONDS = 60


async def _claim_job(db):
    row = await db.scalar(
        select(FeedbackAnalysis).where(FeedbackAnalysis.status == "queued")
        .order_by(FeedbackAnalysis.created_at).with_for_update(skip_locked=True).limit(1)
    )
    if row:
        row.status = "running"
        row.started_at = datetime.now(timezone.utc)
        row.attempts += 1
        await db.commit()
    return row


async def _recover_stale_jobs(db):
    """Return jobs abandoned by a crashed worker to the durable queue."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    await db.execute(
        update(FeedbackAnalysis)
        .where(FeedbackAnalysis.status == "running", FeedbackAnalysis.started_at < cutoff)
        .values(status="queued", error="Recovered after worker interruption")
    )
    await db.commit()


async def _process(job_id: str):
    async with SessionLocal() as db:
        job = await db.get(FeedbackAnalysis, job_id)
        question = await db.get(ActivityQuestion, job.question_id)
        activity = await db.get(EngagementActivity, question.activity_id)
        if activity.config.get("moderation_enabled", True):
            responses = list((await db.execute(select(ModerationItem.content).where(
                ModerationItem.question_id == job.question_id,
                ModerationItem.status == "approved",
            ).limit(200))).scalars().all())
        else:
            values = (await db.execute(select(ParticipantResponse.answer_value).where(ParticipantResponse.question_id == job.question_id))).scalars().all()
            responses = [v.strip() for v in values if isinstance(v, str) and v.strip()][:200]
        if not responses:
            job.status, job.response_count = "completed", 0
            job.result = {"summary": "No responses yet.", "themes": [], "sentiment": None}
            job.completed_at = datetime.now(timezone.utc)
            AI_JOBS.labels("completed").inc()
            await db.commit(); return
        prompt = f'Summarize feedback for "{question.prompt}". Responses:\n' + "\n".join(f"- {v}" for v in responses) + '\nReturn only JSON: {"summary":"", "themes":[], "sentiment":"positive|neutral|mixed|negative"}'
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(f"{settings.local_ai_url.rstrip('/')}/v1/chat/completions", json={"messages": [{"role": "user", "content": prompt}], "temperature": 0.2})
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
            start, end = content.index("{"), content.rindex("}") + 1
            parsed = json.loads(content[start:end])
            job.status, job.result = "completed", parsed
            job.response_count, job.completed_at = len(responses), datetime.now(timezone.utc)
            AI_JOBS.labels("completed").inc()
        except Exception as exc:
            job.error = str(exc)[:1000]
            job.status = "queued" if job.attempts < 3 else "failed"
            if job.status == "failed": job.completed_at = datetime.now(timezone.utc)
            AI_JOBS.labels("failed" if job.status == "failed" else "retry").inc()
        await db.commit()


async def _auto_close_tick():
    """Closes session-linked activities a grace period after their session's
    scheduled end -- the presenter's own "forgot to close it" safety net, not
    a hard cutoff. A presenter can disable it per-activity (auto_close_enabled)
    or push the deadline forward with POST .../extend (extended_until) when a
    session runs long or started late; either overrides this entirely for
    that activity. Event-wide activities (no session_id) are never touched."""
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        rows = (await db.execute(
            select(EngagementActivity, ProgramSession.ends_at)
            .join(ProgramSession, (ProgramSession.org_id == EngagementActivity.org_id)
                  & (ProgramSession.event_id == EngagementActivity.event_id)
                  & (ProgramSession.source_step_id == EngagementActivity.session_id))
            .where(EngagementActivity.status.in_(("live", "paused")), ProgramSession.ends_at.isnot(None))
        )).all()
        for activity, session_ends_at in rows:
            config = activity.config or {}
            if config.get("auto_close_enabled") is False:
                continue
            grace = timedelta(minutes=int(config.get("auto_close_grace_minutes") or 20))
            deadline = session_ends_at.replace(tzinfo=timezone.utc) if session_ends_at.tzinfo is None else session_ends_at
            deadline += grace
            extended_until = config.get("extended_until")
            if extended_until:
                try:
                    parsed = datetime.fromisoformat(extended_until)
                    deadline = max(deadline, parsed)
                except ValueError:
                    pass
            if now < deadline:
                continue
            activity.status = "closed"
            activity.config = {**config, "auto_closed_at": now.isoformat()}
            await db.commit()
            await publish(activity.id, "activity.status_changed", {"status": "closed", "reason": "auto_close"})
            logger.info("auto-closed activity %s (session ended %s, grace %sm)", activity.id, session_ends_at, grace.total_seconds() / 60)


async def _auto_close_loop():
    while True:
        try:
            await _auto_close_tick()
        except Exception:
            logger.exception("auto-close tick crashed")
        await asyncio.sleep(AUTO_CLOSE_TICK_SECONDS)


async def _job_loop():
    async with SessionLocal() as db:
        await _recover_stale_jobs(db)
    while True:
        job = None
        try:
            async with SessionLocal() as db:
                job = await _claim_job(db)
            if job:
                await _process(job.id)
            else:
                await asyncio.sleep(2)
        except Exception:
            await asyncio.sleep(5)


async def run():
    await asyncio.gather(_job_loop(), _auto_close_loop())


if __name__ == "__main__":
    asyncio.run(run())
