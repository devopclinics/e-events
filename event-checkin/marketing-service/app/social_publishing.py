"""Approval-based social publishing, independent of email/sales outbound flags."""

import asyncio
import hashlib
import hmac
import os
import secrets
import shutil
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode, urlsplit

import httpx
from fastapi import Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field, ConfigDict, model_validator
from sqlalchemy import (
    JSON,
    DateTime,
    Integer,
    String,
    Text,
    UniqueConstraint,
    select,
    update,
)
from sqlalchemy.orm import Mapped, mapped_column

from . import social_providers as providers

PLATFORMS = ("facebook", "instagram", "youtube", "tiktok")
FORMATS = {
    "facebook": ("text", "image", "video"),
    "instagram": ("image", "video"),
    "youtube": ("video",),
    "tiktok": ("video", "image"),
}


def enabled():
    return os.getenv("MARKETING_SOCIAL_PUBLISHING_ENABLED", "false").lower() in {
        "true",
        "1",
        "yes",
    }


def utc(value):
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )


def https_url(value):
    parsed = urlsplit(value)
    return (
        parsed.scheme == "https"
        and bool(parsed.hostname)
        and not parsed.username
        and not parsed.password
        and parsed.port in (None, 443)
    )


class VariantIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    platform: Literal["facebook", "instagram", "youtube", "tiktok"]
    format: Literal["text", "image", "video"]
    caption: str = Field(min_length=1, max_length=5000)
    title: str = Field(default="", max_length=100)
    asset_id: str | None = None
    link_url: str = Field(default="", max_length=2000)
    visibility: Literal["public", "unlisted", "private"] = "public"
    made_for_kids: bool = False
    synthetic_media: bool = False

    @model_validator(mode="after")
    def validate_variant(self):
        if self.format not in FORMATS[self.platform]:
            raise ValueError("Unsupported format for this platform")
        if not self.caption.strip():
            raise ValueError("Caption cannot be blank")
        if self.platform == "instagram" and len(self.caption) > 2200:
            raise ValueError("Instagram captions allow 2200 characters")
        if self.platform == "youtube" and not self.title.strip():
            raise ValueError("A YouTube title is required")
        if self.format != "text" and not self.asset_id:
            raise ValueError("Select an uploaded asset")
        if self.link_url and not https_url(self.link_url):
            raise ValueError("Use an HTTPS link")
        return self


class PostIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    notes: str = Field(default="", max_length=10000)
    variants: list[VariantIn] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def unique_platforms(self):
        if len({v.platform for v in self.variants}) != len(self.variants):
            raise ValueError("Choose each platform once")
        return self


class ScheduleIn(BaseModel):
    scheduled_at: datetime


class ManualIn(BaseModel):
    url: str = Field(max_length=2000)


class ReconcileIn(BaseModel):
    url: str = Field(max_length=2000)
    provider_id: str = Field(min_length=1, max_length=200)


def valid_permalink(platform, value):
    try:
        host = urlsplit(value).hostname or ""
        domain = {
            "facebook": "facebook.com",
            "instagram": "instagram.com",
            "youtube": "youtube.com",
            "tiktok": "tiktok.com",
        }[platform]
        return https_url(value) and (
            host == domain
            or host.endswith("." + domain)
            or (platform == "youtube" and host == "youtu.be")
        )
    except ValueError:
        return False


def install(m):
    class SocialAsset(m.Base):
        __tablename__ = "marketing_social_assets"
        id: Mapped[str] = mapped_column(String(36), primary_key=True, default=m.uid)
        filename: Mapped[str] = mapped_column(String(200))
        mime: Mapped[str] = mapped_column(String(80))
        size: Mapped[int] = mapped_column(Integer)
        sha256: Mapped[str] = mapped_column(String(64))
        created_by: Mapped[str] = mapped_column(String(240))
        created_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), default=m.now
        )

    class SocialPost(m.Base):
        __tablename__ = "marketing_social_posts"
        id: Mapped[str] = mapped_column(String(36), primary_key=True, default=m.uid)
        title: Mapped[str] = mapped_column(String(200))
        notes: Mapped[str] = mapped_column(Text, default="")
        variants: Mapped[list] = mapped_column(JSON)
        status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
        created_by: Mapped[str] = mapped_column(String(240))
        approved_by: Mapped[str | None] = mapped_column(String(240), nullable=True)
        approved_at: Mapped[datetime | None] = mapped_column(
            DateTime(timezone=True), nullable=True
        )
        scheduled_at: Mapped[datetime | None] = mapped_column(
            DateTime(timezone=True), nullable=True, index=True
        )
        created_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), default=m.now
        )
        updated_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), default=m.now, onupdate=m.now
        )

    class SocialDelivery(m.Base):
        __tablename__ = "marketing_social_deliveries"
        __table_args__ = (
            UniqueConstraint("post_id", "platform", name="uq_social_post_platform"),
        )
        id: Mapped[str] = mapped_column(String(36), primary_key=True, default=m.uid)
        post_id: Mapped[str] = mapped_column(String(36), index=True)
        platform: Mapped[str] = mapped_column(String(30))
        status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
        attempts: Mapped[int] = mapped_column(Integer, default=0)
        next_attempt_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), default=m.now
        )
        claimed_at: Mapped[datetime | None] = mapped_column(
            DateTime(timezone=True), nullable=True
        )
        progress: Mapped[dict] = mapped_column(JSON, default=dict)
        provider_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
        url: Mapped[str | None] = mapped_column(Text, nullable=True)
        error: Mapped[str | None] = mapped_column(Text, nullable=True)
        updated_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), default=m.now, onupdate=m.now
        )

    class OAuthState(m.Base):
        __tablename__ = "marketing_social_oauth_states"
        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        platform: Mapped[str] = mapped_column(String(30))
        email: Mapped[str] = mapped_column(String(240))
        expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    m.Base.metadata.create_all(
        m.engine,
        tables=[
            SocialAsset.__table__,
            SocialPost.__table__,
            SocialDelivery.__table__,
            OAuthState.__table__,
        ],
    )
    m.SocialPost, m.SocialDelivery, m.SocialAsset = (
        SocialPost,
        SocialDelivery,
        SocialAsset,
    )

    def staff(identity=Depends(m.decode_identity)):
        if identity.owner_scoped:
            raise HTTPException(403, "Workspace-wide Marketing access is required")
        return identity

    def manager(identity=Depends(staff)):
        return m.require_manager(identity)

    def root_dir():
        return Path(os.getenv("MARKETING_SOCIAL_ASSET_DIR", "/data/social-assets"))

    def asset_path(asset):
        return root_dir() / asset.id

    def public_base():
        value = os.getenv(
            "MARKETING_SOCIAL_PUBLIC_ORIGIN", "https://festio.events"
        ).rstrip("/")
        try:
            valid = https_url(value) and urlsplit(value).path in ("", "/")
        except ValueError:
            valid = False
        if not valid:
            raise HTTPException(503, "Configure an HTTPS social media public origin")
        return value

    def asset_signature(asset_id):
        if not m.TOKEN_SECRET:
            raise HTTPException(503, "Asset signing is not configured")
        return hmac.new(
            m.TOKEN_SECRET.encode(),
            ("social-asset:" + asset_id).encode(),
            hashlib.sha256,
        ).hexdigest()

    def asset_out(asset):
        return {
            "id": asset.id,
            "filename": asset.filename,
            "mime": asset.mime,
            "size": asset.size,
            "sha256": asset.sha256,
            "created_at": asset.created_at,
            "url": f"{public_base()}/api/marketing/social/assets/{asset.id}/file?signature={asset_signature(asset.id)}",
        }

    def get_post(db, post_id):
        row = db.get(SocialPost, post_id)
        if not row:
            raise HTTPException(404, "Social post not found")
        return row

    def post_out(db, row):
        deliveries = db.scalars(
            select(SocialDelivery).where(SocialDelivery.post_id == row.id)
        ).all()
        return {
            "id": row.id,
            "title": row.title,
            "notes": row.notes,
            "variants": row.variants,
            "status": row.status,
            "created_by": row.created_by,
            "approved_by": row.approved_by,
            "approved_at": row.approved_at,
            "scheduled_at": row.scheduled_at,
            "created_at": row.created_at,
            "deliveries": [
                {
                    "id": d.id,
                    "platform": d.platform,
                    "status": d.status,
                    "attempts": d.attempts,
                    "provider_id": d.provider_id,
                    "url": d.url,
                    "error": d.error,
                    "updated_at": d.updated_at,
                }
                for d in deliveries
            ],
        }

    def validate_assets(db, variants):
        for item in variants:
            if item.format == "text":
                continue
            asset = db.get(SocialAsset, item.asset_id)
            if not asset or not asset_path(asset).is_file():
                raise HTTPException(422, "Uploaded asset not found")
            if item.format == "video" and asset.mime != "video/mp4":
                raise HTTPException(422, "Select an MP4 video")
            if item.format == "image" and not asset.mime.startswith("image/"):
                raise HTTPException(422, "Select an image")
            if (
                item.platform == "instagram"
                and item.format == "image"
                and asset.mime != "image/jpeg"
            ):
                raise HTTPException(422, "Instagram image posts require JPEG")

    @m.app.get("/api/marketing/social/capabilities")
    def capabilities(identity=Depends(staff), db=Depends(m.db_session)):
        channels = []
        for platform in PLATFORMS:
            creds = (
                m.social_credentials(db, platform)
                if platform in m.SOCIAL_FIELDS
                else {}
            )
            required = (
                ("client_id", "client_secret", "refresh_token", "channel_id")
                if platform == "youtube"
                else (
                    "access_token",
                    "page_id" if platform == "facebook" else "user_id",
                )
            )
            channels.append(
                {
                    "platform": platform,
                    "formats": FORMATS[platform],
                    "mode": "manual" if platform == "tiktok" else "direct",
                    "configured": platform != "tiktok"
                    and all(creds.get(k) for k in required),
                }
            )
        return {
            "publishing_enabled": enabled(),
            "scheduler_enabled": os.getenv(
                "MARKETING_SOCIAL_SCHEDULER_ENABLED", "false"
            ).lower()
            in {"true", "1", "yes"},
            "channels": channels,
            "can_approve": identity.role in {"manager", "superadmin"},
            "can_connect": identity.is_superadmin,
        }

    @m.app.get("/api/marketing/social/assets")
    def list_assets(identity=Depends(staff), db=Depends(m.db_session)):
        return [
            asset_out(a)
            for a in db.scalars(
                select(SocialAsset).order_by(SocialAsset.created_at.desc()).limit(100)
            )
        ]

    @m.app.post("/api/marketing/social/assets", status_code=201)
    async def upload_asset(
        file: UploadFile = File(...), identity=Depends(staff), db=Depends(m.db_session)
    ):
        asset_id = m.uid()
        public_base()
        asset_signature(asset_id)
        root_dir().mkdir(parents=True, exist_ok=True)
        path = root_dir() / asset_id
        size, digest, first = 0, hashlib.sha256(), b""
        limit = (
            min(max(int(os.getenv("MARKETING_SOCIAL_MAX_ASSET_MB", "200")), 1), 500)
            * 1024
            * 1024
        )
        try:
            with path.open("xb") as target:
                while chunk := await file.read(1024 * 1024):
                    if not first:
                        first = chunk[:32]
                    reserve = (
                        max(
                            128,
                            int(os.getenv("MARKETING_SOCIAL_DISK_RESERVE_MB", "256")),
                        )
                        * 1024
                        * 1024
                    )
                    if shutil.disk_usage(root_dir()).free < reserve + len(chunk):
                        raise HTTPException(
                            507,
                            "Media storage is low. Free space before uploading more assets.",
                        )
                    size += len(chunk)
                    if size > limit:
                        raise HTTPException(413, "Asset exceeds the upload size limit")
                    digest.update(chunk)
                    target.write(chunk)
            mime = (
                "image/jpeg"
                if first.startswith(b"\xff\xd8\xff")
                else "image/png"
                if first.startswith(b"\x89PNG\r\n\x1a\n")
                else "video/mp4"
                if len(first) > 12 and first[4:8] == b"ftyp"
                else None
            )
            if not mime:
                raise HTTPException(422, "Upload a JPEG, PNG or MP4 file")
            row = SocialAsset(
                id=asset_id,
                filename=Path(file.filename or "asset").name[:200],
                mime=mime,
                size=size,
                sha256=digest.hexdigest(),
                created_by=identity.email,
            )
            db.add(row)
            m.audit(db, identity, "social.asset_uploaded", "social_asset", asset_id)
            db.commit()
            return asset_out(row)
        except Exception:
            db.rollback()
            path.unlink(missing_ok=True)
            raise
        finally:
            await file.close()

    @m.app.get("/api/marketing/social/assets/{asset_id}/file")
    def serve_asset(
        asset_id: str,
        signature: str = Query(""),
        download: bool = False,
        db=Depends(m.db_session),
    ):
        if not hmac.compare_digest(
            signature.encode(), asset_signature(asset_id).encode()
        ):
            raise HTTPException(404, "Asset not found")
        asset = db.get(SocialAsset, asset_id)
        if not asset or not asset_path(asset).is_file():
            raise HTTPException(404, "Asset not found")
        return FileResponse(
            asset_path(asset),
            media_type=asset.mime,
            filename=asset.filename if download else None,
            headers={
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, max-age=300",
            },
        )

    @m.app.get("/api/marketing/social/posts")
    def list_posts(identity=Depends(staff), db=Depends(m.db_session)):
        return [
            post_out(db, p)
            for p in db.scalars(
                select(SocialPost).order_by(SocialPost.created_at.desc()).limit(100)
            )
        ]

    @m.app.post("/api/marketing/social/posts", status_code=201)
    def create_post(body: PostIn, identity=Depends(staff), db=Depends(m.db_session)):
        validate_assets(db, body.variants)
        row = SocialPost(
            title=body.title,
            notes=body.notes,
            variants=[v.model_dump() for v in body.variants],
            created_by=identity.email,
        )
        db.add(row)
        db.flush()
        m.audit(db, identity, "social.draft_created", "social_post", row.id)
        db.commit()
        return post_out(db, row)

    @m.app.put("/api/marketing/social/posts/{post_id}")
    def edit_post(
        post_id: str, body: PostIn, identity=Depends(staff), db=Depends(m.db_session)
    ):
        row = get_post(db, post_id)
        if row.status != "draft":
            raise HTTPException(409, "Return this post to draft before editing")
        validate_assets(db, body.variants)
        count = db.execute(
            update(SocialPost)
            .where(SocialPost.id == row.id, SocialPost.status == "draft")
            .values(
                title=body.title,
                notes=body.notes,
                variants=[v.model_dump() for v in body.variants],
            )
        ).rowcount
        if not count:
            raise HTTPException(409, "Post changed; reload before editing")
        m.audit(db, identity, "social.draft_updated", "social_post", row.id)
        db.commit()
        db.refresh(row)
        return post_out(db, row)

    @m.app.post("/api/marketing/social/posts/{post_id}/submit")
    def submit_post(post_id: str, identity=Depends(staff), db=Depends(m.db_session)):
        row = get_post(db, post_id)
        count = db.execute(
            update(SocialPost)
            .where(SocialPost.id == row.id, SocialPost.status == "draft")
            .values(status="review")
        ).rowcount
        if not count:
            raise HTTPException(409, "Only drafts can be submitted for review")
        m.audit(db, identity, "social.submitted", "social_post", row.id)
        db.commit()
        db.refresh(row)
        return post_out(db, row)

    @m.app.post("/api/marketing/social/posts/{post_id}/approve")
    def approve_post(post_id: str, identity=Depends(manager), db=Depends(m.db_session)):
        row = get_post(db, post_id)
        validate_assets(db, [VariantIn(**v) for v in row.variants])
        count = db.execute(
            update(SocialPost)
            .where(SocialPost.id == row.id, SocialPost.status == "review")
            .values(status="approved", approved_by=identity.email, approved_at=m.now())
        ).rowcount
        if not count:
            raise HTTPException(409, "Only posts in review can be approved")
        m.audit(db, identity, "social.approved", "social_post", row.id)
        db.commit()
        db.refresh(row)
        return post_out(db, row)

    @m.app.post("/api/marketing/social/posts/{post_id}/draft")
    def return_draft(post_id: str, identity=Depends(manager), db=Depends(m.db_session)):
        row = get_post(db, post_id)
        count = db.execute(
            update(SocialPost)
            .where(
                SocialPost.id == row.id,
                SocialPost.status.in_(["review", "approved", "cancelled"]),
            )
            .values(
                status="draft", approved_by=None, approved_at=None, scheduled_at=None
            )
        ).rowcount
        if not count:
            raise HTTPException(409, "Cancel scheduling before editing")
        deliveries = db.scalars(
            select(SocialDelivery).where(SocialDelivery.post_id == row.id)
        ).all()
        if any(d.attempts or d.status == "published" for d in deliveries):
            raise HTTPException(
                409, "Attempted posts are immutable; create a new draft"
            )
        for d in deliveries:
            db.delete(d)
        row.status, row.approved_by, row.approved_at, row.scheduled_at = (
            "draft",
            None,
            None,
            None,
        )
        m.audit(db, identity, "social.returned_to_draft", "social_post", row.id)
        db.commit()
        return post_out(db, row)

    @m.app.post("/api/marketing/social/posts/{post_id}/schedule")
    def schedule_post(
        post_id: str,
        body: ScheduleIn,
        identity=Depends(manager),
        db=Depends(m.db_session),
    ):
        if body.scheduled_at.tzinfo is None:
            raise HTTPException(422, "Include a timezone in the scheduled date")
        when = utc(body.scheduled_at)
        if when < m.now() - timedelta(minutes=1):
            raise HTTPException(422, "Choose a current or future publishing time")
        row = get_post(db, post_id)
        count = db.execute(
            update(SocialPost)
            .where(SocialPost.id == row.id, SocialPost.status == "approved")
            .values(status="scheduled", scheduled_at=when)
        ).rowcount
        if not count:
            raise HTTPException(409, "Only approved posts can be scheduled")
        for v in row.variants:
            db.add(
                SocialDelivery(
                    post_id=row.id,
                    platform=v["platform"],
                    status="manual" if v["platform"] == "tiktok" else "pending",
                    next_attempt_at=when,
                )
            )
        m.audit(
            db,
            identity,
            "social.scheduled",
            "social_post",
            row.id,
            scheduled_at=when.isoformat(),
        )
        db.commit()
        db.refresh(row)
        return post_out(db, row)

    @m.app.post("/api/marketing/social/posts/{post_id}/cancel")
    def cancel_post(post_id: str, identity=Depends(manager), db=Depends(m.db_session)):
        row = get_post(db, post_id)
        if row.status != "scheduled":
            raise HTTPException(409, "Only scheduled posts can be cancelled")
        # Acquire SQLite write lock before reading claims, serialize with worker claims.
        db.execute(
            update(SocialPost).where(SocialPost.id == row.id).values(updated_at=m.now())
        )
        db.expire_all()
        row = get_post(db, post_id)
        if row.status != "scheduled":
            raise HTTPException(409, "Post changed; reload before cancelling")
        deliveries = db.scalars(
            select(SocialDelivery).where(SocialDelivery.post_id == row.id)
        ).all()
        if any(d.status == "sending" for d in deliveries):
            raise HTTPException(409, "A delivery is in progress; wait for its result")
        for d in deliveries:
            if d.status not in {"published", "needs_review"}:
                d.status = "cancelled"
        row.status = "cancelled"
        m.audit(db, identity, "social.cancelled", "social_post", row.id)
        db.commit()
        return post_out(db, row)

    def completion(db, post_id):
        deliveries = db.scalars(
            select(SocialDelivery).where(SocialDelivery.post_id == post_id)
        ).all()
        if deliveries and all(d.status == "published" for d in deliveries):
            row = get_post(db, post_id)
            if row.status == "scheduled":
                row.status = "complete"

    @m.app.post("/api/marketing/social/deliveries/{delivery_id}/manual")
    def manual_complete(
        delivery_id: str,
        body: ManualIn,
        identity=Depends(manager),
        db=Depends(m.db_session),
    ):
        row = db.get(SocialDelivery, delivery_id)
        if not row:
            raise HTTPException(404, "Delivery not found")
        if row.platform != "tiktok" or row.status != "manual":
            raise HTTPException(409, "This is not a pending manual delivery")
        if not valid_permalink("tiktok", body.url):
            raise HTTPException(422, "Enter the published TikTok HTTPS link")
        count = db.execute(
            update(SocialDelivery)
            .where(SocialDelivery.id == row.id, SocialDelivery.status == "manual")
            .values(status="published", url=body.url)
        ).rowcount
        if not count:
            raise HTTPException(409, "Delivery changed; reload first")
        db.refresh(row)
        m.audit(
            db,
            identity,
            "social.manual_delivery_confirmed",
            "social_delivery",
            row.id,
            url=body.url,
        )
        db.flush()
        completion(db, row.post_id)
        db.commit()
        return {"status": row.status, "url": row.url}

    @m.app.post("/api/marketing/social/deliveries/{delivery_id}/retry")
    def retry_delivery(
        delivery_id: str, identity=Depends(manager), db=Depends(m.db_session)
    ):
        row = db.get(SocialDelivery, delivery_id)
        if not row:
            raise HTTPException(404, "Delivery not found")
        if get_post(db, row.post_id).status != "scheduled":
            raise HTTPException(409, "Post is not scheduled")
        if row.status != "failed":
            raise HTTPException(
                409,
                "Only confirmed failures can be retried; reconcile uncertain deliveries first",
            )
        count = db.execute(
            update(SocialDelivery)
            .where(
                SocialDelivery.id == row.id,
                SocialDelivery.status == "failed",
                SocialDelivery.post_id.in_(
                    select(SocialPost.id).where(SocialPost.status == "scheduled")
                ),
            )
            .values(status="pending", next_attempt_at=m.now(), error=None)
        ).rowcount
        if not count:
            raise HTTPException(409, "Delivery changed; reload first")
        db.refresh(row)
        m.audit(db, identity, "social.retry_requested", "social_delivery", row.id)
        db.commit()
        return {"status": row.status}

    @m.app.post("/api/marketing/social/deliveries/{delivery_id}/reconcile")
    def reconcile(
        delivery_id: str,
        body: ReconcileIn,
        identity=Depends(manager),
        db=Depends(m.db_session),
    ):
        row = db.get(SocialDelivery, delivery_id)
        if not row:
            raise HTTPException(404, "Delivery not found")
        if row.status != "needs_review":
            raise HTTPException(409, "This delivery does not need reconciliation")
        if not valid_permalink(row.platform, body.url):
            raise HTTPException(422, "Enter a published link on the correct platform")
        count = db.execute(
            update(SocialDelivery)
            .where(SocialDelivery.id == row.id, SocialDelivery.status == "needs_review")
            .values(
                status="published",
                provider_id=body.provider_id,
                url=body.url,
                error=None,
            )
        ).rowcount
        if not count:
            raise HTTPException(409, "Delivery changed; reload first")
        db.refresh(row)
        m.audit(
            db,
            identity,
            "social.delivery_reconciled",
            "social_delivery",
            row.id,
            url=body.url,
        )
        db.flush()
        completion(db, row.post_id)
        db.commit()
        return {"status": row.status}

    async def run_due(limit=10):
        if not enabled():
            return 0
        count = 0
        # Do not reclaim stale writes automatically: their external outcome is unknown.
        with m.SessionLocal() as db:
            db.execute(
                update(SocialDelivery)
                .where(
                    SocialDelivery.status == "sending",
                    SocialDelivery.claimed_at < m.now() - timedelta(minutes=20),
                )
                .values(
                    status="needs_review",
                    error="Worker interrupted. Check the platform before reconciling this delivery.",
                )
            )
            db.commit()
            ids = list(
                db.scalars(
                    select(SocialDelivery.id)
                    .join(SocialPost, SocialPost.id == SocialDelivery.post_id)
                    .where(
                        SocialPost.status == "scheduled",
                        SocialPost.scheduled_at <= m.now(),
                        SocialDelivery.status.in_(["pending", "retry"]),
                        SocialDelivery.next_attempt_at <= m.now(),
                    )
                    .order_by(SocialDelivery.next_attempt_at)
                    .limit(limit)
                )
            )
        for delivery_id in ids:
            with m.SessionLocal() as db:
                # Conditional update is the durable claim: concurrent workers cannot both win.
                result = db.execute(
                    update(SocialDelivery)
                    .where(
                        SocialDelivery.id == delivery_id,
                        SocialDelivery.status.in_(["pending", "retry"]),
                        SocialDelivery.post_id.in_(
                            select(SocialPost.id).where(
                                SocialPost.status == "scheduled"
                            )
                        ),
                    )
                    .values(
                        status="sending",
                        claimed_at=m.now(),
                        attempts=SocialDelivery.attempts + 1,
                    )
                )
                db.commit()
                if result.rowcount != 1:
                    continue
                row = db.get(SocialDelivery, delivery_id)
                post = db.get(SocialPost, row.post_id)
                payload = next(
                    v for v in post.variants if v["platform"] == row.platform
                )

                def checkpoint(value):
                    row.progress = value
                    db.commit()

                try:
                    if not enabled():
                        row.status = "pending"
                        db.commit()
                        continue
                    asset = (
                        db.get(SocialAsset, payload.get("asset_id"))
                        if payload.get("asset_id")
                        else None
                    )
                    asset_data = (
                        {**asset_out(asset), "path": str(asset_path(asset))}
                        if asset
                        else None
                    )
                    if asset and not asset_path(asset).is_file():
                        raise providers.DeliveryError("Uploaded media file is missing.")
                    credentials = m.social_credentials(db, row.platform)
                    async with httpx.AsyncClient(
                        timeout=httpx.Timeout(300, connect=20), follow_redirects=False
                    ) as client:
                        provider_id, url = await providers.publish(
                            client,
                            row.platform,
                            payload,
                            credentials,
                            asset_data,
                            row.progress,
                            checkpoint,
                        )
                    row.status, row.provider_id, row.url, row.error = (
                        "published",
                        provider_id,
                        url,
                        None,
                    )
                    m.audit(
                        db,
                        "social-scheduler",
                        "social.delivery_published",
                        "social_delivery",
                        row.id,
                        platform=row.platform,
                        provider_id=provider_id,
                    )
                    db.flush()
                    completion(db, row.post_id)
                    count += 1
                except providers.DeliveryError as exc:
                    phase = (row.progress or {}).get("phase")
                    # Known upload/container IDs can safely be polled again. Writes without
                    # an acknowledged id must never be repeated automatically.
                    uncertain = exc.uncertain or (
                        not exc.rejected
                        and phase
                        in {
                            "publishing",
                            "uploading",
                            "upload_start",
                            "container_start",
                        }
                    )
                    row.status = (
                        "needs_review"
                        if uncertain
                        else "retry"
                        if exc.retryable and row.attempts < 20
                        else "failed"
                    )
                    row.error = str(exc)
                    if exc.rejected:
                        # A definite rejection is safe to retry, retaining a known container.
                        row.progress = {
                            k: v
                            for k, v in (row.progress or {}).items()
                            if k != "phase"
                        }
                    row.next_attempt_at = m.now() + timedelta(
                        seconds=min(3600, 60 * 2 ** min(row.attempts, 6))
                    )
                except Exception:
                    row.status = "needs_review"
                    row.error = (
                        "Delivery interrupted. Check the platform before retrying."
                    )
                db.commit()
        return count

    m.run_social_publishing_due = run_due
    stop = threading.Event()
    thread = None

    def worker():
        while not stop.wait(30):
            try:
                asyncio.run(run_due())
            except Exception:
                m.logger.exception("Social publishing worker failed")

    @m.app.on_event("startup")
    def start_social_worker():
        nonlocal thread
        if os.getenv("MARKETING_SOCIAL_SCHEDULER_ENABLED", "false").lower() in {
            "true",
            "1",
            "yes",
        }:
            stop.clear()
            thread = threading.Thread(
                target=worker, name="social-publishing", daemon=True
            )
            thread.start()

    @m.app.on_event("shutdown")
    async def stop_social_worker():
        stop.set()
        if thread:
            await asyncio.to_thread(thread.join, 5)

    # OAuth callbacks consume a one-use random state and never return provider tokens.
    def callback_url(platform):
        return f"{public_base()}/api/marketing/social/oauth/{platform}/callback"

    @m.app.post("/api/marketing/social/oauth/{platform}/start")
    def oauth_start(
        platform: str, identity=Depends(m.require_superadmin), db=Depends(m.db_session)
    ):
        if platform not in {"facebook", "youtube"}:
            raise HTTPException(400, "Unsupported OAuth provider")
        credentials = m.social_credentials(db, platform)
        keys = (
            ("client_id", "client_secret")
            if platform == "youtube"
            else ("app_id", "app_secret", "page_id")
        )
        if not all(credentials.get(k) for k in keys):
            raise HTTPException(
                422,
                "Save the Google OAuth client ID and secret first"
                if platform == "youtube"
                else "Save the Meta app ID, app secret and Facebook Page ID first",
            )
        db.execute(OAuthState.__table__.delete().where(OAuthState.expires_at < m.now()))
        state = secrets.token_urlsafe(32)
        db.add(
            OAuthState(
                id=state,
                platform=platform,
                email=identity.email,
                expires_at=m.now() + timedelta(minutes=10),
            )
        )
        db.commit()
        if platform == "youtube":
            url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
                {
                    "client_id": credentials["client_id"],
                    "redirect_uri": callback_url(platform),
                    "response_type": "code",
                    "state": state,
                    "scope": "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
                    "access_type": "offline",
                    "prompt": "consent",
                }
            )
        else:
            version = os.getenv("MARKETING_META_GRAPH_VERSION", "v23.0")
            url = f"https://www.facebook.com/{version}/dialog/oauth?" + urlencode(
                {
                    "client_id": credentials["app_id"],
                    "redirect_uri": callback_url(platform),
                    "response_type": "code",
                    "state": state,
                    "scope": "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,publish_video",
                }
            )
        return {"url": url, "redirect_uri": callback_url(platform)}

    def save_credentials(db, platform, credentials, email):
        import json

        row = db.get(m.SocialConnection, platform) or m.SocialConnection(
            platform=platform
        )
        row.encrypted_credentials = (
            m.credential_cipher().encrypt(json.dumps(credentials).encode()).decode()
        )
        row.updated_by = email
        db.add(row)

    @m.app.get(
        "/api/marketing/social/oauth/{platform}/callback", response_class=HTMLResponse
    )
    async def oauth_callback(
        platform: str,
        state: str = "",
        code: str = "",
        error: str = "",
        db=Depends(m.db_session),
    ):
        row = db.get(OAuthState, state)
        if not row or row.platform != platform or utc(row.expires_at) < m.now():
            raise HTTPException(400, "Invalid or expired account connection")
        # Delete atomically so a concurrent callback cannot reuse the code/state.
        email = row.email
        result = db.execute(OAuthState.__table__.delete().where(OAuthState.id == state))
        db.commit()
        if result.rowcount != 1:
            raise HTTPException(400, "Connection already used")
        if error or not code:
            raise HTTPException(400, "Account connection was cancelled")
        credentials = m.social_credentials(db, platform)
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                if platform == "youtube":
                    result = providers.checked(
                        await client.post(
                            "https://oauth2.googleapis.com/token",
                            data={
                                "client_id": credentials["client_id"],
                                "client_secret": credentials["client_secret"],
                                "code": code,
                                "grant_type": "authorization_code",
                                "redirect_uri": callback_url(platform),
                            },
                        )
                    )
                    if not result.get("refresh_token"):
                        raise providers.DeliveryError(
                            "Offline access was not granted; reconnect with consent."
                        )
                    channels = providers.checked(
                        await client.get(
                            "https://www.googleapis.com/youtube/v3/channels",
                            headers={
                                "Authorization": "Bearer " + result["access_token"]
                            },
                            params={"part": "id,snippet", "mine": "true"},
                        )
                    )
                    items = channels.get("items", [])
                    if len(items) != 1:
                        raise providers.DeliveryError(
                            "Authorize exactly one YouTube channel."
                        )
                    credentials.update(
                        refresh_token=result["refresh_token"], channel_id=items[0]["id"]
                    )
                    save_credentials(db, platform, credentials, email)
                else:
                    result = providers.checked(
                        await client.get(
                            "https://graph.facebook.com/"
                            + os.getenv("MARKETING_META_GRAPH_VERSION", "v23.0")
                            + "/oauth/access_token",
                            params={
                                "client_id": credentials["app_id"],
                                "client_secret": credentials["app_secret"],
                                "code": code,
                                "redirect_uri": callback_url(platform),
                            },
                        )
                    )
                    extended = providers.checked(
                        await client.get(
                            "https://graph.facebook.com/"
                            + os.getenv("MARKETING_META_GRAPH_VERSION", "v23.0")
                            + "/oauth/access_token",
                            params={
                                "grant_type": "fb_exchange_token",
                                "client_id": credentials["app_id"],
                                "client_secret": credentials["app_secret"],
                                "fb_exchange_token": result["access_token"],
                            },
                        )
                    )
                    page = providers.checked(
                        await client.get(
                            providers.graph_url(credentials["page_id"]),
                            params={
                                "fields": "id,name,access_token,instagram_business_account",
                                "access_token": extended["access_token"],
                            },
                        )
                    )
                    if not page.get("access_token"):
                        raise providers.DeliveryError(
                            "Page publishing access was not granted."
                        )
                    credentials["access_token"] = page["access_token"]
                    save_credentials(db, "facebook", credentials, email)
                    ig_id = page.get("instagram_business_account", {}).get("id")
                    if ig_id:
                        save_credentials(
                            db,
                            "instagram",
                            {
                                "access_token": page["access_token"],
                                "app_id": credentials["app_id"],
                                "app_secret": credentials["app_secret"],
                                "user_id": ig_id,
                            },
                            email,
                        )
                m.audit(db, email, "social.oauth_connected", "provider", platform)
                db.commit()
        except (providers.DeliveryError, httpx.HTTPError, KeyError):
            db.rollback()
            raise HTTPException(
                502,
                "Connection could not be verified. Check app permissions and reconnect.",
            )
        return HTMLResponse(
            '<!doctype html><meta name="viewport" content="width=device-width"><title>Account connected</title><h1>Account connected</h1><p>Return to Festio Social settings and test the connection.</p><a href="/marketing?tab=social-settings">Return to Festio</a>',
            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
        )
