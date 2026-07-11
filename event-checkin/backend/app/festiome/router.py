"""FestioMe HTTP API — mounted at /api/festiome. Membership gates everything;
identity is a Festio user (Firebase) or an event guest (pass token)."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..routers import sse_subscribers
from ..ratelimit import _hit
from . import authz, service, integration, tickets
from .authz import Identity
from .models import FestiomeGroup, FestiomeMember, FestiomeMessage, FestiomeInvite
from .schemas import (
    GroupCreate, GroupOut, MemberOut, MessageOut, MessageCreate, InviteOut, ReportIn,
)

router = APIRouter()


async def identity(request: Request, db: AsyncSession = Depends(get_db)) -> Identity:
    return await authz.resolve_identity(request, db)


async def _group_and_member(group_id: str, ident: Identity, db: AsyncSession) -> tuple[FestiomeGroup, FestiomeMember]:
    group = await db.get(FestiomeGroup, group_id)
    if not group:
        raise HTTPException(404, "Group not found.")
    member = await authz.member_for(group_id, ident, db)
    if member is None and ident.kind == "guest" and group.event_id and group.event_id == ident.event_id:
        # A guest opening their own event's group auto-joins.
        _, member = await integration.ensure_guest_member(ident.event_id, ident.key, ident.name, db)
    if member is None:
        raise HTTPException(403, "You're not a member of this group.")
    return group, member


# ── Groups ──────────────────────────────────────────────────────────────────

@router.get("/groups", response_model=list[GroupOut])
async def my_groups(ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    if ident.kind == "guest":
        grp, member = await integration.ensure_guest_member(ident.event_id, ident.key, ident.name, db)
        return [await service.group_out(grp, member, db)] if grp and member else []
    rows = (await db.execute(
        select(FestiomeGroup, FestiomeMember)
        .join(FestiomeMember, FestiomeMember.group_id == FestiomeGroup.id)
        .where(FestiomeMember.user_id == ident.key, FestiomeMember.removed_at.is_(None),
               FestiomeGroup.is_archived.is_(False))
        .order_by(desc(FestiomeGroup.created_at)))).all()
    return [await service.group_out(g, m, db) for g, m in rows]


@router.post("/groups", response_model=GroupOut, status_code=201)
async def create_group(body: GroupCreate, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    if ident.kind != "user":
        raise HTTPException(403, "Sign in with a Festio account to create a group.")
    # Event-linked groups may only be created by an admin of that event.
    if body.event_id and not await integration.user_is_event_admin(ident.key, body.event_id, db):
        raise HTTPException(403, "You must be an admin of that event to create its group.")
    group = FestiomeGroup(name=body.name.strip(), event_id=body.event_id,
                          announce_only=body.announce_only, created_by=ident.key)
    db.add(group)
    await db.flush()
    owner = FestiomeMember(group_id=group.id, user_id=ident.key, display_name=ident.name, role="owner")
    db.add(owner)
    await db.commit()
    await db.refresh(group)
    return await service.group_out(group, owner, db)


@router.get("/groups/{group_id}", response_model=GroupOut)
async def get_group(group_id: str, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    group, member = await _group_and_member(group_id, ident, db)
    return await service.group_out(group, member, db)


@router.get("/groups/{group_id}/members", response_model=list[MemberOut])
async def list_members(group_id: str, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    _, me = await _group_and_member(group_id, ident, db)
    members = (await db.execute(select(FestiomeMember).where(
        FestiomeMember.group_id == group_id, FestiomeMember.removed_at.is_(None))
        .order_by(FestiomeMember.joined_at))).scalars().all()
    return [MemberOut(id=m.id, display_name=m.display_name, nickname=m.nickname,
                      avatar_url=m.avatar_url, role=m.role, is_me=(m.id == me.id)) for m in members]


@router.post("/groups/{group_id}/read")
async def mark_read(group_id: str, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    _, me = await _group_and_member(group_id, ident, db)
    me.last_read_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.delete("/groups/{group_id}/leave")
async def leave_group(group_id: str, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    _, me = await _group_and_member(group_id, ident, db)
    if me.role == "owner":
        # Owner can't orphan the group — hand ownership to an admin, else the
        # oldest remaining member. If they're the only one, block leaving.
        others = (await db.execute(select(FestiomeMember).where(
            FestiomeMember.group_id == group_id, FestiomeMember.id != me.id,
            FestiomeMember.removed_at.is_(None)).order_by(FestiomeMember.joined_at))).scalars().all()
        if not others:
            raise HTTPException(400, "You're the only member — archive the group instead of leaving.")
        successor = next((m for m in others if m.role == "admin"), others[0])
        successor.role = "owner"
    me.removed_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.post("/groups/{group_id}/members/{member_id}/restore")
async def restore_member(group_id: str, member_id: str,
                         ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    _, me = await _group_and_member(group_id, ident, db)
    authz.require_admin(me)
    target = await db.get(FestiomeMember, member_id)
    if not target or target.group_id != group_id:
        raise HTTPException(404, "Member not found.")
    await integration.restore_member(target, db)
    await service.log_moderation(group_id, me, "restore_member", member_id, None, db)
    return {"ok": True}


# ── Messages ────────────────────────────────────────────────────────────────

@router.get("/groups/{group_id}/messages", response_model=list[MessageOut])
async def list_messages(group_id: str, before: str | None = Query(None),
                        limit: int = Query(40, le=100),
                        ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    _, me = await _group_and_member(group_id, ident, db)
    q = select(FestiomeMessage).where(FestiomeMessage.group_id == group_id)
    if before:
        try:
            q = q.where(FestiomeMessage.created_at < datetime.fromisoformat(before))
        except ValueError:
            pass
    msgs = (await db.execute(q.order_by(desc(FestiomeMessage.created_at)).limit(limit))).scalars().all()
    return await service.serialize_messages(list(reversed(msgs)), me, db)


@router.post("/groups/{group_id}/messages", response_model=MessageOut, status_code=201)
async def send_message(group_id: str, body: MessageCreate,
                       ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    group, me = await _group_and_member(group_id, ident, db)
    if group.announce_only and me.role not in ("owner", "admin"):
        raise HTTPException(403, "Only admins can post in this announcement group.")
    # Rate limit: 20 messages / 10s per member.
    if not await _hit(f"festiome:msg:{me.id}", limit=20, window=10):
        raise HTTPException(429, "You're sending messages too quickly — wait a moment.")
    if not (body.body or "").strip():
        raise HTTPException(400, "Message is empty.")
    if body.parent_id:
        parent = await authz.message_in_group(body.parent_id, group_id, db)  # 404 if not same group
        if parent.deleted_at:
            raise HTTPException(400, "You can't reply to a deleted message.")
    # Client-supplied attachment URLs are ignored — media may only be added via
    # the controlled upload flow (validates ownership, MIME, and size).
    return await service.post_message(group, me, body=body.body, parent_id=body.parent_id,
                                      attachments=[], db=db)


@router.post("/messages/{message_id}/like")
async def like_message(message_id: str, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    msg = await db.get(FestiomeMessage, message_id)
    if not msg:
        raise HTTPException(404, "Message not found.")
    _, me = await _group_and_member(msg.group_id, ident, db)
    return {"like_count": await service.set_like(msg, me, True, db)}


@router.delete("/messages/{message_id}/like")
async def unlike_message(message_id: str, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    msg = await db.get(FestiomeMessage, message_id)
    if not msg:
        raise HTTPException(404, "Message not found.")
    _, me = await _group_and_member(msg.group_id, ident, db)
    return {"like_count": await service.set_like(msg, me, False, db)}


@router.delete("/messages/{message_id}")
async def delete_message(message_id: str, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    msg = await db.get(FestiomeMessage, message_id)
    if not msg:
        raise HTTPException(404, "Message not found.")
    _, me = await _group_and_member(msg.group_id, ident, db)
    if msg.sender_member_id != me.id and me.role not in ("owner", "admin"):
        raise HTTPException(403, "You can only delete your own messages.")
    msg.deleted_at = datetime.utcnow()
    msg.body = ""
    await db.commit()
    if msg.sender_member_id != me.id:
        await service.log_moderation(msg.group_id, me, "delete_message", message_id, None, db)
    await service.fan_out(msg.group_id, {"type": "message.deleted", "message_id": message_id})
    return {"ok": True}


@router.post("/messages/{message_id}/report")
async def report_message(message_id: str, body: ReportIn,
                         ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    msg = await db.get(FestiomeMessage, message_id)
    if not msg:
        raise HTTPException(404, "Message not found.")
    _, me = await _group_and_member(msg.group_id, ident, db)
    await service.log_moderation(msg.group_id, me, "report", message_id, body.reason, db)
    return {"ok": True}


# ── Members admin ───────────────────────────────────────────────────────────

@router.delete("/groups/{group_id}/members/{member_id}")
async def remove_member(group_id: str, member_id: str,
                        ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    _, me = await _group_and_member(group_id, ident, db)
    authz.require_admin(me)
    target = await db.get(FestiomeMember, member_id)
    if not target or target.group_id != group_id:
        raise HTTPException(404, "Member not found.")
    if target.role == "owner":
        raise HTTPException(400, "Can't remove the group owner.")
    target.removed_at = datetime.utcnow()
    await db.commit()
    await service.log_moderation(group_id, me, "remove_member", member_id, None, db)
    return {"ok": True}


# ── Invites ─────────────────────────────────────────────────────────────────

@router.post("/groups/{group_id}/invites", response_model=InviteOut)
async def create_invite(group_id: str, request: Request,
                        ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    _, me = await _group_and_member(group_id, ident, db)
    authz.require_admin(me)
    if not await _hit(f"festiome:inv:{me.id}", limit=20, window=3600):
        raise HTTPException(429, "Too many invite links created — try again later.")
    inv = FestiomeInvite(group_id=group_id, created_by=me.id, role="member")
    db.add(inv)
    await db.commit()
    base = str(request.base_url).rstrip("/")
    return InviteOut(token=inv.token, role=inv.role, expires_at=inv.expires_at,
                     join_url=f"{base}/me/join/{inv.token}")


@router.post("/invites/{token}/join", response_model=GroupOut)
async def join_via_invite(token: str, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    if ident.kind != "user":
        raise HTTPException(403, "Sign in with a Festio account to join.")
    inv = (await db.execute(select(FestiomeInvite).where(FestiomeInvite.token == token))).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Invalid invite link.")
    if inv.expires_at and inv.expires_at < datetime.utcnow():
        raise HTTPException(410, "This invite link has expired.")
    if inv.max_uses is not None and inv.uses >= inv.max_uses:
        raise HTTPException(410, "This invite link has been used up.")
    group = await db.get(FestiomeGroup, inv.group_id)
    if not group:
        raise HTTPException(404, "Group not found.")
    member = await authz.member_for(group.id, ident, db)
    if member is None:
        member = FestiomeMember(group_id=group.id, user_id=ident.key, display_name=ident.name, role=inv.role)
        db.add(member)
        inv.uses += 1
        await db.commit()
        await db.refresh(member)
        await service.add_system_message(group.id, f"{ident.name} joined the group", member, db)
    return await service.group_out(group, member, db)


# ── Real-time stream ────────────────────────────────────────────────────────

@router.post("/groups/{group_id}/stream-ticket")
async def stream_ticket(group_id: str, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    """Mint a short-lived, single-use ticket for the SSE stream (authenticated),
    so no Firebase/guest credential ever appears in an EventSource URL."""
    _, me = await _group_and_member(group_id, ident, db)
    tok = await tickets.issue({"group_id": group_id, "member_id": me.id})
    return {"ticket": tok}


@router.get("/groups/{group_id}/stream")
async def stream(group_id: str, ticket: str = Query(...), db: AsyncSession = Depends(get_db)):
    # Identity is proven by the single-use ticket minted above — never a raw
    # credential in the URL.
    payload = await tickets.consume(ticket)
    if not payload or payload.get("group_id") != group_id:
        raise HTTPException(401, "Invalid or expired stream ticket.")
    member = await db.get(FestiomeMember, payload.get("member_id"))
    if not member or member.group_id != group_id or member.removed_at is not None:
        raise HTTPException(403, "You're not a member of this group.")

    key = service.channel(group_id)
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    sse_subscribers.setdefault(key, []).append(queue)

    async def gen():
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {json.dumps(data)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            subs = sse_subscribers.get(key, [])
            if queue in subs:
                subs.remove(queue)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Event integration status (admin surface) ────────────────────────────────

@router.get("/events/{event_id}/status")
async def event_status(event_id: str, ident: Identity = Depends(identity), db: AsyncSession = Depends(get_db)):
    if ident.kind != "user" or not await integration.user_is_event_admin(ident.key, event_id, db):
        raise HTTPException(403, "You must be an admin of this event.")
    return await integration.event_group_status(event_id, db)
