from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity, require_guest, require_staff
from ..database import get_db
from ..models import FeedbackAnalysis, ModerationItem, ParticipantResponse
from ..schemas import AnalysisJobOut, WordCloudEntry
from ..wordcloud import word_cloud
from .activities import _fetch_question

router = APIRouter(prefix="/api/engagement/v1", tags=["engagement-analytics"])


async def _text_responses(question_id: str, db: AsyncSession) -> list[str]:
    values = (await db.execute(
        select(ParticipantResponse.answer_value).where(ParticipantResponse.question_id == question_id)
    )).scalars().all()
    out = []
    for v in values:
        if isinstance(v, str) and v.strip():
            out.append(v.strip())
        elif isinstance(v, dict) and isinstance(v.get("text"), str) and v["text"].strip():
            out.append(v["text"].strip())
    return out


@router.get("/questions/{question_id}/word-cloud", response_model=list[WordCloudEntry])
async def get_word_cloud(question_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    question = await _fetch_question(question_id, db)
    if not question or question.activity.event_id != identity.event_id or (identity.org_id and question.activity.org_id != identity.org_id):
        raise HTTPException(404, "Question not found")
    if identity.identity_kind != "staff":
        require_guest(identity)
        if not question.activity.config.get("live_results_enabled", True) or question.live_state not in ("results_visible", "answer_revealed"):
            raise HTTPException(403, "Results aren't available for this activity")
    if identity.identity_kind == "staff":
        texts = await _text_responses(question_id, db)
    else:
        texts = list((await db.execute(select(ModerationItem.content).where(
            ModerationItem.question_id == question_id,
            ModerationItem.status == "approved",
        ))).scalars().all())
    return word_cloud(texts)


@router.post("/questions/{question_id}/ai-analysis", response_model=AnalysisJobOut, status_code=202)
async def ai_analysis(question_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Persist a job and return immediately; AI never runs in submission or API paths."""
    require_staff(identity)
    question = await _fetch_question(question_id, db)
    if not question or question.activity.event_id != identity.event_id or (identity.org_id and question.activity.org_id != identity.org_id):
        raise HTTPException(404, "Question not found")
    existing = await db.scalar(select(FeedbackAnalysis).where(
        FeedbackAnalysis.question_id == question_id,
        FeedbackAnalysis.status.in_(("queued", "running")),
    ).order_by(FeedbackAnalysis.created_at.desc()))
    if existing:
        return existing
    job = FeedbackAnalysis(org_id=identity.org_id, event_id=identity.event_id, question_id=question_id)
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


@router.get("/analysis/{job_id}", response_model=AnalysisJobOut)
async def analysis_status(job_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    require_staff(identity)
    job = await db.get(FeedbackAnalysis, job_id)
    if not job or job.event_id != identity.event_id or (identity.org_id and job.org_id != identity.org_id):
        raise HTTPException(404, "Analysis job not found")
    return job
