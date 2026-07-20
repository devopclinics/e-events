"""Save/list endpoints for the standalone staging QA checklist
(public/media/festio-qa-checklist.html). That page is unauthenticated — testers
just type a name — so POST is public too; only listing is operator-gated."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import QaChecklistSubmission, User
from ..schemas import (
    QaChecklistSubmissionCreate,
    QaChecklistSubmissionOut,
    QaChecklistSubmissionDetail,
)
from ..auth import require_superadmin

router = APIRouter()


@router.post("/submissions", response_model=QaChecklistSubmissionOut, status_code=201)
async def submit_qa_checklist(
    body: QaChecklistSubmissionCreate,
    db: AsyncSession = Depends(get_db),
):
    counts = {"pass": 0, "issue": 0, "blocked": 0, "na": 0}
    for item in body.results:
        counts[item.status] = counts.get(item.status, 0) + 1

    row = QaChecklistSubmission(
        tester_name=body.tester_name.strip(),
        summary=(body.summary or "").strip() or None,
        tested_count=len(body.results),
        pass_count=counts["pass"],
        issue_count=counts["issue"],
        blocked_count=counts["blocked"],
        na_count=counts["na"],
        results=[item.model_dump() for item in body.results],
        user_agent=(body.user_agent or "").strip() or None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/submissions", response_model=list[QaChecklistSubmissionOut])
async def list_qa_checklist_submissions(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    rows = (await db.execute(
        select(QaChecklistSubmission).order_by(desc(QaChecklistSubmission.created_at))
    )).scalars().all()
    return rows


@router.get("/submissions/{submission_id}", response_model=QaChecklistSubmissionDetail)
async def get_qa_checklist_submission(
    submission_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    row = await db.get(QaChecklistSubmission, submission_id)
    if not row:
        raise HTTPException(404, "Submission not found")
    return row
