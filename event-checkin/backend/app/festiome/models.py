"""FestioMe ORM models. All tables are prefixed ``festiome_`` and share the
platform's declarative Base so they auto-migrate with everything else. Links to
events/guests are OPAQUE STRING references (event_id, guest_ref) — never cross
foreign keys — so the module stays extractable and the boundary stays honest.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, JSON,
    UniqueConstraint, Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


def _uid() -> str:
    return str(uuid.uuid4())


class FestiomeGroup(Base):
    __tablename__ = "festiome_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    # Opaque external references — NOT foreign keys (boundary rule).
    event_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(140))
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Who created it: a Festio user id, or "" for system/integration-created.
    created_by: Mapped[str] = mapped_column(String(64), default="")
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    # announcement-only groups: only admins may post.
    announce_only: Mapped[bool] = mapped_column(Boolean, default=False)
    settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    members: Mapped[list["FestiomeMember"]] = relationship(back_populates="group", cascade="all, delete-orphan")


class FestiomeMember(Base):
    __tablename__ = "festiome_members"
    __table_args__ = (
        # A person (either a Festio user OR an event guest) is a member at most once.
        UniqueConstraint("group_id", "user_id", name="uq_festiome_member_user"),
        UniqueConstraint("group_id", "guest_ref", name="uq_festiome_member_guest"),
        # Exactly one identity must be set — never both, never neither.
        CheckConstraint("(user_id IS NULL) <> (guest_ref IS NULL)",
                        name="ck_festiome_member_one_identity"),
        Index("ix_festiome_member_group", "group_id", "removed_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_groups.id"), index=True)
    # Exactly one identity is set. user_id = Festio account; guest_ref = event guest id.
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    guest_ref: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    display_name: Mapped[str] = mapped_column(String(140), default="")
    nickname: Mapped[str | None] = mapped_column(String(140), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="member")  # owner | admin | member
    is_muted: Mapped[bool] = mapped_column(Boolean, default=False)   # member silenced this group
    notify_pref: Mapped[str] = mapped_column(String(20), default="all")  # all | mentions | none
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    group: Mapped[FestiomeGroup] = relationship(back_populates="members")


class FestiomeMessage(Base):
    __tablename__ = "festiome_messages"
    __table_args__ = (Index("ix_festiome_msg_group_time", "group_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_groups.id"), index=True)
    sender_member_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_members.id"), index=True)
    body: Mapped[str] = mapped_column(Text, default="")
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("festiome_messages.id"), nullable=True)
    system: Mapped[bool] = mapped_column(Boolean, default=False)  # "X joined", "renamed to…"
    edited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class FestiomeAttachment(Base):
    __tablename__ = "festiome_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_messages.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="image")  # image | file
    url: Mapped[str] = mapped_column(Text)
    mime: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class FestiomeLike(Base):
    __tablename__ = "festiome_likes"
    __table_args__ = (UniqueConstraint("message_id", "member_id", name="uq_festiome_like"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_messages.id"), index=True)
    member_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_members.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FestiomeInvite(Base):
    __tablename__ = "festiome_invites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_groups.id"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, default=_uid)
    role: Mapped[str] = mapped_column(String(20), default="member")
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FestiomeModerationLog(Base):
    """Immutable audit of moderation/admin actions (report, remove, delete…)."""
    __tablename__ = "festiome_moderation_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    group_id: Mapped[str] = mapped_column(String(36), index=True)
    actor_member_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(40))  # report | remove_member | delete_message | mute | block
    target: Mapped[str | None] = mapped_column(String(64), nullable=True)  # message_id / member_id
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
