"""Presentation-only configuration for reusable public event-site templates."""

TEMPLATES = {
    "modern-professional": {"name": "Modern Professional", "description": "Professional · Bold · Conference", "hero": "overlay", "programme": "timeline"},
    "clean-elegant": {"name": "Clean Elegant", "description": "Minimal · Premium · Editorial", "hero": "collage", "programme": "timeline"},
    "storytelling": {"name": "Image-focused Storytelling", "description": "Human · Warm · Immersive", "hero": "cinematic", "programme": "cards"},
    "bold-dynamic": {"name": "Bold & Dynamic", "description": "Energetic · Modern · High contrast", "hero": "angular", "programme": "timeline"},
    "card-friendly": {"name": "Card-based Friendly", "description": "Approachable · Clear · Family friendly", "hero": "card", "programme": "cards"},
    "conference-programme": {"name": "Conference Programme", "description": "Schedule-first · Structured · Practical", "hero": "compact", "programme": "agenda"},
    "split-visual": {"name": "Split Visual", "description": "Editorial · Visual · Informative", "hero": "split", "programme": "timeline"},
    "immersive": {"name": "Immersive Inspirational", "description": "Atmospheric · Emotional · Full bleed", "hero": "immersive", "programme": "cards"},
    "programme-showcase": {"name": "Programme Showcase", "description": "Tracks-first · Colorful · Discoverable", "hero": "tracks", "programme": "agenda"},
    "elegant-countdown": {"name": "Elegant Countdown", "description": "Refined · Focused · Anticipatory", "hero": "countdown", "programme": "timeline"},
}
LEGACY_ALIASES = {"community": "modern-professional", "conference": "conference-programme", "celebration": "immersive"}
TEMPLATE_IDS = tuple(TEMPLATES)

def canonical_template(template_id: str) -> str:
    candidate = LEGACY_ALIASES.get(template_id, template_id)
    return candidate if candidate in TEMPLATES else "modern-professional"
