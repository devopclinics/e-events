"""Durable Festio Live background worker. Jobs remain queued across restarts."""
import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import or_, select, update
from sqlalchemy.orm import selectinload

from .config import settings
from .database import SessionLocal
from .models import ActivityQuestion, EngagementActivity, FeedbackAnalysis, LiveDisplay, ModerationItem, ParticipantResponse, ProgramSession
from .metrics import AI_JOBS
from .realtime import publish, publish_display
from .routers.activities import _apply_guided_advance, _set_guided_lobby

logger = logging.getLogger("engagement-worker")
AUTO_CLOSE_TICK_SECONDS = 60
DISPLAY_AUTOFOLLOW_TICK_SECONDS = 30
QUESTION_TIMER_TICK_SECONDS = 1


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


async def _auto_start_tick():
    """Opt-in per activity (auto_start_enabled) -- the product default is that
    Festio Live never starts anything on its own; a presenter has to turn this
    on for a specific activity. When on, a draft/scheduled activity linked to
    a program session goes live the moment that session's scheduled start
    time arrives, so nobody has to remember to press the button. Skipped if
    the session already ended by the time the tick runs, so a long worker gap
    can't retroactively "start" something whose moment already passed."""
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        rows = (await db.execute(
            select(EngagementActivity, ProgramSession.starts_at, ProgramSession.ends_at)
            .join(ProgramSession, (ProgramSession.org_id == EngagementActivity.org_id)
                  & (ProgramSession.event_id == EngagementActivity.event_id)
                  & (ProgramSession.source_step_id == EngagementActivity.session_id))
            .where(EngagementActivity.status.in_(("draft", "scheduled")), ProgramSession.starts_at.isnot(None))
            .options(selectinload(EngagementActivity.questions).selectinload(ActivityQuestion.options))
        )).all()
        for activity, session_starts_at, session_ends_at in rows:
            config = activity.config or {}
            if config.get("auto_start_enabled") is not True:
                continue
            starts_at = session_starts_at.replace(tzinfo=timezone.utc) if session_starts_at.tzinfo is None else session_starts_at
            if now < starts_at:
                continue
            if session_ends_at:
                ends_at = session_ends_at.replace(tzinfo=timezone.utc) if session_ends_at.tzinfo is None else session_ends_at
                if now >= ends_at:
                    continue
            activity.status = "live"
            activity.config = {**config, "auto_started_at": now.isoformat()}
            if config.get("show_automation_enabled") is True:
                _set_guided_lobby(activity, now)
            await db.commit()
            await publish(activity.id, "activity.status_changed", {"status": "live", "reason": "auto_start"})
            logger.info("auto-started activity %s (session started %s)", activity.id, session_starts_at)


async def _auto_close_loop():
    while True:
        try:
            await _auto_close_tick()
        except Exception:
            logger.exception("auto-close tick crashed")
        await asyncio.sleep(AUTO_CLOSE_TICK_SECONDS)


async def _auto_start_loop():
    while True:
        try:
            await _auto_start_tick()
        except Exception:
            logger.exception("auto-start tick crashed")
        await asyncio.sleep(AUTO_CLOSE_TICK_SECONDS)


async def _question_timer_tick():
    """Advance due Guided Show phases from the durable server clock.

    With automation off this retains the original safety behavior: a timed
    answering question still locks at zero. With automation on, every phase
    advances, including multi-question Word Clouds with an activity-level
    collection duration.
    """
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        activities = (await db.execute(
            select(EngagementActivity)
            .where(EngagementActivity.status == "live")
            .options(selectinload(EngagementActivity.questions).selectinload(ActivityQuestion.options))
        )).scalars().all()
        for activity in activities:
            if (activity.config or {}).get("show_mode") != "guided":
                continue
            phase = activity.config.get("show_phase") or "lobby"
            current = next((question for question in activity.questions if question.id == activity.config.get("current_question_id")), None)
            deadline_raw = activity.config.get("show_phase_deadline_at") if activity.config.get("show_automation_enabled") else None
            # Manual Guided Show keeps per-question timers authoritative even
            # though the other phases wait for a presenter action.
            if not deadline_raw and phase == "answering" and current and current.time_limit_seconds:
                opened_at_raw = (current.config or {}).get("opened_at")
                if opened_at_raw:
                    try:
                        opened_at = datetime.fromisoformat(opened_at_raw)
                        if opened_at.tzinfo is None:
                            opened_at = opened_at.replace(tzinfo=timezone.utc)
                        deadline_raw = (opened_at + timedelta(seconds=current.time_limit_seconds)).isoformat()
                    except (TypeError, ValueError):
                        continue
            if not deadline_raw:
                continue
            try:
                deadline = datetime.fromisoformat(deadline_raw)
                if deadline.tzinfo is None:
                    deadline = deadline.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
            if now < deadline:
                continue
            if activity.config.get("show_automation_enabled"):
                next_phase, changed_question = _apply_guided_advance(activity, now)
                reason = "automation"
            else:
                current.live_state = "closed"
                activity.config = {
                    **(activity.config or {}),
                    "show_phase": "locked",
                    "show_phase_started_at": now.isoformat(),
                    "show_phase_deadline_at": None,
                    "display_scene": "question",
                }
                next_phase, changed_question, reason = "locked", current, "timer"
            await db.commit()
            await publish(activity.id, "show.phase_changed", {"phase": next_phase, "question_id": changed_question.id if changed_question else None, "reason": reason})
            if changed_question:
                await publish(activity.id, "question.state_changed", {"question_id": changed_question.id, "state": changed_question.live_state, "reason": reason})
            if next_phase == "complete":
                await publish(activity.id, "activity.status_changed", {"status": activity.status, "reason": reason})
            logger.info("guided show activity %s advanced to %s (%s)", activity.id, next_phase, reason)


async def _question_timer_loop():
    while True:
        try:
            await _question_timer_tick()
        except Exception:
            logger.exception("question timer tick crashed")
        await asyncio.sleep(QUESTION_TIMER_TICK_SECONDS)


async def _display_autofollow_tick():
    """Opt-in per display (settings.auto_follow_program) -- points a TV/
    projector screen at whichever activity is live for whatever program
    session is happening right now, so one physical screen can run all day
    without staff re-pointing it as the schedule moves. Leaves the display
    exactly as it is between sessions or when nothing's live yet for the
    current one, rather than blanking it."""
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        displays = (await db.execute(select(LiveDisplay))).scalars().all()
        for display in displays:
            if (display.settings or {}).get("auto_follow_program") is not True:
                continue
            current_session = await db.scalar(
                select(ProgramSession).where(
                    ProgramSession.org_id == display.org_id,
                    ProgramSession.event_id == display.event_id,
                    ProgramSession.starts_at.isnot(None),
                    ProgramSession.starts_at <= now,
                    or_(ProgramSession.ends_at.is_(None), ProgramSession.ends_at > now),
                ).order_by(ProgramSession.starts_at.desc()).limit(1)
            )
            if not current_session:
                continue
            live_activity = await db.scalar(
                select(EngagementActivity).where(
                    EngagementActivity.org_id == display.org_id,
                    EngagementActivity.event_id == display.event_id,
                    EngagementActivity.session_id == current_session.source_step_id,
                    EngagementActivity.status == "live",
                ).order_by(EngagementActivity.created_at.desc()).limit(1)
            )
            if not live_activity or live_activity.id == display.assigned_activity_id:
                continue
            display.assigned_activity_id = live_activity.id
            display.assigned_session_id = current_session.source_step_id
            await db.commit()
            await publish_display(display.id, "display.changed", {"assigned_activity_id": live_activity.id})
            logger.info("auto-followed display %s -> activity %s (session %s)", display.id, live_activity.id, current_session.title)


async def _display_autofollow_loop():
    while True:
        try:
            await _display_autofollow_tick()
        except Exception:
            logger.exception("display auto-follow tick crashed")
        await asyncio.sleep(DISPLAY_AUTOFOLLOW_TICK_SECONDS)


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
    await asyncio.gather(_job_loop(), _auto_close_loop(), _auto_start_loop(), _question_timer_loop(), _display_autofollow_loop())


if __name__ == "__main__":
    asyncio.run(run())
