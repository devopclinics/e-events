from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    tenant_name: str = Field(default="My FestioMe", min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)


class SubGroupCreate(BaseModel):
    """A moderator-created group nested under an event."""
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    join_policy: Literal["closed", "request", "open"] = "request"
    visibility: Literal["listed", "unlisted"] = "listed"
    rules: str = Field(default="", max_length=10000)


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    tenant_id: str
    external_event_ref: str | None
    name: str
    description: str
    is_primary: bool = True
    join_policy: str = "closed"
    visibility: str = "listed"
    rules: str = ""
    rules_version: int = 0
    archived: bool
    created_at: datetime
    member_count: int = 0
    unread_count: int = 0
    viewer_role: str | None = None
    # Whether the viewer has accepted the current rules_version (True when the
    # group has no rules).
    rules_accepted: bool = True
    pending_request_count: int = 0


class GroupDirectoryOut(BaseModel):
    """Lightweight listing for the event group directory (non-members included)."""
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    description: str
    is_primary: bool
    join_policy: str
    visibility: str
    member_count: int = 0
    is_member: bool = False
    has_pending_request: bool = False


class JoinGroupRequest(BaseModel):
    message: str = Field(default="", max_length=1000)


class JoinGroupResult(BaseModel):
    status: Literal["joined", "requested", "already_member", "already_requested"]
    group_id: str
    member: "MemberOut | None" = None


class JoinRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    group_id: str
    identity_kind: str
    identity_ref: str
    display_name: str
    message: str
    status: str
    created_at: datetime
    decided_at: datetime | None = None


class JoinRequestDecision(BaseModel):
    role: Literal["moderator", "member", "readonly"] = "member"


class RulesAcceptResult(BaseModel):
    group_id: str
    rules_version: int
    rules_accepted: bool


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=2000)
    kind: Literal["discussion", "announcement", "staff"] = "discussion"


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    group_id: str
    name: str
    slug: str
    description: str
    kind: str
    archived: bool
    created_at: datetime
    unread_count: int = 0


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    group_id: str
    display_name: str
    role: str
    joined_at: datetime
    is_me: bool = False


class InvitationCreate(BaseModel):
    email: str | None = Field(default=None, max_length=320)
    role: Literal["admin", "moderator", "member", "readonly"] = "member"
    expires_in_hours: int = Field(default=168, ge=1, le=2160)
    max_uses: int = Field(default=1, ge=1, le=10000)


class InvitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    group_id: str
    email: str | None
    role: str
    expires_at: datetime
    max_uses: int
    use_count: int
    revoked_at: datetime | None
    created_at: datetime
    token: str | None = None


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)
    parent_id: str | None = None
    scheduled_for: datetime | None = None
    attachments: list["AttachmentIn"] = Field(default_factory=list, max_length=10)
    mention_member_ids: list[str] = Field(default_factory=list, max_length=100)


class AttachmentIn(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=150)
    size_bytes: int = Field(ge=1, le=25 * 1024 * 1024)


class AttachmentOut(AttachmentIn):
    id: str


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    archived: bool | None = None
    join_policy: Literal["closed", "request", "open"] | None = None
    visibility: Literal["listed", "unlisted"] | None = None
    rules: str | None = Field(default=None, max_length=10000)


class MemberUpdate(BaseModel):
    role: Literal["admin", "moderator", "member", "readonly"]


class OwnershipTransfer(BaseModel):
    member_id: str


class MessageUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


class ReactionOut(BaseModel):
    emoji: str
    count: int
    reacted_by_me: bool


class MessageOut(BaseModel):
    id: str
    group_id: str
    channel_id: str
    author_member_id: str
    author_name: str
    parent_id: str | None
    body: str
    edited_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    reactions: list[ReactionOut] = []
    attachments: list[AttachmentOut] = []
    mention_member_ids: list[str] = []
    scheduled_for: datetime | None = None
    published_at: datetime | None = None
    poll: dict | None = None


class MessagePage(BaseModel):
    items: list[MessageOut]
    next_cursor: str | None


class ReactionCreate(BaseModel):
    emoji: str = Field(default="like", min_length=1, max_length=32)


class ReadStateUpdate(BaseModel):
    message_id: str


class ReadStateOut(BaseModel):
    channel_id: str
    last_read_message_id: str | None
    read_at: datetime


class ReportCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
    details: str = Field(default="", max_length=5000)


class ReportUpdate(BaseModel):
    status: Literal["reviewing", "resolved", "dismissed"]
    resolution_note: str = Field(default="", max_length=5000)


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    group_id: str
    message_id: str
    reporter_member_id: str
    reason: str
    details: str
    status: str
    resolution_note: str
    created_at: datetime
    resolved_at: datetime | None


class ReportPage(BaseModel):
    items: list[ReportOut]
    next_cursor: str | None


class PollCreate(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    options: list[str] = Field(min_length=2, max_length=10)
    multiple_choice: bool = False
    closes_at: datetime | None = None
    scheduled_for: datetime | None = None


class PollVoteCreate(BaseModel):
    option_ids: list[str] = Field(min_length=1, max_length=10)


class NotificationPreferenceIn(BaseModel):
    in_app: bool = True
    email: bool = True
    digest: Literal["immediate", "daily", "weekly", "none"] = "daily"
    muted_channel_ids: list[str] = Field(default_factory=list, max_length=500)


class NotificationPreferenceOut(NotificationPreferenceIn):
    member_id: str
    updated_at: datetime


class RealtimeTicketOut(BaseModel):
    ticket: str
    expires_at: datetime


class EventLinkOwner(BaseModel):
    subject: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    email: str = Field(default="", max_length=320)


class EventLinkCreate(BaseModel):
    external_event_ref: str = Field(min_length=1, max_length=100)
    external_org_ref: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    owner: EventLinkOwner


class EventLinkOut(BaseModel):
    enabled: bool = True
    festiome_id: str
    name: str
    open_url: str


# Resolve the forward reference to MemberOut now that it is defined.
JoinGroupResult.model_rebuild()
