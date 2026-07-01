"""Data-driven template catalog.

100 template families are *generated* from a 20-category × 5-style matrix layered
over shared per-style surface layouts and design tokens — not hand-authored. Each
family produces matching visuals for all five surfaces (event page, flyer, guest
hub, Festio Pass, email). Adding a category or style scales the catalog with no
new files.
"""
from functools import lru_cache

# ── Styles: base palette, fonts, layouts, button shape ────────────────────────
STYLES: dict[str, dict] = {
    "luxury": {
        "label": "Luxury / Premium",
        "colors": {"background": "#050816", "surface": "#111827", "primary": "#D4AF37", "accent": "#14B8A6", "text": "#FFFFFF"},
        "fontPairing": "classic-serif",
        "buttonStyle": "rounded",
        "layout": {"eventPage": "split-hero", "flyer": "photo-right-text-left", "guestHub": "card-dashboard", "pass": "premium-qr-card", "email": "branded-card"},
        "free": False,
    },
    "minimal": {
        "label": "Modern Minimal",
        "colors": {"background": "#FFFFFF", "surface": "#F8FAFC", "primary": "#0F172A", "accent": "#14B8A6", "text": "#0F172A"},
        "fontPairing": "modern-sans",
        "buttonStyle": "square",
        "layout": {"eventPage": "centered", "flyer": "text-center", "guestHub": "clean-list", "pass": "minimal-qr-card", "email": "simple"},
        "free": True,
    },
    "festive": {
        "label": "Colorful / Festive",
        "colors": {"background": "#1A0B2E", "surface": "#2D1B4E", "primary": "#F5C542", "accent": "#FF5CA2", "text": "#FFFFFF"},
        "fontPairing": "display-rounded",
        "buttonStyle": "pill",
        "layout": {"eventPage": "stacked-bold", "flyer": "full-color", "guestHub": "vibrant-cards", "pass": "color-qr-card", "email": "branded-card"},
        "free": True,
    },
    "classic": {
        "label": "Classic / Formal",
        "colors": {"background": "#FBF7F0", "surface": "#FFFFFF", "primary": "#1E3A5F", "accent": "#9C7A3C", "text": "#1E293B"},
        "fontPairing": "elegant-serif",
        "buttonStyle": "rounded",
        "layout": {"eventPage": "framed", "flyer": "centered-serif", "guestHub": "formal", "pass": "formal-qr-card", "email": "branded-card"},
        "free": False,
    },
    "photo-first": {
        "label": "Photo-first / Flyer-first",
        "colors": {"background": "#0B1220", "surface": "#111827", "primary": "#FFFFFF", "accent": "#14B8A6", "text": "#FFFFFF"},
        "fontPairing": "bold-sans",
        "buttonStyle": "pill",
        "layout": {"eventPage": "photo-hero", "flyer": "full-photo", "guestHub": "photo-header", "pass": "photo-qr-card", "email": "photo-header"},
        "free": False,
    },
}
# Human-friendly leading adjective per style, used to name each family.
STYLE_NAME = {"luxury": "Luxury", "minimal": "Modern Minimal", "festive": "Festive", "classic": "Classic", "photo-first": "Photo"}

# ── Categories: label, an accent colour that overrides the style accent, and an
#    optional extra text zone specific to that occasion. ────────────────────────
CATEGORIES: dict[str, dict] = {
    "birthday":         {"label": "Birthday",         "accent": "#FF7A45", "extraText": "celebrantName"},
    "wedding":          {"label": "Wedding",          "accent": "#E8B4B8", "extraText": "coupleNames"},
    "nikkah-aqdu":      {"label": "Nikkah / Aqdu",    "accent": "#0E7C5A", "extraText": "coupleNames"},
    "gala":             {"label": "Gala",             "accent": "#C9A227", "extraText": "honoreeName"},
    "banquet":          {"label": "Banquet",          "accent": "#B45309", "extraText": None},
    "corporate":        {"label": "Corporate Event",  "accent": "#2563EB", "extraText": "companyName"},
    "conference":       {"label": "Conference",       "accent": "#0EA5E9", "extraText": "companyName"},
    "seminar":          {"label": "Seminar",          "accent": "#0891B2", "extraText": "speakerName"},
    "fundraiser":       {"label": "Fundraiser",       "accent": "#DB2777", "extraText": "causeName"},
    "award-night":      {"label": "Award Night",      "accent": "#7C3AED", "extraText": "honoreeName"},
    "community":        {"label": "Community Event",  "accent": "#16A34A", "extraText": None},
    "religious":        {"label": "Religious Event",  "accent": "#0E7C5A", "extraText": None},
    "graduation":       {"label": "Graduation",       "accent": "#1D4ED8", "extraText": "graduateName"},
    "baby-shower":      {"label": "Baby Shower",      "accent": "#60A5FA", "extraText": "parentNames"},
    "naming-ceremony":  {"label": "Naming Ceremony",  "accent": "#F59E0B", "extraText": "childName"},
    "memorial":         {"label": "Memorial",         "accent": "#64748B", "extraText": "inMemoryOf"},
    "dinner-party":     {"label": "Dinner Party",     "accent": "#B91C1C", "extraText": "hostName"},
    "vip-private":      {"label": "VIP / Private Party", "accent": "#9333EA", "extraText": None},
    "concert-social":   {"label": "Concert / Social", "accent": "#EC4899", "extraText": "lineupName"},
    "general-modern":   {"label": "General Modern Event", "accent": "#14B8A6", "extraText": None},
}

FLYER_SIZES = ["square", "story", "portrait", "a5", "a4"]
SURFACES = ["event_page", "flyer", "guest_hub", "festio_pass", "email"]
BASE_TEXT_ZONES = [
    "eventTitle", "hostName", "date", "time", "venue", "address",
    "rsvpNote", "dressCode", "admissionNote", "parkingNote", "customMessage", "footerNote",
]


def _family(cat_key: str, cat: dict, style_key: str, style: dict) -> dict:
    tpl_id = f"{cat_key}-{style_key}"
    colors = dict(style["colors"])
    colors["accent"] = cat["accent"]  # occasion tint over the style base
    text_zones = list(BASE_TEXT_ZONES)
    if cat["extraText"] and cat["extraText"] not in text_zones:
        text_zones.insert(1, cat["extraText"])
    return {
        "id": tpl_id,
        "name": f"{STYLE_NAME[style_key]} {cat['label']}",
        "category": cat["label"],
        "categoryKey": cat_key,
        "style": style["label"],
        "styleKey": style_key,
        "isFree": style["free"],
        "surfaces": list(SURFACES),
        "supportedFlyerSizes": list(FLYER_SIZES),
        "defaultColors": colors,
        "fontPairing": style["fontPairing"],
        "layout": dict(style["layout"]),
        "imageZones": [
            {"id": "main_photo", "label": "Main Photo", "required": False, "crop": "portrait"},
            {"id": "cover_image", "label": "Cover Image", "required": False, "crop": "wide"},
            {"id": "logo", "label": "Logo / Emblem", "required": False, "crop": "square"},
        ],
        "textZones": text_zones,
        "qrPlacement": {"enabled": True, "positions": ["bottom-left", "bottom-right", "center-bottom"]},
        "buttonStyle": style["buttonStyle"],
        "coverImageRules": {"aspect": "wide", "recommended": "1600x900"},
        "thumbnailUrl": f"/design/templates/{tpl_id}/thumb.png",
    }


@lru_cache(maxsize=1)
def build_catalog() -> list[dict]:
    """All template families, generated deterministically (categories × styles)."""
    return [
        _family(ck, cv, sk, sv)
        for ck, cv in CATEGORIES.items()
        for sk, sv in STYLES.items()
    ]


def get_template(template_id: str) -> dict | None:
    return next((t for t in build_catalog() if t["id"] == template_id), None)


def default_template() -> dict:
    """The safe fallback family used when an event has no design selected."""
    return get_template("general-modern-minimal")
