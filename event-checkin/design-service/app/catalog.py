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
        "layout": {"eventPage": "split-hero", "flyer": "photo-right-curved-divider", "guestHub": "card-dashboard", "pass": "premium-qr-card", "email": "branded-card"},
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
        "layout": {"eventPage": "stacked-bold", "flyer": "color-pop-stickers", "guestHub": "vibrant-cards", "pass": "color-qr-card", "email": "branded-card"},
        "free": True,
    },
    "classic": {
        "label": "Classic / Formal",
        "colors": {"background": "#FBF7F0", "surface": "#FFFFFF", "primary": "#1E3A5F", "accent": "#9C7A3C", "text": "#1E293B"},
        "fontPairing": "elegant-serif",
        "buttonStyle": "rounded",
        "layout": {"eventPage": "framed", "flyer": "framed-center-card", "guestHub": "formal", "pass": "formal-qr-card", "email": "branded-card"},
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

BIRTHDAY_FLYER_NAMES = {
    "luxury": ("birthday-luxury-gold", "Luxury Gold Birthday"),
    "festive": ("birthday-color-pop", "Color Pop Birthday"),
    "minimal": ("birthday-kids-fun", "Kids Fun Birthday"),
    "classic": ("birthday-elegant-milestone", "Elegant Milestone Birthday"),
    "photo-first": ("birthday-photo-first-celebration", "Photo-first Birthday Celebration"),
}

FLYER_LAYOUT_BY_STYLE = {
    "luxury": "photo-right-curved-divider",
    "festive": "color-pop-stickers",
    "minimal": "playful-photo-badge",
    "classic": "framed-center-card",
    "photo-first": "full-bleed-photo",
}

FLYER_LAYER_SETS = {
    "photo-right-curved-divider": [
        "background",
        "gold_curve",
        "photo_mask",
        "balloon_overlay",
        "gold_particles",
        "text_blocks",
        "rsvp_card",
        "contact_footer",
        "optional_qr",
    ],
    "color-pop-stickers": [
        "background",
        "color_shapes",
        "photo_cutout",
        "confetti_overlay",
        "text_blocks",
        "date_badges",
        "optional_qr",
        "footer_message",
    ],
    "playful-photo-badge": [
        "background",
        "soft_pattern",
        "photo_badge",
        "balloon_shapes",
        "text_blocks",
        "rsvp_strip",
        "optional_qr",
        "footer_message",
    ],
    "framed-center-card": [
        "background",
        "paper_card",
        "ornamental_frame",
        "photo_medallion",
        "text_blocks",
        "detail_rows",
        "optional_qr",
        "contact_footer",
    ],
    "full-bleed-photo": [
        "photo_background",
        "gradient_scrim",
        "decorative_overlay",
        "text_panel",
        "detail_badges",
        "optional_qr",
        "footer_message",
    ],
}

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
    "inviteLabel", "eventTitle", "eventSubtitle", "hostName", "date", "time", "venue", "address",
    "rsvpBy", "rsvpNote", "phone", "email", "dressCode", "admissionNote", "parkingNote",
    "customMessage", "footerMessage", "footerNote",
]


def _text_zones(extra_text: str | None) -> list[str]:
    zones = list(BASE_TEXT_ZONES)
    if extra_text and extra_text not in zones:
        zones.insert(3, extra_text)
    return zones


def _image_zones(layout: str) -> list[dict]:
    shape = {
        "photo-right-curved-divider": "curved-right-frame",
        "color-pop-stickers": "rounded-arch",
        "playful-photo-badge": "circle-badge",
        "framed-center-card": "oval-medallion",
        "full-bleed-photo": "full-bleed",
    }.get(layout, "rounded-frame")
    return [
        {
            "id": "main_photo",
            "label": "Main Photo",
            "required": layout in {"photo-right-curved-divider", "full-bleed-photo"},
            "shape": shape,
            "crop": "portrait",
            "controls": ["upload", "cropX", "cropY", "zoom"],
        },
        {"id": "cover_image", "label": "Cover Image", "required": False, "shape": "wide-cover", "crop": "wide"},
        {"id": "logo", "label": "Logo / Emblem", "required": False, "shape": "square", "crop": "square"},
    ]


def _flyer_definition(cat_key: str, cat: dict, style_key: str, colors: dict) -> dict:
    layout = FLYER_LAYOUT_BY_STYLE[style_key]
    tone = {
        "birthday": "celebration",
        "wedding": "romantic",
        "nikkah-aqdu": "elegant-faith",
        "gala": "black-tie",
        "banquet": "formal-dinner",
        "corporate": "executive",
        "community": "warm-community",
        "religious": "reverent",
        "memorial": "quiet-honor",
        "graduation": "achievement",
        "baby-shower": "soft-celebration",
        "naming-ceremony": "family-celebration",
    }.get(cat_key, "modern-event")
    return {
        "type": "flyer",
        "canvasSize": {"square": [1080, 1080], "story": [1080, 1920], "portrait": [1080, 1350], "a5": "148mm x 210mm", "a4": "210mm x 297mm"},
        "supportedSizes": list(FLYER_SIZES),
        "layout": layout,
        "tone": tone,
        "layers": FLYER_LAYER_SETS[layout],
        "imageZones": _image_zones(layout),
        "textZones": _text_zones(cat.get("extraText")),
        "fontStyle": {
            "headline": "script-plus-modern-sans" if style_key == "luxury" else STYLES[style_key]["fontPairing"],
            "body": "modern-sans",
        },
        "colors": colors,
        "qrPlacement": {"enabled": True, "positions": ["bottom-left", "bottom-right", "center-bottom"]},
        "decorations": {
            "balloons": cat_key in {"birthday", "baby-shower", "naming-ceremony"},
            "confetti": style_key in {"festive", "minimal"},
            "ornaments": style_key in {"luxury", "classic"},
            "softScrim": style_key == "photo-first",
        },
        "editableZones": [
            "background",
            "main_photo",
            "image_crop",
            "inviteLabel",
            "hostName",
            "eventTitle",
            "eventSubtitle",
            "date",
            "time",
            "venue",
            "address",
            "rsvpBy",
            "admissionNote",
            "phone",
            "email",
            "optional_qr",
            "footerMessage",
        ],
    }


def _family(cat_key: str, cat: dict, style_key: str, style: dict) -> dict:
    tpl_id = f"{cat_key}-{style_key}"
    name = f"{STYLE_NAME[style_key]} {cat['label']}"
    aliases: list[str] = []
    if cat_key == "birthday":
        tpl_id, name = BIRTHDAY_FLYER_NAMES[style_key]
        aliases.append(f"birthday-{style_key}")
    colors = dict(style["colors"])
    colors["accent"] = cat["accent"]  # occasion tint over the style base
    if cat_key == "birthday" and style_key == "luxury":
        colors.update({"background": "#050505", "surface": "#111111", "primary": "#D4AF37", "accent": "#F5C542", "text": "#FFFFFF"})
    text_zones = _text_zones(cat.get("extraText"))
    flyer_definition = _flyer_definition(cat_key, cat, style_key, colors)
    return {
        "id": tpl_id,
        "name": name,
        "aliases": aliases,
        "category": cat["label"],
        "categoryKey": cat_key,
        "style": style["label"],
        "styleKey": style_key,
        "type": "template-family",
        "isFree": style["free"],
        "surfaces": list(SURFACES),
        "supportedFlyerSizes": list(FLYER_SIZES),
        "supportedSizes": list(FLYER_SIZES),
        "defaultColors": colors,
        "fontPairing": style["fontPairing"],
        "layout": dict(style["layout"]),
        "layers": flyer_definition["layers"],
        "imageZones": flyer_definition["imageZones"],
        "textZones": text_zones,
        "qrPlacement": {"enabled": True, "positions": ["bottom-left", "bottom-right", "center-bottom"]},
        "flyerDefinition": flyer_definition,
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
    return next((t for t in build_catalog() if t["id"] == template_id or template_id in t.get("aliases", [])), None)


def default_template() -> dict:
    """The safe fallback family used when an event has no design selected."""
    return get_template("general-modern-minimal")
