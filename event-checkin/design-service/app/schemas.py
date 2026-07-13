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
    # Public RSVP / Guest Hub composition: hero, organizer, detail and about
    # visibility plus CTA copy. Kept separate from wording so page structure is
    # explicit and can be previewed and versioned safely.
    page_config: dict = Field(default_factory=dict)


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
    pass_options: dict = Field(default_factory=dict)
    page_config: dict = Field(default_factory=dict)


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


class RenderRequest(BaseModel):
    size: str = "portrait"          # square | story | portrait | a5 | a4
    format: str | None = None       # png | pdf (auto: pdf for a5/a4, else png)
    template_id: str | None = None
    colors: dict | None = None
    wording: dict | None = None
    cover_image_url: str | None = None
    image_position: dict | None = None  # {x, y, zoom} for fixed template image zones
    text_scale: float | None = None     # multiplier for flyer typography
    qr_data: str | None = None      # URL/text to encode (e.g. the RSVP link)
    qr_position: str = "bottom-right"
    qr_enabled: bool = True
