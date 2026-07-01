"""Request/response models for the design-service API."""
from datetime import datetime
from pydantic import BaseModel, Field


class EventDesignIn(BaseModel):
    """What the admin UI saves. All optional so partial updates are cheap."""
    selected_template_id: str | None = None
    selected_flyer_template_id: str | None = None
    # Free-form but bounded config blobs (colors/fonts, wording, asset refs).
    theme_config: dict = Field(default_factory=dict)
    wording_config: dict = Field(default_factory=dict)
    asset_config: dict = Field(default_factory=dict)


class EventDesignOut(EventDesignIn):
    event_id: str
    organization_id: str | None = None
    is_published: bool = False
    published_version: int | None = None
    updated_at: datetime | None = None


class PublicTheme(BaseModel):
    """Safe payload for public RSVP / Guest Hub / Festio Pass pages. No secrets."""
    event_id: str
    template_id: str
    is_default: bool = False
    colors: dict
    font_pairing: str
    button_style: str
    layout: dict
    cover_image_url: str | None = None
    flyer_image_url: str | None = None
    wording: dict = Field(default_factory=dict)


class EmailTheme(BaseModel):
    """Payload the messaging service pulls to style emails (with fallback)."""
    event_id: str
    brand_name: str = "Festio"
    primary_color: str
    accent_color: str
    background_color: str
    button_style: str
    cover_image_url: str | None = None
    flyer_image_url: str | None = None
    is_default: bool = False


class PublishResult(BaseModel):
    event_id: str
    is_published: bool
    published_version: int
    published_at: datetime
