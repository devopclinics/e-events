from typing import Literal
from pydantic import BaseModel, Field, HttpUrl, field_validator


class Link(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    url: HttpUrl


def blank_link_is_none(value):
    """A Link whose url is blank (e.g. RSVP not yet enabled for this event)
    isn't a link at all — collapse it to None rather than fail validation."""
    if isinstance(value, dict) and not str(value.get("url") or "").strip():
        return None
    return value


class Session(BaseModel):
    source_id: str = Field(default="", max_length=80)
    day: str = Field(default="", max_length=40)
    date: str = Field(default="", max_length=40)
    title: str = Field(min_length=1, max_length=160)
    time: str = Field(default="", max_length=80)
    venue: str = Field(default="", max_length=120)
    audience: str = Field(default="", max_length=120)
    track: str = Field(default="", max_length=80)
    speaker: str = Field(default="", max_length=160)
    description: str = Field(default="", max_length=600)
    action_label: str = Field(default="", max_length=60)
    action_url: HttpUrl | None = None

    @field_validator("action_url", mode="before")
    @classmethod
    def blank_url_is_none(cls, value):
        return None if value in (None, "") else value


class Speaker(BaseModel):
    source_id: str = Field(default="", max_length=80)
    name: str = Field(min_length=1, max_length=160)
    title: str = Field(default="", max_length=160)
    organization: str = Field(default="", max_length=160)
    bio: str = Field(default="", max_length=800)
    photo_url: HttpUrl | None = None
    session_titles: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("photo_url", mode="before")
    @classmethod
    def blank_url_is_none(cls, value):
        return None if value in (None, "") else value


class Fact(BaseModel):
    label: str = Field(default="", max_length=80)
    value: str = Field(min_length=1, max_length=300)


class FeatureSection(BaseModel):
    id: str = Field(min_length=1, max_length=60)
    kicker: str = Field(default="", max_length=80)
    title: str = Field(min_length=1, max_length=160)
    summary: str = Field(default="", max_length=1200)
    image_url: HttpUrl | None = None

    facts: list[Fact] = Field(default_factory=list, max_length=10)
    action: Link | None = None
    enabled: bool = True

    @field_validator("image_url", mode="before")
    @classmethod
    def blank_image_url_is_none(cls, value):
        return None if value in (None, "") else value

    @field_validator("action", mode="before")
    @classmethod
    def blank_action_is_none(cls, value):
        return blank_link_is_none(value)


class FAQ(BaseModel):
    question: str = Field(min_length=1, max_length=240)
    answer: str = Field(min_length=1, max_length=1200)


class Stat(BaseModel):
    value: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=80)
    detail: str = Field(default="", max_length=120)


class Track(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=180)
    icon: str = Field(default="✦", max_length=8)
    image_url: HttpUrl | None = None

    @field_validator("image_url", mode="before")
    @classmethod
    def blank_image_url_is_none(cls, value):
        return None if value in (None, "") else value


class NavigationItem(BaseModel):
    id: str = Field(min_length=1, max_length=60)
    label: str = Field(min_length=1, max_length=60)
    destination_type: Literal["section", "speakers", "venue", "rsvp", "festio_live", "festiome", "contact", "custom"] = "custom"
    url: str = Field(default="", max_length=1000)
    enabled: bool = True
    requested_enabled: bool | None = None

    @field_validator("url")
    @classmethod
    def valid_destination(cls, value: str) -> str:
        from urllib.parse import urlparse
        value = value.strip()
        if not value:
            return value
        if value.startswith("#") and len(value) > 1:
            return value
        parsed = urlparse(value)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return value
        if parsed.scheme == "mailto" and "@" in parsed.path:
            return value
        raise ValueError("must be an http(s), mailto, or page-section destination")


class SiteContent(BaseModel):
    schema_version: Literal[1] = 1
    publication_features_version: Literal[2] = 2
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
    sessions: list[Session] = Field(default_factory=list, max_length=120)
    stats: list[Stat] = Field(default_factory=list, max_length=6)
    tracks: list[Track] = Field(default_factory=list, max_length=12)
    highlights: list[str] = Field(default_factory=list, max_length=12)
    visible_sections: list[str] = Field(default_factory=lambda: ["stats", "programme", "tracks", "connect"])
    heritage_message: str = Field(default="", max_length=240)
    festio_live_url: HttpUrl | None = None
    festiome_url: HttpUrl | None = None
    contact_email: str = Field(default="", max_length=180)
    brand_tagline: str = Field(default="", max_length=160)
    footer_tagline: str = Field(default="", max_length=160)
    programme_title: str = Field(default="Full programme", max_length=160)
    programme_summary: str = Field(default="Choose a day or track to plan your experience.", max_length=400)
    speakers: list[Speaker] = Field(default_factory=list, max_length=80)
    feature_sections: list[FeatureSection] = Field(default_factory=list, max_length=16)
    venue_facts: list[Fact] = Field(default_factory=list, max_length=12)
    registration_facts: list[Fact] = Field(default_factory=list, max_length=12)
    faqs: list[FAQ] = Field(default_factory=list, max_length=30)
    festio_live_title: str = Field(default="Festio Live", max_length=100)
    festio_live_description: str = Field(default="Participate in live Q&A, polls and activities.", max_length=240)
    festiome_title: str = Field(default="FestioMe", max_length=100)
    festiome_description: str = Field(default="Your personal event hub, pass and programme.", max_length=240)
    navigation: list[NavigationItem] = Field(default_factory=list, max_length=20)

    @field_validator("venue_url", "hero_image_url", "feature_image_url", "logo_url", "festio_live_url", "festiome_url", mode="before")
    @classmethod
    def blank_optional_url_is_none(cls, value):
        return None if value in (None, "") else value

    @field_validator("primary_action", "secondary_action", mode="before")
    @classmethod
    def blank_action_is_none(cls, value):
        return blank_link_is_none(value)

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

