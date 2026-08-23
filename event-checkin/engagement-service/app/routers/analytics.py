import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Identity, current_identity, require_guest, require_staff
from ..config import settings
from ..database import get_db
from ..models import ParticipantResponse
from ..schemas import AiAnalysisOut, WordCloudEntry
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
    if not question or question.activity.event_id != identity.event_id:
        raise HTTPException(404, "Question not found")
    if identity.identity_kind != "staff":
        require_guest(identity)
        if not question.activity.config.get("live_results_enabled", True):
            raise HTTPException(403, "Results aren't available for this activity")
    texts = await _text_responses(question_id, db)
    return word_cloud(texts)


@router.post("/questions/{question_id}/ai-analysis", response_model=AiAnalysisOut)
async def ai_analysis(question_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Summarizes open-text responses (feedback/survey/short_text/long_text
    questions) with the shared local-ai llama.cpp server already used by
    support-service — a stateless inference call, not a data-sharing
    integration, so it doesn't compromise engagement-service's DB isolation."""
    require_staff(identity)
    question = await _fetch_question(question_id, db)
    if not question or question.activity.event_id != identity.event_id:
        raise HTTPException(404, "Question not found")
    texts = await _text_responses(question_id, db)
    if not texts:
        return AiAnalysisOut(question_id=question_id, response_count=0, summary="No responses yet.", themes=[], sentiment=None)

    sample = texts[:200]
    prompt = (
        "You are summarizing open-text feedback from event guests answering the question: "
        f'"{question.prompt}"\n\nResponses:\n' + "\n".join(f"- {t}" for t in sample) +
        "\n\nReply with ONLY a JSON object: "
        '{"summary": "<2-3 sentence summary>", "themes": ["<up to 5 short theme labels>"], '
        '"sentiment": "<positive|neutral|mixed|negative>"}'
    )
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(
                f"{settings.local_ai_url.rstrip('/')}/v1/chat/completions",
                json={"messages": [{"role": "user", "content": prompt}], "temperature": 0.2},
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
    except Exception:
        raise HTTPException(503, "AI analysis is temporarily unavailable — try again shortly")

    try:
        start, end = content.index("{"), content.rindex("}") + 1
        parsed = json.loads(content[start:end])
    except (ValueError, json.JSONDecodeError):
        parsed = {"summary": content.strip()[:500], "themes": [], "sentiment": None}

    return AiAnalysisOut(
        question_id=question_id, response_count=len(texts),
        summary=parsed.get("summary") or "", themes=list(parsed.get("themes") or [])[:5],
        sentiment=parsed.get("sentiment"),
    )
