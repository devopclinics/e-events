"""FestioMe core operations + real-time fan-out. Reuses the platform's SSE
broadcast (Redis-backed, multi-replica safe) keyed per group."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..routers import broadcast
from .models import (
    FestiomeGroup, FestiomeMember, FestiomeMessage, FestiomeAttachment,
    FestiomeLike, FestiomeModerationLog,
)
from .schemas import MessageOut, AttachmentOut, GroupOut


def channel(group_id: str) -> str:
    """SSE channel key for a group (namespaced so it never collides with event streams)."""
    return f"festiome:{group_id}"


async def fan_out(group_id: str, data: dict) -> None:
    data = {**data, "group_id": group_id}
    await broadcast(channel(group_id), data)


def _member_label(m: FestiomeMember) -> str:
    return m.nickname or m.display_name or "Member"


async def serialize_messages(msgs: list[FestiomeMessage], me: FestiomeMember, db: AsyncSession) -> list[MessageOut]:
    if not msgs:
        return []
    ids = [m.id for m in msgs]
    member_ids = {m.sender_member_id for m in msgs}
    members = {mm.id: mm for mm in (await db.execute(
        select(FestiomeMember).where(FestiomeMember.id.in_(member_ids)))).scalars().all()}
    # like counts + which ones I liked
    like_rows = (await db.execute(
        select(FestiomeLike.message_id, FestiomeLike.member_id).where(FestiomeLike.message_id.in_(ids)))).all()
    counts: dict[str, int] = {}
    mine: set[str] = set()
    for mid, memb in like_rows:
        counts[mid] = counts.get(mid, 0) + 1
        if memb == me.id:
            mine.add(mid)
    atts: dict[str, list] = {}
    for a in (await db.execute(
        select(FestiomeAttachment).where(FestiomeAttachment.message_id.in_(ids)))).scalars().all():
        atts.setdefault(a.message_id, []).append(AttachmentOut.model_validate(a))
    out = []
    for m in msgs:
        sender = members.get(m.sender_member_id)
        out.append(MessageOut(
            id=m.id, body="" if m.deleted_at else m.body,
            sender_member_id=m.sender_member_id,
            sender_name=_member_label(sender) if sender else "Member",
            parent_id=m.parent_id, system=m.system,
            edited=bool(m.edited_at), deleted=bool(m.deleted_at),
            like_count=counts.get(m.id, 0), liked_by_me=m.id in mine,
            attachments=atts.get(m.id, []), created_at=m.created_at,
        ))
    return out


async def post_message(group: FestiomeGroup, me: FestiomeMember, *, body: str,
                       parent_id: str | None, attachments: list[dict], db: AsyncSession) -> MessageOut:
    msg = FestiomeMessage(group_id=group.id, sender_member_id=me.id,
                          body=(body or "").strip(), parent_id=parent_id)
    db.add(msg)
    await db.flush()
    for a in (attachments or [])[:10]:
        db.add(FestiomeAttachment(message_id=msg.id, kind=a.get("kind", "image"),
                                  url=a.get("url", ""), mime=a.get("mime"), size=a.get("size")))
    me.last_read_at = datetime.utcnow()
    await db.commit()
    await db.refresh(msg)
    [out] = await serialize_messages([msg], me, db)
    await fan_out(group.id, {"type": "message.created", "message": out.model_dump(mode="json")})
    return out


async def add_system_message(group_id: str, text: str, actor: FestiomeMember, db: AsyncSession) -> None:
    msg = FestiomeMessage(group_id=group_id, sender_member_id=actor.id, body=text, system=True)
    db.add(msg)
    await db.commit()
    await fan_out(group_id, {"type": "message.created", "message": {
        "id": msg.id, "body": text, "system": True, "sender_member_id": actor.id,
        "sender_name": _member_label(actor), "like_count": 0, "liked_by_me": False,
        "attachments": [], "edited": False, "deleted": False,
        "created_at": msg.created_at.isoformat(),
    }})


async def set_like(message: FestiomeMessage, me: FestiomeMember, liked: bool, db: AsyncSession) -> int:
    existing = (await db.execute(select(FestiomeLike).where(
        FestiomeLike.message_id == message.id, FestiomeLike.member_id == me.id))).scalar_one_or_none()
    if liked and not existing:
        db.add(FestiomeLike(message_id=message.id, member_id=me.id))
    elif not liked and existing:
        await db.execute(delete(FestiomeLike).where(FestiomeLike.id == existing.id))
    await db.commit()
    count = (await db.scalar(select(func.count()).select_from(FestiomeLike)
                             .where(FestiomeLike.message_id == message.id))) or 0
    await fan_out(message.group_id, {"type": "message.liked", "message_id": message.id, "like_count": count})
    return count


async def unread_count(member: FestiomeMember, db: AsyncSession) -> int:
    q = select(func.count()).select_from(FestiomeMessage).where(
        FestiomeMessage.group_id == member.group_id,
        FestiomeMessage.deleted_at.is_(None),
        FestiomeMessage.sender_member_id != member.id)
    if member.last_read_at:
        q = q.where(FestiomeMessage.created_at > member.last_read_at)
    return (await db.scalar(q)) or 0


async def group_out(group: FestiomeGroup, me: FestiomeMember, db: AsyncSession) -> GroupOut:
    mc = (await db.scalar(select(func.count()).select_from(FestiomeMember)
                          .where(FestiomeMember.group_id == group.id, FestiomeMember.removed_at.is_(None)))) or 0
    return GroupOut(id=group.id, name=group.name, event_id=group.event_id,
                    avatar_url=group.avatar_url, announce_only=group.announce_only,
                    is_archived=group.is_archived, member_count=mc,
                    unread=await unread_count(me, db), my_role=me.role)


async def log_moderation(group_id: str, actor: FestiomeMember | None, action: str,
                         target: str | None, reason: str | None, db: AsyncSession) -> None:
    db.add(FestiomeModerationLog(group_id=group_id, actor_member_id=actor.id if actor else None,
                                 action=action, target=target, reason=reason))
    await db.commit()
