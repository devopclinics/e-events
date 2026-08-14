from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import (Membership, Organization, TrainingAccessGrant, TrainingAssignment, TrainingAuditLog,
                      TrainingCertificate, TrainingCourseRelease, TrainingPractical,
                      TrainingProgress, TrainingQuizAttempt, User)
from ..config import settings
from ..training_catalog import COURSE_KEY, COURSE_VERSION, lessons, published_course
from services.email_service import send_simple_email

router = APIRouter()


class QuizSubmission(BaseModel):
    answers: list[int]


class AssignmentRequest(BaseModel):
    user_ids: list[str] = Field(min_length=1)
    org_id: str | None = None
    due_at: datetime | None = None


class PracticalRequest(BaseModel):
    note: str = Field(min_length=3, max_length=2000)
    link: str | None = Field(default=None, max_length=1000)


class PracticalReview(BaseModel):
    status: Literal["approved", "rejected"]
    notes: str | None = Field(default=None, max_length=2000)


class ReminderRequest(BaseModel):
    user_ids: list[str] = Field(min_length=1)
    org_id: str | None = None


class DueDateRequest(BaseModel):
    due_at: datetime | None = None


class ReleaseRequest(BaseModel):
    title: str = Field(min_length=3, max_length=255)


class AccessGrantRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    reason: str | None = Field(default=None, max_length=1000)


async def _context(db: AsyncSession, user: User, org_id: str | None = None):
    q = select(Membership, Organization).join(Organization, Organization.id == Membership.org_id).where(Membership.user_id == user.id)
    if org_id:
        q = q.where(Membership.org_id == org_id)
    rows = (await db.execute(q.order_by(Membership.created_at))).all()
    if not rows:
        raise HTTPException(403, "You do not belong to an active Festio organization")
    internal_slugs = {x.strip().lower() for x in settings.training_internal_org_slugs.split(",") if x.strip()}
    membership, org = rows[0]
    if not org_id and not user.is_platform_superadmin:
        internal = next(((m, o) for m, o in rows if o.slug.lower() in internal_slugs), None)
        if internal:
            membership, org = internal
        else:
            grants = set((await db.execute(select(TrainingAccessGrant.org_id).where(
                TrainingAccessGrant.user_id == user.id, TrainingAccessGrant.revoked_at.is_(None),
            ))).scalars())
            granted = next(((m, o) for m, o in rows if o.id in grants), None)
            if granted: membership, org = granted
    if not org.is_active:
        raise HTTPException(403, "This organization is suspended")
    return membership, org


def _is_internal(org: Organization) -> bool:
    slugs = {x.strip().lower() for x in settings.training_internal_org_slugs.split(",") if x.strip()}
    return org.slug.lower() in slugs


async def _require_academy_access(db: AsyncSession, user: User, org: Organization):
    if user.is_platform_superadmin or _is_internal(org): return
    grant = (await db.execute(select(TrainingAccessGrant).where(
        TrainingAccessGrant.org_id == org.id, TrainingAccessGrant.user_id == user.id,
        TrainingAccessGrant.revoked_at.is_(None),
    ))).scalar_one_or_none()
    if not grant:
        raise HTTPException(403, "Festio Academy is currently private. Contact a platform administrator for access.")


def _training_manager(user: User, membership: Membership, org: Organization) -> bool:
    return user.is_platform_superadmin or (_is_internal(org) and membership.role in ("owner", "admin"))


def _manager(user: User, membership: Membership) -> bool:
    return user.is_platform_superadmin or membership.role in ("owner", "admin")


def _safe_course():
    course = published_course()
    for module in course["modules"]:
        for lesson in module["lessons"]:
            lesson["quiz"] = [{"question": q["question"], "options": q["options"]} for q in lesson["quiz"]]
    return course


async def _assignment(db, org_id, user_id):
    return (await db.execute(select(TrainingAssignment).where(
        TrainingAssignment.org_id == org_id, TrainingAssignment.user_id == user_id,
        TrainingAssignment.course_key == COURSE_KEY, TrainingAssignment.course_version == COURSE_VERSION,
    ))).scalar_one_or_none()


def _assignment_json(a):
    if not a:
        return None
    return {"id": a.id, "status": a.status, "due_at": a.due_at, "assigned_at": a.assigned_at, "completed_at": a.completed_at}


@router.get("/me")
async def my_training(org_id: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    membership, org = await _context(db, user, org_id)
    await _require_academy_access(db, user, org)
    progress = (await db.execute(select(TrainingProgress).where(
        TrainingProgress.org_id == org.id, TrainingProgress.user_id == user.id,
        TrainingProgress.course_key == COURSE_KEY, TrainingProgress.course_version == COURSE_VERSION,
    ))).scalars().all()
    practicals = (await db.execute(select(TrainingPractical).where(
        TrainingPractical.org_id == org.id, TrainingPractical.user_id == user.id,
        TrainingPractical.course_key == COURSE_KEY,
    ).order_by(TrainingPractical.submitted_at.desc()))).scalars().all()
    completed = [p for p in progress if p.status == "completed"]
    course = _safe_course()
    approved = (await db.execute(select(TrainingPractical).where(
        TrainingPractical.org_id == org.id, TrainingPractical.user_id == user.id,
        TrainingPractical.course_key == COURSE_KEY, TrainingPractical.status == "approved",
    ))).scalars().first()
    certificate_row = (await db.execute(select(TrainingCertificate).where(
        TrainingCertificate.org_id == org.id, TrainingCertificate.user_id == user.id,
        TrainingCertificate.course_key == COURSE_KEY, TrainingCertificate.course_version == COURSE_VERSION,
    ))).scalar_one_or_none()
    eligible = len(completed) == course["lesson_count"] and (approved or not course["requires_practical_approval"])
    if eligible and not certificate_row:
        certificate_row = TrainingCertificate(
            certificate_number=f"FESTIO-{COURSE_VERSION}-{user.id[:8].upper()}-{org.id[:4].upper()}",
            org_id=org.id, user_id=user.id, course_key=COURSE_KEY, course_version=COURSE_VERSION,
        )
        db.add(certificate_row)
        assignment = await _assignment(db, org.id, user.id)
        if assignment: assignment.status, assignment.completed_at = "completed", datetime.utcnow()
        await db.commit(); await db.refresh(certificate_row)
    certificate = {"id": certificate_row.certificate_number, "issued_at": certificate_row.issued_at, "name": user.name} if certificate_row else None
    return {
        "organization": {"id": org.id, "name": org.name}, "role": membership.role,
        "can_manage": _training_manager(user, membership, org), "course": course,
        "assignment": _assignment_json(await _assignment(db, org.id, user.id)),
        "progress": {p.lesson_key: {"status": p.status, "best_score": p.best_score, "completed_at": p.completed_at} for p in progress},
        "practicals": [{"id": p.id, "lesson_key": p.lesson_key, "status": p.status, "evidence": p.evidence, "reviewer_notes": p.reviewer_notes} for p in practicals],
        "completed_count": len(completed), "certificate": certificate,
        "certificate_pending_practical": len(completed) == course["lesson_count"] and not approved and course["requires_practical_approval"],
    }


@router.post("/quiz/{lesson_key}")
async def submit_quiz(lesson_key: str, body: QuizSubmission, org_id: str | None = None,
                      user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _, org = await _context(db, user, org_id)
    await _require_academy_access(db, user, org)
    catalog = lessons()
    index = next((i for i, item in enumerate(catalog) if item["key"] == lesson_key), None)
    if index is None:
        raise HTTPException(404, "Lesson not found")
    if index:
        previous = catalog[index - 1]["key"]
        previous_progress = (await db.execute(select(TrainingProgress).where(
            TrainingProgress.org_id == org.id, TrainingProgress.user_id == user.id,
            TrainingProgress.course_key == COURSE_KEY, TrainingProgress.course_version == COURSE_VERSION,
            TrainingProgress.lesson_key == previous, TrainingProgress.status == "completed",
        ))).scalar_one_or_none()
        if not previous_progress:
            raise HTTPException(409, f"Complete '{catalog[index - 1]['title']}' first")
    lesson = catalog[index]
    if len(body.answers) != len(lesson["quiz"]):
        raise HTTPException(422, "Answer every question before submitting")
    correct = sum(answer == question["correct"] for answer, question in zip(body.answers, lesson["quiz"]))
    score = round(correct * 100 / len(lesson["quiz"]))
    passed = score >= published_course()["passing_score"]
    db.add(TrainingQuizAttempt(org_id=org.id, user_id=user.id, course_key=COURSE_KEY,
                               course_version=COURSE_VERSION, lesson_key=lesson_key,
                               score=score, passed=passed, answers=body.answers))
    p = (await db.execute(select(TrainingProgress).where(
        TrainingProgress.org_id == org.id, TrainingProgress.user_id == user.id,
        TrainingProgress.course_key == COURSE_KEY, TrainingProgress.course_version == COURSE_VERSION,
        TrainingProgress.lesson_key == lesson_key,
    ))).scalar_one_or_none()
    now = datetime.utcnow()
    if not p:
        p = TrainingProgress(org_id=org.id, user_id=user.id, course_key=COURSE_KEY,
                             course_version=COURSE_VERSION, lesson_key=lesson_key)
        db.add(p)
    p.best_score = max(p.best_score or 0, score)
    if passed:
        p.status, p.completed_at = "completed", p.completed_at or now
    assignment = await _assignment(db, org.id, user.id)
    completed_count = len((await db.execute(select(TrainingProgress).where(
        TrainingProgress.org_id == org.id, TrainingProgress.user_id == user.id,
        TrainingProgress.course_key == COURSE_KEY, TrainingProgress.course_version == COURSE_VERSION,
        TrainingProgress.status == "completed",
    ))).scalars().all())
    if assignment:
        assignment.status = "awaiting_practical" if passed and index == len(catalog) - 1 else "in_progress"
    db.add(TrainingAuditLog(org_id=org.id, actor_user_id=user.id, target_user_id=user.id,
                            action="quiz_passed" if passed else "quiz_failed", course_key=COURSE_KEY,
                            lesson_key=lesson_key, details={"score": score}))
    await db.commit()
    return {"score": score, "passed": passed, "best_score": p.best_score, "completed_count": completed_count}


@router.post("/practicals/{lesson_key}")
async def submit_practical(lesson_key: str, body: PracticalRequest, org_id: str | None = None,
                           user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _, org = await _context(db, user, org_id)
    await _require_academy_access(db, user, org)
    if lesson_key not in {x["key"] for x in lessons()}: raise HTTPException(404, "Lesson not found")
    item = TrainingPractical(org_id=org.id, user_id=user.id, course_key=COURSE_KEY,
                             course_version=COURSE_VERSION, lesson_key=lesson_key,
                             evidence={"note": body.note, "link": body.link})
    db.add(item); await db.flush()
    db.add(TrainingAuditLog(org_id=org.id, actor_user_id=user.id, target_user_id=user.id,
                            action="practical_submitted", course_key=COURSE_KEY, lesson_key=lesson_key))
    await db.commit()
    return {"id": item.id, "status": item.status}


@router.get("/manage/people")
async def manage_people(org_id: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    membership, org = await _context(db, user, org_id)
    if not _training_manager(user, membership, org): raise HTTPException(403, "Internal training manager access required")
    rows = (await db.execute(select(Membership, User).join(User, User.id == Membership.user_id).where(Membership.org_id == org.id))).all()
    result = []
    for m, person in rows:
        assignment = await _assignment(db, org.id, person.id)
        progress = (await db.execute(select(TrainingProgress).where(
            TrainingProgress.org_id == org.id, TrainingProgress.user_id == person.id,
            TrainingProgress.course_key == COURSE_KEY, TrainingProgress.status == "completed",
        ))).scalars().all()
        result.append({"id": person.id, "name": person.name, "email": person.email, "role": m.role,
                       "completed_count": len(progress), "assignment": _assignment_json(assignment)})
    practicals = (await db.execute(select(TrainingPractical).where(TrainingPractical.org_id == org.id, TrainingPractical.status == "pending"))).scalars().all()
    return {"organization": {"id": org.id, "name": org.name}, "lesson_count": len(lessons()), "people": result,
            "pending_practicals": [{"id": p.id, "user_id": p.user_id, "lesson_key": p.lesson_key, "evidence": p.evidence, "submitted_at": p.submitted_at} for p in practicals]}


@router.post("/manage/assignments")
async def assign(body: AssignmentRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    membership, org = await _context(db, user, body.org_id)
    if not _training_manager(user, membership, org): raise HTTPException(403, "Internal training manager access required")
    member_ids = set((await db.execute(select(Membership.user_id).where(Membership.org_id == org.id, Membership.user_id.in_(body.user_ids)))).scalars())
    if len(member_ids) != len(set(body.user_ids)): raise HTTPException(422, "Every assignee must be a member of this organization")
    created = 0
    for user_id in body.user_ids:
        item = await _assignment(db, org.id, user_id)
        if not item:
            db.add(TrainingAssignment(org_id=org.id, user_id=user_id, course_key=COURSE_KEY,
                                      course_version=COURSE_VERSION, assigned_by_user_id=user.id, due_at=body.due_at)); created += 1
        else: item.due_at = body.due_at
        db.add(TrainingAuditLog(org_id=org.id, actor_user_id=user.id, target_user_id=user_id,
                                action="course_assigned", course_key=COURSE_KEY, details={"due_at": body.due_at.isoformat() if body.due_at else None}))
    await db.commit()
    return {"assigned": len(body.user_ids), "created": created}


@router.post("/manage/practicals/{practical_id}/review")
async def review(practical_id: str, body: PracticalReview, org_id: str | None = Query(None),
                 user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    membership, org = await _context(db, user, org_id)
    if not _training_manager(user, membership, org): raise HTTPException(403, "Internal training manager access required")
    item = (await db.execute(select(TrainingPractical).where(TrainingPractical.id == practical_id, TrainingPractical.org_id == org.id))).scalar_one_or_none()
    if not item: raise HTTPException(404, "Practical submission not found")
    item.status, item.reviewer_user_id, item.reviewer_notes, item.reviewed_at = body.status, user.id, body.notes, datetime.utcnow()
    db.add(TrainingAuditLog(org_id=org.id, actor_user_id=user.id, target_user_id=item.user_id,
                            action=f"practical_{body.status}", course_key=COURSE_KEY, lesson_key=item.lesson_key))
    await db.commit()
    return {"status": item.status}


@router.patch("/manage/assignments/{assignment_id}/due-date")
async def set_due_date(assignment_id: str, body: DueDateRequest, org_id: str | None = None,
                       user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    membership, org = await _context(db, user, org_id)
    if not _training_manager(user, membership, org): raise HTTPException(403, "Internal training manager access required")
    item = (await db.execute(select(TrainingAssignment).where(TrainingAssignment.id == assignment_id, TrainingAssignment.org_id == org.id))).scalar_one_or_none()
    if not item: raise HTTPException(404, "Assignment not found")
    item.due_at = body.due_at
    db.add(TrainingAuditLog(org_id=org.id, actor_user_id=user.id, target_user_id=item.user_id,
                            action="due_date_updated", course_key=COURSE_KEY,
                            details={"due_at": body.due_at.isoformat() if body.due_at else None}))
    await db.commit()
    return {"due_at": item.due_at}


@router.post("/manage/reminders")
async def send_reminders(body: ReminderRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    membership, org = await _context(db, user, body.org_id)
    if not _training_manager(user, membership, org): raise HTTPException(403, "Internal training manager access required")
    people = (await db.execute(select(User).join(Membership, Membership.user_id == User.id).where(
        Membership.org_id == org.id, User.id.in_(body.user_ids)))).scalars().all()
    if len(people) != len(set(body.user_ids)): raise HTTPException(422, "Every recipient must belong to this organization")
    for person in people:
        assignment = await _assignment(db, org.id, person.id)
        due = f" Your due date is {assignment.due_at:%B %d, %Y}." if assignment and assignment.due_at else ""
        await send_simple_email(person.email, "Your Festio Academy training", f"<p>Hello {person.name},</p><p>Your Festio Academy training is ready.{due}</p><p><a href='https://festio.events/training'>Continue training</a></p><p>Questions? support@festio.events</p>", message_kind="training_reminder")
        db.add(TrainingAuditLog(org_id=org.id, actor_user_id=user.id, target_user_id=person.id,
                                action="reminder_sent", course_key=COURSE_KEY))
    await db.commit()
    return {"sent": len(people)}


@router.get("/manage/audit")
async def audit(org_id: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    membership, org = await _context(db, user, org_id)
    if not _training_manager(user, membership, org): raise HTTPException(403, "Internal training manager access required")
    rows = (await db.execute(select(TrainingAuditLog, User).join(User, User.id == TrainingAuditLog.actor_user_id)
                            .where(TrainingAuditLog.org_id == org.id).order_by(TrainingAuditLog.created_at.desc()).limit(200))).all()
    return [{"id": row.id, "action": row.action, "actor": actor.name, "target_user_id": row.target_user_id,
             "lesson_key": row.lesson_key, "details": row.details, "created_at": row.created_at} for row, actor in rows]


@router.get("/admin/releases")
async def releases(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.is_platform_superadmin: raise HTTPException(403, "Platform administrator access required")
    rows = (await db.execute(select(TrainingCourseRelease).where(TrainingCourseRelease.course_key == COURSE_KEY).order_by(TrainingCourseRelease.version.desc()))).scalars().all()
    return [{"id": x.id, "version": x.version, "title": x.title, "status": x.status, "created_at": x.created_at, "published_at": x.published_at} for x in rows]


@router.post("/admin/releases")
async def create_release(body: ReleaseRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.is_platform_superadmin: raise HTTPException(403, "Platform administrator access required")
    rows = (await db.execute(select(TrainingCourseRelease.version).where(TrainingCourseRelease.course_key == COURSE_KEY))).scalars().all()
    version = max([COURSE_VERSION, *rows]) + 1
    item = TrainingCourseRelease(course_key=COURSE_KEY, version=version, title=body.title, status="draft",
                                 content=published_course(), created_by_user_id=user.id)
    db.add(item); await db.commit(); await db.refresh(item)
    return {"id": item.id, "version": version, "status": item.status}


@router.post("/admin/releases/{release_id}/publish")
async def publish_release(release_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.is_platform_superadmin: raise HTTPException(403, "Platform administrator access required")
    item = (await db.execute(select(TrainingCourseRelease).where(TrainingCourseRelease.id == release_id))).scalar_one_or_none()
    if not item: raise HTTPException(404, "Course release not found")
    if item.status == "published": return {"version": item.version, "status": item.status}
    item.status, item.published_at = "published", datetime.utcnow()
    await db.commit()
    return {"version": item.version, "status": item.status}


@router.get("/admin/access")
async def access_grants(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.is_platform_superadmin: raise HTTPException(403, "Platform administrator access required")
    rows = (await db.execute(
        select(TrainingAccessGrant, User, Organization)
        .join(User, User.id == TrainingAccessGrant.user_id)
        .join(Organization, Organization.id == TrainingAccessGrant.org_id)
        .where(TrainingAccessGrant.revoked_at.is_(None))
        .order_by(TrainingAccessGrant.granted_at.desc())
    )).all()
    return [{"id": grant.id, "user_id": person.id, "name": person.name, "email": person.email,
             "organization": org.name, "org_id": org.id, "reason": grant.reason,
             "granted_at": grant.granted_at} for grant, person, org in rows]


@router.post("/admin/access")
async def grant_access(body: AccessGrantRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.is_platform_superadmin: raise HTTPException(403, "Platform administrator access required")
    person = (await db.execute(select(User).where(User.email == body.email.strip().lower()))).scalar_one_or_none()
    if not person: raise HTTPException(404, "No Festio account was found for that email")
    membership_org = (await db.execute(
        select(Membership, Organization).join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == person.id, Membership.role == "owner")
        .order_by(Membership.created_at)
    )).first()
    if not membership_org: raise HTTPException(422, "Academy access can currently be granted only to an organization owner")
    membership, org = membership_org
    grant = (await db.execute(select(TrainingAccessGrant).where(
        TrainingAccessGrant.org_id == org.id, TrainingAccessGrant.user_id == person.id,
    ))).scalar_one_or_none()
    if grant:
        grant.revoked_at, grant.granted_by_user_id, grant.reason, grant.granted_at = None, user.id, body.reason, datetime.utcnow()
    else:
        grant = TrainingAccessGrant(org_id=org.id, user_id=person.id, granted_by_user_id=user.id, reason=body.reason)
        db.add(grant)
    await db.flush()
    db.add(TrainingAuditLog(org_id=org.id, actor_user_id=user.id, target_user_id=person.id,
                            action="academy_access_granted", course_key=COURSE_KEY,
                            details={"reason": body.reason}))
    await db.commit()
    return {"id": grant.id, "email": person.email, "organization": org.name}


@router.delete("/admin/access/{grant_id}", status_code=204)
async def revoke_access(grant_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.is_platform_superadmin: raise HTTPException(403, "Platform administrator access required")
    grant = (await db.execute(select(TrainingAccessGrant).where(TrainingAccessGrant.id == grant_id,
                                                                TrainingAccessGrant.revoked_at.is_(None)))).scalar_one_or_none()
    if not grant: raise HTTPException(404, "Academy access grant not found")
    grant.revoked_at = datetime.utcnow()
    db.add(TrainingAuditLog(org_id=grant.org_id, actor_user_id=user.id, target_user_id=grant.user_id,
                            action="academy_access_revoked", course_key=COURSE_KEY))
    await db.commit()


@router.post("/manage/people/{target_user_id}/reset")
async def reset_progress(target_user_id: str, org_id: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    membership, org = await _context(db, user, org_id)
    if not _training_manager(user, membership, org): raise HTTPException(403, "Internal training manager access required")
    await db.execute(delete(TrainingProgress).where(TrainingProgress.org_id == org.id, TrainingProgress.user_id == target_user_id, TrainingProgress.course_key == COURSE_KEY))
    assignment = await _assignment(db, org.id, target_user_id)
    if assignment: assignment.status, assignment.completed_at = "assigned", None
    db.add(TrainingAuditLog(org_id=org.id, actor_user_id=user.id, target_user_id=target_user_id, action="progress_reset", course_key=COURSE_KEY))
    await db.commit()
    return {"reset": True}
