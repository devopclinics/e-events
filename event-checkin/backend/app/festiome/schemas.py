from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    event_id: Optional[str] = None
    announce_only: bool = False


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    event_id: Optional[str] = None
    avatar_url: Optional[str] = None
    announce_only: bool = False
    is_archived: bool = False
    member_count: int = 0
    unread: int = 0
    my_role: str = "member"


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    display_name: str
    nickname: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    is_me: bool = False


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    kind: str
    url: str
    mime: Optional[str] = None


class MessageOut(BaseModel):
    id: str
    body: str
    sender_member_id: str
    sender_name: str
    parent_id: Optional[str] = None
    system: bool = False
    edited: bool = False
    deleted: bool = False
    like_count: int = 0
    liked_by_me: bool = False
    attachments: list[AttachmentOut] = []
    created_at: datetime


class MessageCreate(BaseModel):
    body: str = Field(default="", max_length=8000)
    parent_id: Optional[str] = None
    attachments: list[dict] = []   # [{kind,url,mime,size}]


class InviteOut(BaseModel):
    token: str
    role: str
    expires_at: Optional[datetime] = None
    join_url: Optional[str] = None


class ReportIn(BaseModel):
    reason: str = Field(default="", max_length=500)
