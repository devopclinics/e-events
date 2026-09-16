from typing import Literal
from pydantic import BaseModel, Field, HttpUrl, field_validator


class Link(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    url: HttpUrl


class Session(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    time: str = Field(default="", max_length=80)
    venue: str = Field(default="", max_length=120)
    audience: str = Field(default="", max_length=120)
    track: str = Field(default="", max_length=80)


class Stat(BaseModel):
    value: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=80)
    detail: str = Field(default="", max_length=120)


class Track(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=180)
    icon: str = Field(default="✦", max_length=8)
    image_url: HttpUrl | None = None


class SiteContent(BaseModel):
    schema_version: Literal[1] = 1
    event_name: str = Field(min_length=1, max_length=180)
    eyebrow: str = Field(default="", max_length=100)
    headline: str = Field(min_length=1, max_length=220)
    summary: str = Field(default="", max_length=1200)
    start_date: str = Field(default="", max_length=60)
    end_date: str = Field(default="", max_length=60)
    venue: str = Field(default="", max_length=180)
    venue_address: str = Field(default="", max_length=300)
    venue_url: HttpUrl | None = None
    hero_image_url: HttpUrl | None = None
    feature_image_url: HttpUrl | None = None
    logo_url: HttpUrl | None = None
    primary_color: str = "#0d5c55"
    accent_color: str = "#d88945"
    primary_action: Link | None = None
    secondary_action: Link | None = None
    sessions: list[Session] = Field(default_factory=list, max_length=40)
    stats: list[Stat] = Field(default_factory=list, max_length=6)
    tracks: list[Track] = Field(default_factory=list, max_length=8)
    highlights: list[str] = Field(default_factory=list, max_length=12)
    visible_sections: list[str] = Field(default_factory=lambda: ["stats", "programme", "tracks", "connect"])
    heritage_message: str = Field(default="", max_length=240)
    festio_live_url: HttpUrl | None = None
    festiome_url: HttpUrl | None = None
    contact_email: str = Field(default="", max_length=180)

    @field_validator("primary_color", "accent_color")
    @classmethod
    def valid_color(cls, value: str) -> str:
        import re
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValueError("must be a six-digit hex color")
        return value


class SiteUpsert(BaseModel):
    org_id: str = Field(min_length=1, max_length=64)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)
    template_family: Literal["community", "conference", "celebration"] = "community"
    content: SiteContent


class PublishRequest(BaseModel):
    published_by: str = Field(default="system", max_length=120)

