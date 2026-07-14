import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, JSON,
    Text, UniqueConstraint, text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def uid() -> str:
    return str(uuid.uuid4())


class Tenant(Base):
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    external_org_ref: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FestioMeGroup(Base):
    __tablename__ = "festiome_groups"
    __table_args__ = (
        CheckConstraint("visibility IN ('listed','unlisted')", name="ck_group_visibility"),
        CheckConstraint("join_policy IN ('closed','request','open')", name="ck_group_join_policy"),
        # At most one primary group per event. Sub-groups (is_primary = false)
        # share the same external_event_ref and are unconstrained in number.
        Index(
            "uq_group_primary_event", "tenant_id", "external_event_ref", unique=True,
            sqlite_where=text("is_primary"), postgresql_where=text("is_primary"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    external_event_ref: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    created_by_subject: Mapped[str] = mapped_column(String(128), index=True)
    # The event's canonical group (guest sync, announcements, guest tokens target
    # this one). Additional opt-in sub-groups for the same event set this False.
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # How an eligible event guest gets in: closed (invite/provision only),
    # request (moderator approves), or open (self-serve). Primary groups stay
    # closed — their roster is the event's confirmed guest list.
    join_policy: Mapped[str] = mapped_column(String(20), default="closed", server_default="closed")
    # Whether the group appears in the event's group directory to non-members.
    visibility: Mapped[str] = mapped_column(String(20), default="listed", server_default="listed")
    # Optional code-of-conduct members must accept before posting. Bumping the
    # text advances rules_version so everyone must re-accept.
    rules: Mapped[str] = mapped_column(Text, default="", server_default="")
    rules_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class Member(Base):
    __tablename__ = "members"
    __table_args__ = (
        UniqueConstraint("group_id", "identity_kind", "identity_ref", name="uq_member_identity"),
        CheckConstraint("identity_kind IN ('user','guest','service')", name="ck_member_identity_kind"),
        CheckConstraint("role IN ('owner','admin','moderator','member','readonly')", name="ck_member_role"),
        Index("ix_members_group_active", "group_id", "removed_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_groups.id"), index=True)
    identity_kind: Mapped[str] = mapped_column(String(20))
    identity_ref: Mapped[str] = mapped_column(String(128))
    display_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="member")
    # Highest group.rules_version this member has accepted (0 = none accepted).
    rules_accepted_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class JoinRequest(Base):
    __tablename__ = "join_requests"
    __table_args__ = (
        CheckConstraint("identity_kind IN ('user','guest')", name="ck_joinreq_identity_kind"),
        CheckConstraint("status IN ('pending','approved','denied')", name="ck_joinreq_status"),
        # One outstanding request per identity per group. Decided requests are
        # kept for history but no longer collide with a fresh pending one.
        Index(
            "uq_joinreq_pending", "group_id", "identity_kind", "identity_ref", unique=True,
            sqlite_where=text("status = 'pending'"), postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_joinreq_group_status", "group_id", "status", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_groups.id"), index=True)
    identity_kind: Mapped[str] = mapped_column(String(20))
    identity_ref: Mapped[str] = mapped_column(String(128))
    display_name: Mapped[str] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pending")
    decided_by_member_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("members.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Channel(Base):
    __tablename__ = "channels"
    __table_args__ = (
        UniqueConstraint("group_id", "slug", name="uq_channel_slug"),
        CheckConstraint("kind IN ('discussion','announcement','staff')", name="ck_channel_kind"),
        # One DM channel per member pair per group.
        Index(
            "uq_channel_dm_pair", "group_id", "dm_key", unique=True,
            sqlite_where=text("is_dm"), postgresql_where=text("is_dm"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_groups.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    slug: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(20), default="discussion")
    # When true, only members enrolled in channel_members (plus group staff, who
    # keep moderation oversight) can see or post. A discussion/announcement kind
    # governs *how* enrolled members post; is_private governs *who* is enrolled.
    is_private: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # A direct-message channel: a private channel with exactly two members and no
    # staff oversight. Surfaced separately from topic channels in the UI.
    is_dm: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # For a DM, a stable, order-independent key of the two member ids so a pair
    # resolves to one channel (find-or-create). Null for non-DM channels.
    dm_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_by_member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ChannelMember(Base):
    """Enrollment of a group member in a private channel (or DM). Absent for
    open channels, which every group member may access."""
    __tablename__ = "channel_members"
    __table_args__ = (
        UniqueConstraint("channel_id", "member_id", name="uq_channel_member"),
        Index("ix_channel_members_member", "member_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    channel_id: Mapped[str] = mapped_column(String(36), ForeignKey("channels.id"), index=True)
    member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"), index=True)
    added_by_member_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("members.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (CheckConstraint("role IN ('admin','moderator','member','readonly')", name="ck_invitation_role"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_groups.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="member")
    created_by_member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    max_uses: Mapped[int] = mapped_column(Integer, default=1)
    use_count: Mapped[int] = mapped_column(Integer, default=0)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("length(body) <= 10000", name="ck_message_body_length"),
        Index("ix_messages_channel_cursor", "channel_id", "created_at", "id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_groups.id"), index=True)
    channel_id: Mapped[str] = mapped_column(String(36), ForeignKey("channels.id"), index=True)
    author_member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"), index=True)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("messages.id"), nullable=True, index=True)
    body: Mapped[str] = mapped_column(Text)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("messages.id"), index=True)
    url: Mapped[str] = mapped_column(String(2048))
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(150))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Mention(Base):
    __tablename__ = "mentions"
    __table_args__ = (UniqueConstraint("message_id", "member_id", name="uq_message_mention"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("messages.id"), index=True)
    member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"), index=True)


class Poll(Base):
    __tablename__ = "polls"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("messages.id"), unique=True, index=True)
    question: Mapped[str] = mapped_column(String(500))
    multiple_choice: Mapped[bool] = mapped_column(Boolean, default=False)
    closes_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PollOption(Base):
    __tablename__ = "poll_options"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    poll_id: Mapped[str] = mapped_column(String(36), ForeignKey("polls.id"), index=True)
    label: Mapped[str] = mapped_column(String(255))
    position: Mapped[int] = mapped_column(Integer)


class PollVote(Base):
    __tablename__ = "poll_votes"
    __table_args__ = (UniqueConstraint("option_id", "member_id", name="uq_poll_vote"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    poll_id: Mapped[str] = mapped_column(String(36), ForeignKey("polls.id"), index=True)
    option_id: Mapped[str] = mapped_column(String(36), ForeignKey("poll_options.id"), index=True)
    member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("member_id", name="uq_notification_member"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"), index=True)
    in_app: Mapped[bool] = mapped_column(Boolean, default=True)
    email: Mapped[bool] = mapped_column(Boolean, default=True)
    digest: Mapped[str] = mapped_column(String(20), default="daily")
    muted_channel_ids: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class NotificationJob(Base):
    __tablename__ = "notification_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"), index=True)
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("messages.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="digest")
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    available_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_groups.id"), index=True)
    actor_member_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("members.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    target_type: Mapped[str] = mapped_column(String(50))
    target_id: Mapped[str] = mapped_column(String(36))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class IntegrationCommand(Base):
    __tablename__ = "integration_commands"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    source: Mapped[str] = mapped_column(String(50), default="guesthub")
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    resource_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PendingUpload(Base):
    __tablename__ = "pending_uploads"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"), index=True)
    path: Mapped[str] = mapped_column(String(1024))
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(150))
    size_bytes: Mapped[int] = mapped_column(Integer)
    message_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("messages.id"), nullable=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Reaction(Base):
    __tablename__ = "reactions"
    __table_args__ = (UniqueConstraint("message_id", "member_id", "emoji", name="uq_message_reaction"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("messages.id"), index=True)
    member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"), index=True)
    emoji: Mapped[str] = mapped_column(String(32), default="like")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChannelReadState(Base):
    __tablename__ = "channel_read_states"
    __table_args__ = (UniqueConstraint("channel_id", "member_id", name="uq_channel_read_state"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    channel_id: Mapped[str] = mapped_column(String(36), ForeignKey("channels.id"), index=True)
    member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"), index=True)
    last_read_message_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("messages.id"), nullable=True)
    read_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ModerationReport(Base):
    __tablename__ = "moderation_reports"
    __table_args__ = (
        CheckConstraint("status IN ('open','reviewing','resolved','dismissed')", name="ck_report_status"),
        Index("ix_reports_group_status", "group_id", "status", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("festiome_groups.id"), index=True)
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("messages.id"), index=True)
    reporter_member_id: Mapped[str] = mapped_column(String(36), ForeignKey("members.id"), index=True)
    reason: Mapped[str] = mapped_column(String(500))
    details: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="open")
    resolution_note: Mapped[str] = mapped_column(Text, default="")
    resolved_by_member_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("members.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
