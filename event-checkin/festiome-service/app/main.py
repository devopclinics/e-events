import base64
import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import secrets
import time
import uuid
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from urllib.parse import urlparse

import jwt
from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from redis.asyncio import Redis
from sqlalchemy import and_, delete, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import Identity, current_identity, internal_service
from .database import SessionLocal, get_db
from .models import (
    Attachment, AuditLog, Channel, ChannelReadState, FestioMeGroup, IntegrationCommand, Invitation, JoinRequest, Member, Mention, Message,
    ModerationReport, NotificationJob, NotificationPreference, PendingUpload, Poll, PollOption, PollVote, Reaction, Tenant,
)
from .schemas import (
    AttachmentOut, ChannelCreate, ChannelOut, EventGroupAdminOut, EventLinkCreate, EventLinkOut, GroupCreate, GroupDirectoryOut, GroupOut, GroupUpdate, InvitationCreate,
    InvitationOut, JoinGroupRequest, JoinGroupResult, JoinRequestDecision, JoinRequestOut, MemberOut, MessageCreate, MessageOut, MessagePage,
    MemberUpdate, MessageUpdate, NotificationPreferenceIn, NotificationPreferenceOut, OwnershipTransfer, PollCreate, PollVoteCreate,
    ReactionCreate, ReactionOut, ReadStateOut, ReadStateUpdate, ReportCreate, RulesAcceptResult, SubGroupCreate,
    RealtimeTicketOut, ReportOut, ReportPage, ReportUpdate,
)
from .config import settings

redis = Redis.from_url(settings.redis_url, decode_responses=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    scheduler = asyncio.create_task(_scheduled_publisher())
    yield
    scheduler.cancel()
    try:
        await scheduler
    except asyncio.CancelledError:
        pass


async def _scheduled_publisher():
    while True:
        try:
            async with SessionLocal() as db:
                rows = (await db.execute(select(Message).where(
                    Message.scheduled_for.is_not(None), Message.scheduled_for <= datetime.utcnow(),
                    Message.published_at.is_(None), Message.deleted_at.is_(None))
                    .with_for_update(skip_locked=True).limit(100))).scalars().all()
                for message in rows:
                    message.published_at = datetime.utcnow()
                expired_uploads = (await db.execute(select(PendingUpload).where(
                    PendingUpload.message_id.is_(None), PendingUpload.expires_at <= datetime.utcnow()
                ).limit(100))).scalars().all()
                for upload in expired_uploads:
                    try:
                        await asyncio.to_thread(Path(upload.path).unlink, missing_ok=True)
                    finally:
                        await db.delete(upload)
                await db.commit()
                for message in rows:
                    author = await db.get(Member, message.author_member_id)
                    result = await _message_out(db, message, author.id if author else "")
                    await _publish(message.channel_id, "message.created", result.model_dump(mode="json"))
        except Exception:
            pass
        await asyncio.sleep(5)


app = FastAPI(title="FestioMe Internal Service", version="0.2.0", lifespan=lifespan)

logger = logging.getLogger("uvicorn.error")
_http_metrics: Counter = Counter()


@app.middleware("http")
async def request_observability(request: Request, call_next):
    """Attach a correlation ID and emit one structured record per request."""
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = request_id
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(json.dumps({
            "event": "http_request", "request_id": request_id,
            "method": request.method, "path": request.url.path,
            "status": 500,
        }))
        raise
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers["x-request-id"] = request_id
    _http_metrics[(request.method, request.url.path, response.status_code)] += 1
    logger.info(json.dumps({
        "event": "http_request", "request_id": request_id,
        "method": request.method, "path": request.url.path,
        "status": response.status_code, "duration_ms": elapsed_ms,
    }))
    return response

STAFF_ROLES = {"owner", "admin", "moderator"}
ADMIN_ROLES = {"owner", "admin"}


async def _rate_limit(key: str, limit: int, seconds: int = 60) -> None:
    """Fixed-window protection; Redis outages never take messaging down."""
    try:
        value = await redis.incr(f"rate:{key}")
        if value == 1:
            await redis.expire(f"rate:{key}", seconds)
        if value > limit:
            raise HTTPException(429, "Too many FestioMe requests")
    except HTTPException:
        raise
    except Exception:
        return


async def _publish(channel_id: str, event: str, payload: dict) -> None:
    try:
        await redis.publish(f"festiome:channel:{channel_id}", json.dumps({"event": event, "data": payload}, default=str))
    except Exception:
        pass


def _audit(db: AsyncSession, group_id: str, actor: Member | None, action: str, target_type: str, target_id: str, **details) -> None:
    db.add(AuditLog(group_id=group_id, actor_member_id=actor.id if actor else None, action=action,
                    target_type=target_type, target_id=target_id, details=details))


def _encode_cursor(created_at: datetime, row_id: str) -> str:
    raw = f"{created_at.isoformat()}|{row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> tuple[datetime, str] | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        timestamp, row_id = base64.urlsafe_b64decode(padded).decode().split("|", 1)
        return datetime.fromisoformat(timestamp), row_id
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid cursor")


async def _member(db: AsyncSession, group_id: str, identity: Identity) -> Member:
    member = (await db.execute(select(Member).where(
        Member.group_id == group_id,
        Member.identity_kind == identity.kind,
        Member.identity_ref == identity.subject,
        Member.removed_at.is_(None),
    ))).scalar_one_or_none()
    if not member:
        raise HTTPException(404, "FestioMe group not found")
    return member


def _rules_accepted(group: FestioMeGroup, member: Member) -> bool:
    """A member is clear to post when the group has no rules, or they have
    accepted the current version."""
    if not (group.rules or "").strip():
        return True
    return (member.rules_accepted_version or 0) >= group.rules_version


async def _group_out(db: AsyncSession, group: FestioMeGroup, member: Member) -> GroupOut:
    member_count = (await db.execute(select(func.count(Member.id)).where(Member.group_id == group.id, Member.removed_at.is_(None)))).scalar_one()
    channel_ids = select(Channel.id).where(Channel.group_id == group.id, Channel.archived.is_(False))
    if member.role not in STAFF_ROLES: channel_ids = channel_ids.where(Channel.kind != "staff")
    states = (await db.execute(select(ChannelReadState).where(ChannelReadState.member_id == member.id))).scalars().all()
    state_by_channel = {state.channel_id: state for state in states}
    unread = 0
    for channel_id in (await db.execute(channel_ids)).scalars().all():
        query = select(func.count(Message.id)).where(Message.channel_id == channel_id, Message.deleted_at.is_(None),
                    Message.published_at.is_not(None), Message.author_member_id != member.id)
        if channel_id in state_by_channel: query = query.where(Message.created_at > state_by_channel[channel_id].read_at)
        unread += (await db.execute(query)).scalar_one()
    pending = 0
    if member.role in STAFF_ROLES:
        pending = (await db.execute(select(func.count(JoinRequest.id)).where(
            JoinRequest.group_id == group.id, JoinRequest.status == "pending"))).scalar_one()
    return GroupOut.model_validate(group).model_copy(update={
        "member_count": member_count, "unread_count": unread, "viewer_role": member.role,
        "rules_accepted": _rules_accepted(group, member), "pending_request_count": pending,
    })


async def _channel_access(db: AsyncSession, channel_id: str, identity: Identity) -> tuple[Channel, Member]:
    channel = (await db.execute(select(Channel).where(Channel.id == channel_id, Channel.archived.is_(False)))).scalar_one_or_none()
    if not channel:
        raise HTTPException(404, "FestioMe channel not found")
    member = await _member(db, channel.group_id, identity)
    if channel.kind == "staff" and member.role not in STAFF_ROLES:
        raise HTTPException(404, "FestioMe channel not found")
    return channel, member


def _require_role(member: Member, allowed: set[str]) -> None:
    if member.role not in allowed:
        raise HTTPException(403, "Insufficient FestioMe permission")


async def _message_out(db: AsyncSession, message: Message, viewer_id: str) -> MessageOut:
    author = await db.get(Member, message.author_member_id)
    reactions = (await db.execute(select(Reaction).where(Reaction.message_id == message.id))).scalars().all()
    counts = Counter(reaction.emoji for reaction in reactions)
    mine = {reaction.emoji for reaction in reactions if reaction.member_id == viewer_id}
    attachments = (await db.execute(select(Attachment).where(Attachment.message_id == message.id))).scalars().all()
    mentions = (await db.execute(select(Mention.member_id).where(Mention.message_id == message.id))).scalars().all()
    poll = (await db.execute(select(Poll).where(Poll.message_id == message.id))).scalar_one_or_none()
    poll_data = None
    if poll:
        options = (await db.execute(select(PollOption).where(PollOption.poll_id == poll.id).order_by(PollOption.position))).scalars().all()
        poll_counts = dict((await db.execute(select(PollVote.option_id, func.count(PollVote.id)).where(PollVote.poll_id == poll.id).group_by(PollVote.option_id))).all())
        mine_votes = set((await db.execute(select(PollVote.option_id).where(PollVote.poll_id == poll.id, PollVote.member_id == viewer_id))).scalars().all())
        poll_data = {"id": poll.id, "question": poll.question, "multiple_choice": poll.multiple_choice, "closes_at": poll.closes_at,
                     "options": [{"id": o.id, "label": o.label, "text": o.label, "votes": poll_counts.get(o.id, 0), "voted_by_me": o.id in mine_votes} for o in options]}
    return MessageOut(
        id=message.id, group_id=message.group_id, channel_id=message.channel_id,
        author_member_id=message.author_member_id,
        author_name=author.display_name if author else "Former member",
        parent_id=message.parent_id,
        body="" if message.deleted_at else message.body,
        edited_at=message.edited_at, deleted_at=message.deleted_at,
        created_at=message.created_at,
        scheduled_for=message.scheduled_for, published_at=message.published_at,
        attachments=[AttachmentOut.model_validate({"id": a.id, "url": a.url, "filename": a.filename,
                     "mime_type": a.mime_type, "size_bytes": a.size_bytes}) for a in attachments],
        mention_member_ids=list(mentions),
        poll=poll_data,
        reactions=[ReactionOut(emoji=emoji, count=count, reacted_by_me=emoji in mine) for emoji, count in counts.items()],
    )


@app.get("/health")
async def health():
    return {"status": "ok", "service": "festiome"}


@app.get("/ready")
async def ready(db: AsyncSession = Depends(get_db)):
    await db.execute(text("select 1"))
    return {"status": "ready", "service": "festiome"}


@app.get("/internal/metrics", response_class=PlainTextResponse)
async def metrics(_: None = Depends(internal_service)):
    """Small dependency-free scrape surface for the private service network."""
    lines = ["# HELP festiome_http_requests_total HTTP requests handled by FestioMe.",
             "# TYPE festiome_http_requests_total counter"]
    for (method, path, status), count in sorted(_http_metrics.items()):
        safe_path = path.replace('\\', '\\\\').replace('"', '\\"')
        lines.append(
            f'festiome_http_requests_total{{method="{method}",path="{safe_path}",status="{status}"}} {count}'
        )
    return "\n".join(lines) + "\n"


def _event_link(group: FestioMeGroup) -> EventLinkOut:
    return EventLinkOut(
        festiome_id=group.id, name=group.name,
        open_url=f"/festiome?group={group.id}",
    )


@app.get("/internal/v1/guesthub/event-links/{external_event_ref}", response_model=EventLinkOut)
async def get_event_link(
    external_event_ref: str, _: None = Depends(internal_service),
    db: AsyncSession = Depends(get_db),
):
    group = (await db.execute(select(FestioMeGroup).where(
        FestioMeGroup.external_event_ref == external_event_ref,
        FestioMeGroup.archived.is_(False),
    ).limit(1))).scalar_one_or_none()
    if not group:
        raise HTTPException(404, "FestioMe is not enabled for this event")
    return _event_link(group)


@app.post("/internal/v1/guesthub/event-links", response_model=EventLinkOut, status_code=201)
async def create_event_link(
    body: EventLinkCreate, _: None = Depends(internal_service),
    db: AsyncSession = Depends(get_db),
):
    tenant = (await db.execute(select(Tenant).where(Tenant.external_org_ref == body.external_org_ref))).scalar_one_or_none()
    if not tenant:
        tenant = Tenant(external_org_ref=body.external_org_ref, name=body.name.strip())
        db.add(tenant)
        await db.flush()
    group = (await db.execute(select(FestioMeGroup).where(
        FestioMeGroup.tenant_id == tenant.id,
        FestioMeGroup.external_event_ref == body.external_event_ref,
        FestioMeGroup.is_primary.is_(True),
    ))).scalar_one_or_none()
    if not group:
        group = FestioMeGroup(
            tenant_id=tenant.id, external_event_ref=body.external_event_ref,
            name=body.name.strip(), created_by_subject=body.owner.subject,
            is_primary=True,
        )
        db.add(group)
        await db.flush()
    else:
        group.name = body.name.strip()
        group.archived = False
    owner = (await db.execute(select(Member).where(
        Member.group_id == group.id, Member.identity_kind == "user",
        Member.identity_ref == body.owner.subject,
    ))).scalar_one_or_none()
    if not owner:
        owner = Member(
            group_id=group.id, identity_kind="user", identity_ref=body.owner.subject,
            display_name=body.owner.name.strip(), role="owner",
        )
        db.add(owner)
        await db.flush()
    else:
        owner.display_name = body.owner.name.strip()
        owner.role = "owner"
        owner.removed_at = None
    general = (await db.execute(select(Channel).where(Channel.group_id == group.id, Channel.slug == "general"))).scalar_one_or_none()
    if not general:
        db.add(Channel(group_id=group.id, name="General", slug="general", kind="discussion", created_by_member_id=owner.id))
    await db.commit()
    await db.refresh(group)
    return _event_link(group)


async def _event_group(db: AsyncSession, external_event_ref: str) -> FestioMeGroup:
    """The event's canonical (primary) group. Guest sync, announcements, and
    guest tokens always target this one — never an opt-in sub-group."""
    group = (await db.execute(select(FestioMeGroup).where(
        FestioMeGroup.external_event_ref == external_event_ref,
        FestioMeGroup.is_primary.is_(True),
        FestioMeGroup.archived.is_(False),
    ).limit(1))).scalar_one_or_none()
    if not group: raise HTTPException(404, "FestioMe is not enabled for this event")
    return group


async def _event_membership(db: AsyncSession, group: FestioMeGroup, identity: Identity) -> Member | None:
    """The caller's membership in the primary group of `group`'s event — the
    entitlement that lets an event guest discover and join its sub-groups.
    Returns None for standalone groups or non-event-members."""
    if not group.external_event_ref:
        return None
    primary = (await db.execute(select(FestioMeGroup).where(
        FestioMeGroup.tenant_id == group.tenant_id,
        FestioMeGroup.external_event_ref == group.external_event_ref,
        FestioMeGroup.is_primary.is_(True),
    ))).scalar_one_or_none()
    if not primary:
        return None
    return (await db.execute(select(Member).where(
        Member.group_id == primary.id,
        Member.identity_kind == identity.kind,
        Member.identity_ref == identity.subject,
        Member.removed_at.is_(None),
    ))).scalar_one_or_none()


async def _active_member(db: AsyncSession, group_id: str, identity: Identity) -> Member | None:
    return (await db.execute(select(Member).where(
        Member.group_id == group_id,
        Member.identity_kind == identity.kind,
        Member.identity_ref == identity.subject,
        Member.removed_at.is_(None),
    ))).scalar_one_or_none()


@app.put("/internal/v1/guesthub/event-links/{external_event_ref}/members/{guest_ref}", response_model=MemberOut)
async def upsert_event_guest(external_event_ref: str, guest_ref: str, body: dict = Body(...), _: None = Depends(internal_service), db: AsyncSession = Depends(get_db)):
    group = await _event_group(db, external_event_ref)
    member = (await db.execute(select(Member).where(Member.group_id == group.id, Member.identity_kind == "guest",
              Member.identity_ref == guest_ref))).scalar_one_or_none()
    name = str(body.get("name") or body.get("email") or "Guest").strip()[:255]
    if not member:
        member = Member(group_id=group.id, identity_kind="guest", identity_ref=guest_ref, display_name=name, role="member")
        db.add(member)
    else:
        member.display_name, member.removed_at = name, None
    await db.commit(); await db.refresh(member)
    return member


@app.delete("/internal/v1/guesthub/event-links/{external_event_ref}/members/{guest_ref}", status_code=204)
async def remove_event_guest(external_event_ref: str, guest_ref: str, _: None = Depends(internal_service), db: AsyncSession = Depends(get_db)):
    group = await _event_group(db, external_event_ref)
    member = (await db.execute(select(Member).where(Member.group_id == group.id, Member.identity_kind == "guest",
              Member.identity_ref == guest_ref, Member.removed_at.is_(None)))).scalar_one_or_none()
    if member: member.removed_at = datetime.utcnow(); await db.commit()


@app.post("/internal/v1/guesthub/event-links/{external_event_ref}/guest-token")
async def issue_guest_token(external_event_ref: str, body: dict = Body(...), _: None = Depends(internal_service), db: AsyncSession = Depends(get_db)):
    group = await _event_group(db, external_event_ref); guest_ref = str(body.get("guest_ref") or "")
    member = (await db.execute(select(Member).where(Member.group_id == group.id, Member.identity_kind == "guest",
              Member.identity_ref == guest_ref, Member.removed_at.is_(None)))).scalar_one_or_none()
    if not member: raise HTTPException(403, "Guest is not a FestioMe member")
    expires = datetime.utcnow() + timedelta(minutes=30)
    token = jwt.encode({"sub": guest_ref, "email": body.get("email") or "", "name": body.get("name") or member.display_name,
                        "identity_kind": "guest", "aud": "festiome", "iss": "guesthub", "exp": expires},
                       settings.internal_service_token, algorithm="HS256")
    return {"token": token, "expires_at": expires}


@app.post("/internal/v1/guesthub/event-links/{external_event_ref}/announcements", response_model=MessageOut, status_code=201)
async def post_event_announcement(external_event_ref: str, body: dict = Body(...), _: None = Depends(internal_service), db: AsyncSession = Depends(get_db)):
    group = await _event_group(db, external_event_ref); key = str(body.get("idempotency_key") or "")[:128]
    if not key: raise HTTPException(422, "idempotency_key is required")
    prior = (await db.execute(select(IntegrationCommand).where(IntegrationCommand.idempotency_key == key))).scalar_one_or_none()
    service = (await db.execute(select(Member).where(Member.group_id == group.id, Member.identity_kind == "service",
              Member.identity_ref == "guesthub"))).scalar_one_or_none()
    if not service:
        service = Member(group_id=group.id, identity_kind="service", identity_ref="guesthub", display_name="Festio", role="admin")
        db.add(service); await db.flush()
    if prior:
        message = await db.get(Message, prior.resource_id)
        if message: return await _message_out(db, message, service.id)
    channel = (await db.execute(select(Channel).where(Channel.group_id == group.id, Channel.kind == "announcement",
              Channel.archived.is_(False)).limit(1))).scalar_one_or_none()
    if not channel:
        channel = (await db.execute(select(Channel).where(Channel.group_id == group.id, Channel.slug == "general"))).scalar_one()
    title, content = str(body.get("title") or "").strip(), str(body.get("body") or "").strip()
    if not content: raise HTTPException(422, "body is required")
    message = Message(group_id=group.id, channel_id=channel.id, author_member_id=service.id,
                      body=f"{title}\n\n{content}" if title else content, published_at=datetime.utcnow())
    db.add(message); await db.flush(); db.add(IntegrationCommand(idempotency_key=key, resource_id=message.id))
    _audit(db, group.id, service, "integration.announcement", "message", message.id, source_ref=body.get("source_ref"), urgent=bool(body.get("urgent")))
    await db.commit(); await db.refresh(message)
    result = await _message_out(db, message, service.id); await _publish(channel.id, "message.created", result.model_dump(mode="json"))
    return result


@app.get("/v1/groups", response_model=list[GroupOut])
async def list_groups(identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    groups = (await db.execute(
        select(FestioMeGroup).join(Member, Member.group_id == FestioMeGroup.id).where(
            Member.identity_kind == identity.kind, Member.identity_ref == identity.subject,
            Member.removed_at.is_(None), FestioMeGroup.archived.is_(False),
        ).order_by(FestioMeGroup.created_at.desc())
    )).scalars().all()
    return [await _group_out(db, group, await _member(db, group.id, identity)) for group in groups]


@app.post("/v1/groups", response_model=GroupOut, status_code=201)
async def create_group(body: GroupCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    await _rate_limit(f"group:{identity.subject}", 10, 3600)
    tenant = Tenant(name=body.tenant_name.strip())
    db.add(tenant)
    await db.flush()
    group = FestioMeGroup(tenant_id=tenant.id, name=body.name.strip(), description=body.description.strip(), created_by_subject=identity.subject)
    db.add(group)
    await db.flush()
    owner = Member(group_id=group.id, identity_kind="user", identity_ref=identity.subject, display_name=identity.name, role="owner")
    db.add(owner)
    await db.flush()
    db.add(Channel(group_id=group.id, name="General", slug="general", kind="discussion", created_by_member_id=owner.id))
    await db.commit()
    await db.refresh(group)
    return await _group_out(db, group, owner)


@app.get("/v1/groups/{group_id}", response_model=GroupOut)
async def get_group(group_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    group = await db.get(FestioMeGroup, group_id)
    if not group or group.archived:
        raise HTTPException(404, "FestioMe group not found")
    return await _group_out(db, group, member)


def _apply_group_update(group: FestioMeGroup, body: GroupUpdate, actor: Member) -> None:
    """Mutate `group` from a validated GroupUpdate. Shared by the member-authed
    and internal (GuestHub organizer) update paths."""
    if body.name is not None:
        group.name = body.name.strip()
    if body.description is not None:
        group.description = body.description.strip()
    if body.archived is not None:
        group.archived = body.archived
    if body.join_policy is not None:
        if group.is_primary and body.join_policy != "closed":
            raise HTTPException(400, "The primary event group is roster-managed and stays closed; create a sub-group for open or request-to-join access")
        group.join_policy = body.join_policy
    if body.visibility is not None:
        group.visibility = body.visibility
    if body.rules is not None:
        new_rules = body.rules.strip()
        if new_rules != (group.rules or ""):
            group.rules = new_rules
            # Advancing the text forces every member to re-accept; the editor is
            # treated as having accepted what they just wrote.
            group.rules_version = (group.rules_version or 0) + 1
            actor.rules_accepted_version = group.rules_version


async def _decide_join_request(db: AsyncSession, group_id: str, request_id: str, actor: Member, *, approve: bool, role: str = "member") -> Member | None:
    """Approve or deny a pending join request as `actor`. Returns the admitted
    member on approval, else None. Shared by member-authed and internal paths."""
    req = await db.get(JoinRequest, request_id)
    if not req or req.group_id != group_id:
        raise HTTPException(404, "FestioMe join request not found")
    if req.status != "pending":
        raise HTTPException(409, "This request has already been decided")
    req.decided_by_member_id = actor.id
    req.decided_at = datetime.utcnow()
    if not approve:
        req.status = "denied"
        _audit(db, group_id, actor, "joinrequest.denied", "joinrequest", req.id)
        return None
    group = await db.get(FestioMeGroup, group_id)
    admitted = Identity(req.identity_ref, "", req.display_name, req.identity_kind)
    member = await _admit_member(db, group, admitted, role=role)
    req.status = "approved"
    _audit(db, group_id, actor, "joinrequest.approved", "member", member.id, request_id=req.id)
    return member


@app.patch("/v1/groups/{group_id}", response_model=GroupOut)
async def update_group(group_id: str, body: GroupUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    actor = await _member(db, group_id, identity)
    _require_role(actor, ADMIN_ROLES)
    group = await db.get(FestioMeGroup, group_id)
    if not group:
        raise HTTPException(404, "FestioMe group not found")
    _apply_group_update(group, body, actor)
    _audit(db, group_id, actor, "group.updated", "group", group_id)
    await db.commit(); await db.refresh(group)
    return await _group_out(db, group, actor)


@app.post("/v1/groups/{group_id}/leave", status_code=204)
async def leave_group(group_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    if member.role == "owner":
        raise HTTPException(409, "Transfer ownership before leaving")
    member.removed_at = datetime.utcnow()
    _audit(db, group_id, member, "member.left", "member", member.id)
    await db.commit()


# ── Sub-groups, discovery, and self-service joining ──────────────────────────
# The primary event group's roster is the confirmed guest list. Organizers can
# also open additional sub-groups (e.g. "Table 5", "VIP", "Bus A") that guests
# discover and join per each group's join_policy.

@app.post("/internal/v1/guesthub/event-links/{external_event_ref}/subgroups", response_model=GroupOut, status_code=201)
async def create_event_subgroup_internal(external_event_ref: str, body: SubGroupCreate, _: None = Depends(internal_service), db: AsyncSession = Depends(get_db)):
    """GuestHub-side organizer tooling creates a sub-group for an event. The new
    group is owned by the Festio service identity so organizers manage it through
    GuestHub rather than as a personal FestioMe login."""
    primary = await _event_group(db, external_event_ref)
    return await _create_subgroup(db, primary, body, creator_identity=None)


async def _service_actor(db: AsyncSession, group: FestioMeGroup) -> Member:
    """The Festio service member that acts inside `group` on GuestHub's behalf.
    Created (as admin) on first use so internal moderation has an audit actor."""
    actor = (await db.execute(select(Member).where(
        Member.group_id == group.id, Member.identity_kind == "service",
        Member.identity_ref == "guesthub"))).scalar_one_or_none()
    if not actor:
        actor = Member(group_id=group.id, identity_kind="service", identity_ref="guesthub",
                       display_name="Festio", role="admin")
        db.add(actor); await db.flush()
    return actor


async def _event_owned_group(db: AsyncSession, external_event_ref: str, group_id: str) -> FestioMeGroup:
    """Resolve a group and assert it belongs to the given event. Used by the
    internal organizer endpoints to keep one event from touching another's."""
    primary = await _event_group(db, external_event_ref)
    group = await db.get(FestioMeGroup, group_id)
    if not group or group.tenant_id != primary.tenant_id or group.external_event_ref != primary.external_event_ref:
        raise HTTPException(404, "FestioMe group not found")
    return group


@app.get("/internal/v1/guesthub/event-links/{external_event_ref}/subgroups", response_model=list[EventGroupAdminOut])
async def list_event_subgroups_internal(external_event_ref: str, _: None = Depends(internal_service), db: AsyncSession = Depends(get_db)):
    primary = await _event_group(db, external_event_ref)
    groups = (await db.execute(select(FestioMeGroup).where(
        FestioMeGroup.tenant_id == primary.tenant_id,
        FestioMeGroup.external_event_ref == primary.external_event_ref,
        FestioMeGroup.is_primary.is_(False),
    ).order_by(FestioMeGroup.created_at))).scalars().all()
    out: list[EventGroupAdminOut] = []
    for group in groups:
        member_count = (await db.execute(select(func.count(Member.id)).where(
            Member.group_id == group.id, Member.removed_at.is_(None)))).scalar_one()
        pending = (await db.execute(select(func.count(JoinRequest.id)).where(
            JoinRequest.group_id == group.id, JoinRequest.status == "pending"))).scalar_one()
        out.append(EventGroupAdminOut.model_validate(group).model_copy(update={
            "member_count": member_count, "pending_request_count": pending}))
    return out


@app.patch("/internal/v1/guesthub/event-links/{external_event_ref}/subgroups/{group_id}", response_model=EventGroupAdminOut)
async def update_event_subgroup_internal(external_event_ref: str, group_id: str, body: GroupUpdate, _: None = Depends(internal_service), db: AsyncSession = Depends(get_db)):
    group = await _event_owned_group(db, external_event_ref, group_id)
    if group.is_primary:
        raise HTTPException(400, "The primary event group cannot be reconfigured")
    actor = await _service_actor(db, group)
    _apply_group_update(group, body, actor)
    _audit(db, group.id, actor, "group.updated", "group", group.id)
    await db.commit(); await db.refresh(group)
    member_count = (await db.execute(select(func.count(Member.id)).where(
        Member.group_id == group.id, Member.removed_at.is_(None)))).scalar_one()
    pending = (await db.execute(select(func.count(JoinRequest.id)).where(
        JoinRequest.group_id == group.id, JoinRequest.status == "pending"))).scalar_one()
    return EventGroupAdminOut.model_validate(group).model_copy(update={
        "member_count": member_count, "pending_request_count": pending})


@app.get("/internal/v1/guesthub/event-links/{external_event_ref}/subgroups/{group_id}/join-requests", response_model=list[JoinRequestOut])
async def list_subgroup_join_requests_internal(external_event_ref: str, group_id: str, status: str = Query("pending"), _: None = Depends(internal_service), db: AsyncSession = Depends(get_db)):
    group = await _event_owned_group(db, external_event_ref, group_id)
    if status not in {"pending", "approved", "denied"}:
        raise HTTPException(422, "Invalid status filter")
    rows = (await db.execute(select(JoinRequest).where(
        JoinRequest.group_id == group.id, JoinRequest.status == status
    ).order_by(JoinRequest.created_at))).scalars().all()
    return [JoinRequestOut.model_validate(r) for r in rows]


@app.post("/internal/v1/guesthub/event-links/{external_event_ref}/subgroups/{group_id}/join-requests/{request_id}/approve", response_model=MemberOut)
async def approve_subgroup_join_internal(external_event_ref: str, group_id: str, request_id: str, body: JoinRequestDecision, _: None = Depends(internal_service), db: AsyncSession = Depends(get_db)):
    group = await _event_owned_group(db, external_event_ref, group_id)
    actor = await _service_actor(db, group)
    member = await _decide_join_request(db, group.id, request_id, actor, approve=True, role=body.role)
    await db.commit(); await db.refresh(member)
    return MemberOut.model_validate(member)


@app.post("/internal/v1/guesthub/event-links/{external_event_ref}/subgroups/{group_id}/join-requests/{request_id}/deny", status_code=204)
async def deny_subgroup_join_internal(external_event_ref: str, group_id: str, request_id: str, _: None = Depends(internal_service), db: AsyncSession = Depends(get_db)):
    group = await _event_owned_group(db, external_event_ref, group_id)
    actor = await _service_actor(db, group)
    await _decide_join_request(db, group.id, request_id, actor, approve=False)
    await db.commit()


@app.post("/v1/events/{external_event_ref}/subgroups", response_model=GroupOut, status_code=201)
async def create_event_subgroup(external_event_ref: str, body: SubGroupCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """An event owner/admin (member of the primary group) opens a new sub-group."""
    primary = await _event_group(db, external_event_ref)
    actor = await _member(db, primary.id, identity)
    _require_role(actor, ADMIN_ROLES)
    await _rate_limit(f"subgroup:{identity.subject}", 20, 3600)
    return await _create_subgroup(db, primary, body, creator_identity=identity)


async def _create_subgroup(db: AsyncSession, primary: FestioMeGroup, body: SubGroupCreate, *, creator_identity: Identity | None) -> GroupOut:
    group = FestioMeGroup(
        tenant_id=primary.tenant_id, external_event_ref=primary.external_event_ref,
        name=body.name.strip(), description=body.description.strip(),
        created_by_subject=creator_identity.subject if creator_identity else "guesthub",
        is_primary=False, join_policy=body.join_policy, visibility=body.visibility,
        rules=body.rules.strip(), rules_version=1 if body.rules.strip() else 0,
    )
    db.add(group); await db.flush()
    if creator_identity is not None:
        owner = Member(group_id=group.id, identity_kind=creator_identity.kind, identity_ref=creator_identity.subject,
                       display_name=creator_identity.name, role="owner", rules_accepted_version=group.rules_version)
    else:
        owner = Member(group_id=group.id, identity_kind="service", identity_ref="guesthub",
                       display_name="Festio", role="owner", rules_accepted_version=group.rules_version)
    db.add(owner); await db.flush()
    db.add(Channel(group_id=group.id, name="General", slug="general", kind="discussion", created_by_member_id=owner.id))
    _audit(db, group.id, owner, "group.subgroup_created", "group", group.id, name=group.name)
    await db.commit(); await db.refresh(group)
    return await _group_out(db, group, owner)


@app.get("/v1/events/{external_event_ref}/groups", response_model=list[GroupDirectoryOut])
async def list_event_groups(external_event_ref: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Directory of an event's groups for an eligible guest: the primary group,
    every listed sub-group, and any (even unlisted) sub-group they already
    belong to. Callers who are not members of the primary group get 404."""
    primary = await _event_group(db, external_event_ref)
    entitlement = await _event_membership(db, primary, identity)
    if not entitlement:
        raise HTTPException(404, "FestioMe is not enabled for this event")
    groups = (await db.execute(select(FestioMeGroup).where(
        FestioMeGroup.tenant_id == primary.tenant_id,
        FestioMeGroup.external_event_ref == primary.external_event_ref,
        FestioMeGroup.archived.is_(False),
    ).order_by(FestioMeGroup.is_primary.desc(), FestioMeGroup.created_at))).scalars().all()
    out: list[GroupDirectoryOut] = []
    for group in groups:
        my_member = await _active_member(db, group.id, identity)
        if not group.is_primary and group.visibility != "listed" and not my_member:
            continue
        member_count = (await db.execute(select(func.count(Member.id)).where(
            Member.group_id == group.id, Member.removed_at.is_(None)))).scalar_one()
        has_request = bool((await db.execute(select(JoinRequest.id).where(
            JoinRequest.group_id == group.id, JoinRequest.identity_kind == identity.kind,
            JoinRequest.identity_ref == identity.subject, JoinRequest.status == "pending"))).first())
        out.append(GroupDirectoryOut(
            id=group.id, name=group.name, description=group.description, is_primary=group.is_primary,
            join_policy=group.join_policy, visibility=group.visibility, member_count=member_count,
            is_member=my_member is not None, has_pending_request=has_request,
        ))
    return out


@app.post("/v1/groups/{group_id}/join", response_model=JoinGroupResult)
async def join_group(group_id: str, body: JoinGroupRequest, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    """Self-service entry to an event sub-group, subject to its join_policy."""
    await _rate_limit(f"join:{identity.subject}", 30, 3600)
    group = await db.get(FestioMeGroup, group_id)
    if not group or group.archived:
        raise HTTPException(404, "FestioMe group not found")
    # Only event sub-groups are self-joinable; the primary roster and standalone
    # groups are provisioned or invite-only.
    if group.is_primary or not group.external_event_ref:
        raise HTTPException(403, "This group is invite-only")
    if not await _event_membership(db, group, identity):
        raise HTTPException(404, "FestioMe group not found")
    existing = await _active_member(db, group.id, identity)
    if existing:
        return JoinGroupResult(status="already_member", group_id=group.id, member=_member_out(existing, identity))
    if group.join_policy == "closed":
        raise HTTPException(403, "This group is invite-only")
    if group.join_policy == "open":
        member = await _admit_member(db, group, identity)
        _audit(db, group.id, member, "member.joined", "member", member.id, via="open")
        await db.commit(); await db.refresh(member)
        return JoinGroupResult(status="joined", group_id=group.id, member=_member_out(member, identity))
    # request-to-join
    prior = (await db.execute(select(JoinRequest).where(
        JoinRequest.group_id == group.id, JoinRequest.identity_kind == identity.kind,
        JoinRequest.identity_ref == identity.subject, JoinRequest.status == "pending"))).scalar_one_or_none()
    if prior:
        return JoinGroupResult(status="already_requested", group_id=group.id)
    db.add(JoinRequest(group_id=group.id, identity_kind=identity.kind, identity_ref=identity.subject,
                       display_name=identity.name, message=body.message.strip()))
    await db.commit()
    return JoinGroupResult(status="requested", group_id=group.id)


async def _admit_member(db: AsyncSession, group: FestioMeGroup, identity: Identity, role: str = "member") -> Member:
    """Create or reactivate a membership for `identity` in `group`."""
    member = (await db.execute(select(Member).where(
        Member.group_id == group.id, Member.identity_kind == identity.kind,
        Member.identity_ref == identity.subject))).scalar_one_or_none()
    if member:
        member.removed_at = None
        member.joined_at = datetime.utcnow()
        member.display_name = identity.name
        member.role = role
    else:
        member = Member(group_id=group.id, identity_kind=identity.kind, identity_ref=identity.subject,
                        display_name=identity.name, role=role)
        db.add(member)
    await db.flush()
    return member


def _member_out(member: Member, identity: Identity) -> MemberOut:
    return MemberOut.model_validate(member).model_copy(update={
        "is_me": member.identity_kind == identity.kind and member.identity_ref == identity.subject})


@app.get("/v1/groups/{group_id}/join-requests", response_model=list[JoinRequestOut])
async def list_join_requests(group_id: str, status: str = Query("pending"), identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    actor = await _member(db, group_id, identity)
    _require_role(actor, STAFF_ROLES)
    if status not in {"pending", "approved", "denied"}:
        raise HTTPException(422, "Invalid status filter")
    rows = (await db.execute(select(JoinRequest).where(
        JoinRequest.group_id == group_id, JoinRequest.status == status
    ).order_by(JoinRequest.created_at))).scalars().all()
    return [JoinRequestOut.model_validate(r) for r in rows]


@app.post("/v1/groups/{group_id}/join-requests/{request_id}/approve", response_model=MemberOut)
async def approve_join_request(group_id: str, request_id: str, body: JoinRequestDecision, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    actor = await _member(db, group_id, identity)
    _require_role(actor, STAFF_ROLES)
    member = await _decide_join_request(db, group_id, request_id, actor, approve=True, role=body.role)
    await db.commit(); await db.refresh(member)
    return _member_out(member, identity)


@app.post("/v1/groups/{group_id}/join-requests/{request_id}/deny", status_code=204)
async def deny_join_request(group_id: str, request_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    actor = await _member(db, group_id, identity)
    _require_role(actor, STAFF_ROLES)
    await _decide_join_request(db, group_id, request_id, actor, approve=False)
    await db.commit()


@app.post("/v1/groups/{group_id}/accept-rules", response_model=RulesAcceptResult)
async def accept_group_rules(group_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    group = await db.get(FestioMeGroup, group_id)
    if not group or group.archived:
        raise HTTPException(404, "FestioMe group not found")
    member.rules_accepted_version = group.rules_version
    _audit(db, group_id, member, "rules.accepted", "group", group_id, version=group.rules_version)
    await db.commit()
    return RulesAcceptResult(group_id=group_id, rules_version=group.rules_version, rules_accepted=True)


@app.get("/v1/groups/{group_id}/channels", response_model=list[ChannelOut])
async def list_channels(group_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    query = select(Channel).where(Channel.group_id == group_id, Channel.archived.is_(False))
    if member.role not in STAFF_ROLES:
        query = query.where(Channel.kind != "staff")
    channels = (await db.execute(query.order_by(Channel.created_at))).scalars().all()
    result = []
    for channel in channels:
        state = (await db.execute(select(ChannelReadState).where(ChannelReadState.channel_id == channel.id, ChannelReadState.member_id == member.id))).scalar_one_or_none()
        message_query = select(func.count(Message.id)).where(Message.channel_id == channel.id, Message.deleted_at.is_(None), Message.author_member_id != member.id,
            or_(Message.published_at.is_not(None), Message.scheduled_for.is_(None)))
        if state:
            message_query = message_query.where(Message.created_at > state.read_at)
        count = (await db.execute(message_query)).scalar_one()
        result.append(ChannelOut.model_validate(channel).model_copy(update={"unread_count": count}))
    return result


@app.post("/v1/groups/{group_id}/channels", response_model=ChannelOut, status_code=201)
async def create_channel(group_id: str, body: ChannelCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    _require_role(member, ADMIN_ROLES)
    base = re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-")[:80] or "channel"
    slug = base
    suffix = 2
    while (await db.execute(select(Channel.id).where(Channel.group_id == group_id, Channel.slug == slug))).scalar_one_or_none():
        slug, suffix = f"{base[:75]}-{suffix}", suffix + 1
    channel = Channel(group_id=group_id, name=body.name.strip(), slug=slug, description=body.description.strip(), kind=body.kind, created_by_member_id=member.id)
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    return channel


@app.get("/v1/groups/{group_id}/members", response_model=list[MemberOut])
async def list_members(group_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    viewer = await _member(db, group_id, identity)
    members = (await db.execute(select(Member).where(Member.group_id == group_id, Member.removed_at.is_(None)).order_by(Member.joined_at))).scalars().all()
    return [MemberOut.model_validate(member).model_copy(update={"is_me": member.id == viewer.id}) for member in members]


@app.patch("/v1/groups/{group_id}/members/{member_id}", response_model=MemberOut)
async def update_member(group_id: str, member_id: str, body: MemberUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    actor = await _member(db, group_id, identity)
    _require_role(actor, ADMIN_ROLES)
    target = await db.get(Member, member_id)
    if not target or target.group_id != group_id or target.removed_at:
        raise HTTPException(404, "FestioMe member not found")
    if target.role == "owner" or (actor.role != "owner" and (target.role == "admin" or body.role == "admin")):
        raise HTTPException(403, "Only the owner can manage administrators")
    target.role = body.role
    _audit(db, group_id, actor, "member.role_changed", "member", target.id, role=body.role)
    await db.commit(); await db.refresh(target)
    return target


@app.post("/v1/groups/{group_id}/transfer-ownership", response_model=MemberOut)
async def transfer_ownership(group_id: str, body: OwnershipTransfer, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    actor = await _member(db, group_id, identity)
    if actor.role != "owner":
        raise HTTPException(403, "Only the owner can transfer ownership")
    target = await db.get(Member, body.member_id)
    if not target or target.group_id != group_id or target.removed_at:
        raise HTTPException(404, "FestioMe member not found")
    if target.id == actor.id:
        return target
    actor.role, target.role = "admin", "owner"
    _audit(db, group_id, actor, "group.ownership_transferred", "member", target.id)
    await db.commit(); await db.refresh(target)
    return target


@app.delete("/v1/groups/{group_id}/members/{member_id}", status_code=204)
async def remove_member(group_id: str, member_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    actor = await _member(db, group_id, identity)
    _require_role(actor, ADMIN_ROLES)
    target = await db.get(Member, member_id)
    if not target or target.group_id != group_id or target.removed_at:
        raise HTTPException(404, "FestioMe member not found")
    if target.role == "owner":
        raise HTTPException(409, "Transfer ownership before removing the owner")
    if actor.role == "admin" and target.role == "admin":
        raise HTTPException(403, "Only the owner can remove another administrator")
    target.removed_at = datetime.utcnow()
    _audit(db, group_id, actor, "member.removed", "member", target.id)
    await db.commit()


@app.get("/v1/groups/{group_id}/invitations", response_model=list[InvitationOut])
async def list_invitations(group_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    _require_role(member, ADMIN_ROLES)
    return (await db.execute(select(Invitation).where(Invitation.group_id == group_id).order_by(Invitation.created_at.desc()))).scalars().all()


@app.post("/v1/groups/{group_id}/invitations", response_model=InvitationOut, status_code=201)
async def create_invitation(group_id: str, body: InvitationCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    _require_role(member, ADMIN_ROLES)
    await _rate_limit(f"invite:{member.id}", 50, 3600)
    token = secrets.token_urlsafe(32)
    invite = Invitation(
        group_id=group_id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
        email=body.email.lower().strip() if body.email else None, role=body.role,
        created_by_member_id=member.id, expires_at=datetime.utcnow() + timedelta(hours=body.expires_in_hours),
        max_uses=body.max_uses,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    result = InvitationOut.model_validate(invite)
    return result.model_copy(update={"token": token})


@app.delete("/v1/groups/{group_id}/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(group_id: str, invitation_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    _require_role(member, ADMIN_ROLES)
    invite = await db.get(Invitation, invitation_id)
    if not invite or invite.group_id != group_id:
        raise HTTPException(404, "FestioMe invitation not found")
    invite.revoked_at = datetime.utcnow()
    await db.commit()


@app.post("/v1/invitations/{token}/accept", response_model=MemberOut)
async def accept_invitation(token: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    await _rate_limit(f"join:{identity.subject}", 20, 3600)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    invite = (await db.execute(select(Invitation).where(Invitation.token_hash == token_hash).with_for_update())).scalar_one_or_none()
    now = datetime.utcnow()
    if not invite or invite.revoked_at or invite.expires_at <= now or invite.use_count >= invite.max_uses:
        raise HTTPException(410, "FestioMe invitation is invalid or expired")
    if invite.email and invite.email != identity.email:
        raise HTTPException(403, "This FestioMe invitation is for another email address")
    member = (await db.execute(select(Member).where(
        Member.group_id == invite.group_id, Member.identity_kind == "user", Member.identity_ref == identity.subject,
    ))).scalar_one_or_none()
    if member and member.removed_at is None:
        return member
    if member:
        member.removed_at = None
        member.joined_at = now
        member.display_name = identity.name
        member.role = invite.role
    else:
        member = Member(group_id=invite.group_id, identity_kind="user", identity_ref=identity.subject, display_name=identity.name, role=invite.role)
        db.add(member)
    invite.use_count += 1
    await db.commit()
    await db.refresh(member)
    return member


@app.get("/v1/channels/{channel_id}/messages", response_model=MessagePage)
async def list_messages(
    channel_id: str, cursor: str | None = None, limit: int = Query(50, ge=1, le=100),
    identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db),
):
    channel, member = await _channel_access(db, channel_id, identity)
    query = select(Message).where(Message.channel_id == channel.id)
    if member.role not in STAFF_ROLES:
        query = query.where(or_(Message.scheduled_for.is_(None), Message.published_at.is_not(None)))
    decoded = _decode_cursor(cursor)
    if decoded:
        created_at, row_id = decoded
        query = query.where(or_(Message.created_at < created_at, and_(Message.created_at == created_at, Message.id < row_id)))
    rows = (await db.execute(query.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit + 1))).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return MessagePage(
        items=[await _message_out(db, row, member.id) for row in rows],
        next_cursor=_encode_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None,
    )


ALLOWED_UPLOAD_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "text/plain"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def _valid_upload_signature(mime: str, content: bytes) -> bool:
    if mime == "image/jpeg": return content.startswith(b"\xff\xd8\xff")
    if mime == "image/png": return content.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/gif": return content.startswith((b"GIF87a", b"GIF89a"))
    if mime == "image/webp": return content.startswith(b"RIFF") and content[8:12] == b"WEBP"
    if mime == "application/pdf": return content.startswith(b"%PDF-")
    if mime == "text/plain":
        try:
            content.decode("utf-8")
            return b"\x00" not in content
        except UnicodeDecodeError:
            return False
    return False


@app.post("/v1/channels/{channel_id}/attachments", status_code=201)
async def upload_attachment(channel_id: str, file: UploadFile = File(...), identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    _, member = await _channel_access(db, channel_id, identity)
    if member.role == "readonly": raise HTTPException(403, "This FestioMe member is read-only")
    await _rate_limit(f"upload:{member.id}", 20, 3600)
    mime = (file.content_type or "").lower()
    if mime not in ALLOWED_UPLOAD_TYPES: raise HTTPException(415, "Unsupported FestioMe attachment type")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content or len(content) > MAX_UPLOAD_BYTES: raise HTTPException(413, "FestioMe attachment exceeds 25 MB")
    if not _valid_upload_signature(mime, content): raise HTTPException(415, "FestioMe attachment content does not match its type")
    original = Path(file.filename or "attachment").name[:255]
    suffix = Path(original).suffix.lower()[:12]
    upload_id = secrets.token_hex(16); stored_name = f"{upload_id}{suffix}"
    root = Path(settings.upload_dir); await asyncio.to_thread(root.mkdir, parents=True, exist_ok=True)
    path = root / stored_name
    await asyncio.to_thread(path.write_bytes, content)
    pending = PendingUpload(id=upload_id, member_id=member.id, path=str(path), filename=original,
                            mime_type=mime, size_bytes=len(content), expires_at=datetime.utcnow() + timedelta(hours=24))
    db.add(pending); await db.commit()
    return {"url": f"/v1/attachments/{pending.id}", "filename": original, "mime_type": mime, "size_bytes": len(content)}


@app.get("/v1/attachments/{upload_id}")
async def download_attachment(upload_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    upload = await db.get(PendingUpload, upload_id)
    if not upload or (not upload.message_id and upload.expires_at <= datetime.utcnow()) or not os.path.isfile(upload.path):
        raise HTTPException(404, "FestioMe attachment not found")
    owner = await db.get(Member, upload.member_id)
    viewer = await _member(db, owner.group_id, identity)
    if not upload.message_id and viewer.id != upload.member_id: raise HTTPException(404, "FestioMe attachment not found")
    return FileResponse(upload.path, media_type=upload.mime_type, filename=upload.filename)


@app.post("/v1/channels/{channel_id}/messages", response_model=MessageOut, status_code=201)
async def create_message(channel_id: str, body: MessageCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    channel, member = await _channel_access(db, channel_id, identity)
    if member.role == "readonly":
        raise HTTPException(403, "This FestioMe member is read-only")
    if channel.kind == "announcement" and member.role not in STAFF_ROLES:
        raise HTTPException(403, "Only FestioMe staff can post announcements")
    group = await db.get(FestioMeGroup, channel.group_id)
    if not _rules_accepted(group, member):
        raise HTTPException(403, "You must accept the group rules before posting",
                            headers={"X-FestioMe-Rules-Version": str(group.rules_version)})
    if body.parent_id:
        parent = await db.get(Message, body.parent_id)
        if not parent or parent.channel_id != channel.id or parent.group_id != channel.group_id:
            raise HTTPException(400, "Reply target must belong to this FestioMe channel")
    await _rate_limit(f"message:{member.id}", 30)
    now = datetime.utcnow()
    scheduled = body.scheduled_for
    if scheduled and scheduled.tzinfo:
        scheduled = scheduled.replace(tzinfo=None)
    if scheduled and scheduled <= now:
        scheduled = None
    if scheduled and member.role not in STAFF_ROLES:
        raise HTTPException(403, "Only FestioMe staff can schedule messages")
    message = Message(group_id=channel.group_id, channel_id=channel.id, author_member_id=member.id,
                      parent_id=body.parent_id, body=body.body.strip(), scheduled_for=scheduled,
                      published_at=None if scheduled else now)
    db.add(message)
    await db.flush()
    allowed_hosts = {h.strip().lower() for h in settings.attachment_hosts.split(",") if h.strip()}
    for item in body.attachments:
        parsed = urlparse(item.url)
        if item.url.startswith("/v1/attachments/"):
            upload_id = item.url.rsplit("/", 1)[-1]
            pending = await db.get(PendingUpload, upload_id)
            if not pending or pending.member_id != member.id or pending.message_id or pending.expires_at <= now:
                raise HTTPException(400, "Attachment upload is invalid or expired")
            if (pending.filename, pending.mime_type, pending.size_bytes) != (item.filename, item.mime_type, item.size_bytes):
                raise HTTPException(400, "Attachment metadata does not match the uploaded file")
            pending.message_id = message.id
        elif parsed.scheme != "https" or not parsed.netloc or (allowed_hosts and parsed.hostname not in allowed_hosts):
            raise HTTPException(400, "Attachment URL is not from an approved HTTPS host")
        db.add(Attachment(message_id=message.id, **item.model_dump()))
    if body.mention_member_ids:
        members = (await db.execute(select(Member.id).where(Member.group_id == channel.group_id,
                  Member.id.in_(set(body.mention_member_ids)), Member.removed_at.is_(None)))).scalars().all()
        if len(set(members)) != len(set(body.mention_member_ids)):
            raise HTTPException(400, "Mentioned member does not belong to this FestioMe group")
        for member_id in set(members):
            db.add(Mention(message_id=message.id, member_id=member_id))
            if member_id != member.id:
                db.add(NotificationJob(member_id=member_id, message_id=message.id, kind="mention",
                                       available_at=scheduled or now))
    await db.commit()
    await db.refresh(message)
    result = await _message_out(db, message, member.id)
    if message.published_at:
        await _publish(channel.id, "message.created", result.model_dump(mode="json"))
    return result


@app.patch("/v1/messages/{message_id}", response_model=MessageOut)
async def edit_message(message_id: str, body: MessageUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    message = await db.get(Message, message_id)
    if not message or message.deleted_at:
        raise HTTPException(404, "FestioMe message not found")
    _, member = await _channel_access(db, message.channel_id, identity)
    if message.author_member_id != member.id and member.role not in STAFF_ROLES:
        raise HTTPException(403, "Cannot edit another member's message")
    message.body = body.body.strip(); message.edited_at = datetime.utcnow()
    _audit(db, message.group_id, member, "message.edited", "message", message.id)
    await db.commit(); await db.refresh(message)
    result = await _message_out(db, message, member.id)
    await _publish(message.channel_id, "message.updated", result.model_dump(mode="json"))
    return result


@app.delete("/v1/messages/{message_id}", status_code=204)
async def delete_message(message_id: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    message = await db.get(Message, message_id)
    if not message or message.deleted_at:
        raise HTTPException(404, "FestioMe message not found")
    _, member = await _channel_access(db, message.channel_id, identity)
    if message.author_member_id != member.id and member.role not in STAFF_ROLES:
        raise HTTPException(403, "Cannot delete another member's message")
    message.deleted_at = datetime.utcnow(); message.body = ""
    _audit(db, message.group_id, member, "message.deleted", "message", message.id)
    await db.commit()
    await _publish(message.channel_id, "message.deleted", {"id": message.id})


@app.post("/v1/messages/{message_id}/reactions", response_model=MessageOut)
async def add_reaction(message_id: str, body: ReactionCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    message = await db.get(Message, message_id)
    if not message or message.deleted_at:
        raise HTTPException(404, "FestioMe message not found")
    channel, member = await _channel_access(db, message.channel_id, identity)
    if message.group_id != channel.group_id:
        raise HTTPException(404, "FestioMe message not found")
    await _rate_limit(f"reaction:{member.id}", 120)
    emoji = body.emoji.strip()
    existing = (await db.execute(select(Reaction).where(Reaction.message_id == message.id, Reaction.member_id == member.id, Reaction.emoji == emoji))).scalar_one_or_none()
    if not existing:
        db.add(Reaction(message_id=message.id, member_id=member.id, emoji=emoji))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
    return await _message_out(db, message, member.id)


@app.delete("/v1/messages/{message_id}/reactions/{emoji}", status_code=204)
async def remove_reaction(message_id: str, emoji: str, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    message = await db.get(Message, message_id)
    if not message:
        raise HTTPException(404, "FestioMe message not found")
    _, member = await _channel_access(db, message.channel_id, identity)
    reaction = (await db.execute(select(Reaction).where(Reaction.message_id == message.id, Reaction.member_id == member.id, Reaction.emoji == emoji))).scalar_one_or_none()
    if reaction:
        await db.delete(reaction)
        await db.commit()


@app.put("/v1/channels/{channel_id}/read", response_model=ReadStateOut)
async def mark_read(channel_id: str, body: ReadStateUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    channel, member = await _channel_access(db, channel_id, identity)
    message = await db.get(Message, body.message_id)
    if not message or message.channel_id != channel.id:
        raise HTTPException(400, "Read marker must reference this FestioMe channel")
    state = (await db.execute(select(ChannelReadState).where(ChannelReadState.channel_id == channel.id, ChannelReadState.member_id == member.id))).scalar_one_or_none()
    if not state:
        state = ChannelReadState(channel_id=channel.id, member_id=member.id)
        db.add(state)
    state.last_read_message_id = message.id
    state.read_at = datetime.utcnow()
    await db.commit()
    await db.refresh(state)
    return ReadStateOut(channel_id=state.channel_id, last_read_message_id=state.last_read_message_id, read_at=state.read_at)


@app.post("/v1/messages/{message_id}/reports", response_model=ReportOut, status_code=201)
async def report_message(message_id: str, body: ReportCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    message = await db.get(Message, message_id)
    if not message:
        raise HTTPException(404, "FestioMe message not found")
    _, member = await _channel_access(db, message.channel_id, identity)
    await _rate_limit(f"report:{member.id}", 10, 3600)
    report = ModerationReport(group_id=message.group_id, message_id=message.id, reporter_member_id=member.id, reason=body.reason.strip(), details=body.details.strip())
    db.add(report)
    await db.flush()
    _audit(db, message.group_id, member, "moderation.reported", "report", report.id, message_id=message.id)
    await db.commit()
    await db.refresh(report)
    return report


@app.get("/v1/groups/{group_id}/reports", response_model=ReportPage)
async def list_reports(
    group_id: str, status: str | None = None, cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100), identity: Identity = Depends(current_identity),
    db: AsyncSession = Depends(get_db),
):
    member = await _member(db, group_id, identity)
    _require_role(member, STAFF_ROLES)
    query = select(ModerationReport).where(ModerationReport.group_id == group_id)
    if status:
        if status not in {"open", "reviewing", "resolved", "dismissed"}:
            raise HTTPException(400, "Invalid report status")
        query = query.where(ModerationReport.status == status)
    decoded = _decode_cursor(cursor)
    if decoded:
        created_at, row_id = decoded
        query = query.where(or_(ModerationReport.created_at < created_at, and_(ModerationReport.created_at == created_at, ModerationReport.id < row_id)))
    rows = (await db.execute(query.order_by(ModerationReport.created_at.desc(), ModerationReport.id.desc()).limit(limit + 1))).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return ReportPage(items=rows, next_cursor=_encode_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None)


@app.patch("/v1/groups/{group_id}/reports/{report_id}", response_model=ReportOut)
async def update_report(group_id: str, report_id: str, body: ReportUpdate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    _require_role(member, STAFF_ROLES)
    report = await db.get(ModerationReport, report_id)
    if not report or report.group_id != group_id:
        raise HTTPException(404, "FestioMe report not found")
    report.status = body.status
    report.resolution_note = body.resolution_note.strip()
    report.resolved_by_member_id = member.id
    report.resolved_at = datetime.utcnow() if body.status in {"resolved", "dismissed"} else None
    _audit(db, group_id, member, "moderation.status_changed", "report", report.id, status=body.status)
    await db.commit()
    await db.refresh(report)
    return report


@app.get("/v1/groups/{group_id}/search")
async def search_group(group_id: str, q: str = Query(min_length=2, max_length=200), limit: int = Query(30, ge=1, le=100),
                       identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    channels = select(Channel.id).where(Channel.group_id == group_id, Channel.archived.is_(False))
    if member.role not in STAFF_ROLES:
        channels = channels.where(Channel.kind != "staff")
    pattern = f"%{q.strip()}%"
    rows = (await db.execute(select(Message).where(
        Message.group_id == group_id, Message.channel_id.in_(channels), Message.deleted_at.is_(None),
        or_(Message.scheduled_for.is_(None), Message.published_at.is_not(None)), Message.body.ilike(pattern),
    ).order_by(Message.created_at.desc()).limit(limit))).scalars().all()
    return {"items": [await _message_out(db, row, member.id) for row in rows]}


@app.post("/v1/channels/{channel_id}/polls", status_code=201)
async def create_poll(channel_id: str, body: PollCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    channel, member = await _channel_access(db, channel_id, identity)
    if member.role == "readonly" or (channel.kind == "announcement" and member.role not in STAFF_ROLES):
        raise HTTPException(403, "Cannot create a poll in this channel")
    labels = [value.strip() for value in body.options]
    if any(not label for label in labels) or len(set(label.lower() for label in labels)) != len(labels):
        raise HTTPException(400, "Poll options must be non-empty and unique")
    now = datetime.utcnow(); scheduled = body.scheduled_for
    if scheduled and scheduled.tzinfo: scheduled = scheduled.replace(tzinfo=None)
    if scheduled and member.role not in STAFF_ROLES:
        raise HTTPException(403, "Only FestioMe staff can schedule polls")
    message = Message(group_id=channel.group_id, channel_id=channel.id, author_member_id=member.id,
                      body=body.question.strip(), scheduled_for=scheduled, published_at=None if scheduled else now)
    db.add(message); await db.flush()
    poll = Poll(message_id=message.id, question=body.question.strip(), multiple_choice=body.multiple_choice, closes_at=body.closes_at)
    db.add(poll); await db.flush()
    options = [PollOption(poll_id=poll.id, label=label, position=index) for index, label in enumerate(labels)]
    db.add_all(options); await db.commit()
    for option in options: await db.refresh(option)
    result = {"id": poll.id, "message_id": message.id, "question": poll.question, "multiple_choice": poll.multiple_choice,
              "closes_at": poll.closes_at, "options": [{"id": o.id, "label": o.label, "votes": 0, "voted_by_me": False} for o in options]}
    if message.published_at: await _publish(channel.id, "poll.created", result)
    return result


@app.post("/v1/polls/{poll_id}/votes")
async def vote_poll(poll_id: str, body: PollVoteCreate, identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    poll = await db.get(Poll, poll_id)
    if not poll or (poll.closes_at and poll.closes_at <= datetime.utcnow()):
        raise HTTPException(404, "FestioMe poll not found or closed")
    message = await db.get(Message, poll.message_id)
    _, member = await _channel_access(db, message.channel_id, identity)
    options = (await db.execute(select(PollOption).where(PollOption.poll_id == poll.id))).scalars().all()
    valid = {o.id for o in options}; requested = set(body.option_ids)
    if not requested.issubset(valid) or (not poll.multiple_choice and len(requested) != 1):
        raise HTTPException(400, "Invalid poll selection")
    await db.execute(delete(PollVote).where(PollVote.poll_id == poll.id, PollVote.member_id == member.id))
    db.add_all([PollVote(poll_id=poll.id, option_id=option_id, member_id=member.id) for option_id in requested])
    await db.commit()
    counts = dict((await db.execute(select(PollVote.option_id, func.count(PollVote.id)).where(PollVote.poll_id == poll.id).group_by(PollVote.option_id))).all())
    result = {"id": poll.id, "options": [{"id": o.id, "label": o.label, "votes": counts.get(o.id, 0), "voted_by_me": o.id in requested} for o in options]}
    await _publish(message.channel_id, "poll.voted", result)
    return result


@app.get("/v1/notification-preferences", response_model=NotificationPreferenceOut)
async def get_notification_preferences(group_id: str = Query(...), identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    pref = (await db.execute(select(NotificationPreference).where(NotificationPreference.member_id == member.id))).scalar_one_or_none()
    if not pref:
        pref = NotificationPreference(member_id=member.id); db.add(pref); await db.commit(); await db.refresh(pref)
    return NotificationPreferenceOut(member_id=member.id, in_app=pref.in_app, email=pref.email, digest=pref.digest,
                                     muted_channel_ids=pref.muted_channel_ids or [], updated_at=pref.updated_at)


@app.put("/v1/notification-preferences", response_model=NotificationPreferenceOut)
async def put_notification_preferences(body: NotificationPreferenceIn, group_id: str = Query(...), identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    member = await _member(db, group_id, identity)
    channel_ids = set((await db.execute(select(Channel.id).where(Channel.group_id == group_id))).scalars().all())
    if not set(body.muted_channel_ids).issubset(channel_ids): raise HTTPException(400, "Muted channel is outside this group")
    pref = (await db.execute(select(NotificationPreference).where(NotificationPreference.member_id == member.id))).scalar_one_or_none()
    if not pref: pref = NotificationPreference(member_id=member.id); db.add(pref)
    pref.in_app, pref.email, pref.digest = body.in_app, body.email, body.digest
    pref.muted_channel_ids, pref.updated_at = body.muted_channel_ids, datetime.utcnow()
    await db.commit(); await db.refresh(pref)
    return NotificationPreferenceOut(member_id=member.id, **body.model_dump(), updated_at=pref.updated_at)


@app.post("/v1/realtime-ticket", response_model=RealtimeTicketOut)
async def realtime_ticket(body: dict = Body(...), identity: Identity = Depends(current_identity), db: AsyncSession = Depends(get_db)):
    channel_id = str(body.get("channel_id") or "")
    channel, member = await _channel_access(db, channel_id, identity)
    expires = datetime.utcnow() + timedelta(seconds=60)
    secret = settings.realtime_ticket_secret or settings.internal_service_token
    if not secret: raise HTTPException(503, "FestioMe realtime is not configured")
    ticket = jwt.encode({"sub": identity.subject, "channel_id": channel.id, "member_id": member.id,
                         "exp": expires, "aud": "festiome-realtime", "iss": "festiome"}, secret, algorithm="HS256")
    return RealtimeTicketOut(ticket=ticket, expires_at=expires)


@app.get("/v1/channels/{channel_id}/events")
async def channel_events(channel_id: str, request: Request, ticket: str = Query(...), cursor: str | None = None):
    secret = settings.realtime_ticket_secret or settings.internal_service_token
    if not secret: raise HTTPException(503, "FestioMe realtime is not configured")
    try:
        claims = jwt.decode(ticket, secret, algorithms=["HS256"], audience="festiome-realtime", issuer="festiome")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired realtime ticket")
    if claims.get("channel_id") != channel_id: raise HTTPException(403, "Realtime ticket is for another channel")
    recovered_cursor = _decode_cursor(cursor)
    async def stream():
        # Recover persisted messages missed since the caller's last cursor.
        if recovered_cursor:
            decoded = recovered_cursor
            if decoded:
                async with SessionLocal() as db:
                    when, row_id = decoded
                    rows = (await db.execute(select(Message).where(Message.channel_id == channel_id,
                        or_(Message.created_at > when, and_(Message.created_at == when, Message.id > row_id)),
                        Message.published_at.is_not(None), Message.deleted_at.is_(None)).order_by(Message.created_at, Message.id).limit(500))).scalars().all()
                    for row in rows:
                        data = await _message_out(db, row, claims["member_id"])
                        event_id = _encode_cursor(row.created_at, row.id)
                        yield f"id: {event_id}\nevent: message.created\ndata: {data.model_dump_json()}\n\n"
        pubsub = redis.pubsub(); await pubsub.subscribe(f"festiome:channel:{channel_id}")
        try:
            yield "event: ready\ndata: {}\n\n"
            while not await request.is_disconnected():
                item = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15)
                if item:
                    payload = json.loads(item["data"])
                    yield f"event: {payload['event']}\ndata: {json.dumps(payload['data'])}\n\n"
                else: yield ": keepalive\n\n"
        finally:
            await pubsub.unsubscribe(f"festiome:channel:{channel_id}"); await pubsub.aclose()
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
