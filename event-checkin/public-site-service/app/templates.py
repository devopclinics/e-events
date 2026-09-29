"""Presentation-only configuration for reusable public event-site templates."""

TEMPLATES = {
    "modern-professional": {"name": "Modern Professional", "description": "Professional · Bold · Conference", "hero": "overlay", "programme": "timeline", "section_order": "standard"},
    "clean-elegant": {"name": "Clean Elegant", "description": "Minimal · Premium · Editorial", "hero": "collage", "programme": "timeline", "section_order": "editorial"},
    "storytelling": {"name": "Image-focused Storytelling", "description": "Human · Warm · Immersive", "hero": "cinematic", "programme": "cards", "section_order": "story"},
    "bold-dynamic": {"name": "Bold & Dynamic", "description": "Energetic · Modern · High contrast", "hero": "angular", "programme": "timeline", "section_order": "standard"},
    "card-friendly": {"name": "Card-based Friendly", "description": "Approachable · Clear · Family friendly", "hero": "card", "programme": "cards", "section_order": "standard"},
    "conference-programme": {"name": "Conference Programme", "description": "Schedule-first · Structured · Practical", "hero": "compact", "programme": "agenda", "section_order": "programme-first"},
    "split-visual": {"name": "Split Visual", "description": "Editorial · Visual · Informative", "hero": "split", "programme": "timeline", "section_order": "editorial"},
    "immersive": {"name": "Immersive Inspirational", "description": "Atmospheric · Emotional · Full bleed", "hero": "immersive", "programme": "cards", "section_order": "story"},
    "programme-showcase": {"name": "Programme Showcase", "description": "Tracks-first · Colorful · Discoverable", "hero": "tracks", "programme": "agenda", "section_order": "tracks-first"},
    "elegant-countdown": {"name": "Elegant Countdown", "description": "Refined · Focused · Anticipatory", "hero": "countdown", "programme": "timeline", "section_order": "standard"},
}
LEGACY_ALIASES = {"community": "modern-professional", "conference": "conference-programme", "celebration": "immersive"}
TEMPLATE_IDS = tuple(TEMPLATES)

def canonical_template(template_id: str) -> str:
    candidate = LEGACY_ALIASES.get(template_id, template_id)
    return candidate if candidate in TEMPLATES else "modern-professional"
