import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def uid() -> str:
    return str(uuid.uuid4())


class Site(Base):
    __tablename__ = "public_sites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    event_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    template_family: Mapped[str] = mapped_column(String(24), default="community")
    draft: Mapped[dict] = mapped_column(JSON, default=dict)
    published_release_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    releases: Mapped[list["Release"]] = relationship(back_populates="site", cascade="all, delete-orphan")


class Release(Base):
    __tablename__ = "public_site_releases"
    __table_args__ = (UniqueConstraint("site_id", "version", name="uq_site_release_version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    site_id: Mapped[str] = mapped_column(ForeignKey("public_sites.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    published_by: Mapped[str] = mapped_column(String(120), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    site: Mapped[Site] = relationship(back_populates="releases")


class Preview(Base):
    __tablename__ = "public_site_previews"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("public_sites.id", ondelete="CASCADE"), index=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

