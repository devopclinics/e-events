"""FestioMe authorization — resolves the acting identity (a Festio user OR an
event guest via pass token) and gates every action on group membership. Group
roles are independent of event/org roles. Guest-token resolution is delegated to
``integration`` so this module never imports event models directly.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import verify_token_user
from . import integration
from .models import FestiomeMember, FestiomeMessage


@dataclass
class Identity:
    kind: str          # "user" | "guest"
    key: str           # user_id or guest_id
    name: str
    event_id: Optional[str] = None   # set for guests → their event's group


async def resolve_identity(request: Request, db: AsyncSession) -> Identity:
    """Firebase bearer token → user; else X-Guest-Token / ?guest_token → event guest."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        user = await verify_token_user(auth[7:].strip(), db)
        if user:
            return Identity("user", user.id, user.name or user.email or "Member")
    gt = request.headers.get("X-Guest-Token") or request.query_params.get("guest_token")
    if gt:
        g = await integration.resolve_guest_token(gt.strip(), db)
        if g:
            return Identity("guest", g["guest_id"], g["name"], g["event_id"])
    raise HTTPException(401, "Sign in or open the group from your event pass to continue.")


def _identity_where(identity: Identity):
    return (FestiomeMember.user_id == identity.key) if identity.kind == "user" \
        else (FestiomeMember.guest_ref == identity.key)


async def member_for(group_id: str, identity: Identity, db: AsyncSession) -> Optional[FestiomeMember]:
    return (await db.execute(
        select(FestiomeMember).where(
            FestiomeMember.group_id == group_id,
            _identity_where(identity),
            FestiomeMember.removed_at.is_(None),
        ))).scalar_one_or_none()


async def require_member(group_id: str, identity: Identity, db: AsyncSession) -> FestiomeMember:
    m = await member_for(group_id, identity, db)
    if not m:
        raise HTTPException(403, "You're not a member of this group.")
    return m


def require_admin(member: FestiomeMember) -> None:
    if member.role not in ("owner", "admin"):
        raise HTTPException(403, "Only group admins can do that.")


async def message_in_group(message_id: str, group_id: str, db: AsyncSession) -> FestiomeMessage:
    msg = await db.get(FestiomeMessage, message_id)
    if not msg or msg.group_id != group_id:
        raise HTTPException(404, "Message not found.")
    return msg


async def member_count(group_id: str, db: AsyncSession) -> int:
    return (await db.scalar(
        select(func.count()).select_from(FestiomeMember)
        .where(FestiomeMember.group_id == group_id, FestiomeMember.removed_at.is_(None)))) or 0
