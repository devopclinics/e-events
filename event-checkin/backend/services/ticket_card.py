"""Generate a styled MMS ticket card image that mirrors the in-app ticket design."""
import io
import textwrap
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.timeutil import to_event_local

_FONTS_DIR = Path(__file__).parent.parent / "fonts"

# ── colours ──────────────────────────────────────────────────────────────────
_BG_HEADER   = (7,  15, 33)
_BG_BODY     = (13, 23, 42)
_TEAL        = (20, 184, 166)
_TEAL_LIGHT  = (153, 246, 228)
_WHITE       = (255, 255, 255)
_GRAY_400    = (148, 163, 184)
_GRAY_300    = (203, 213, 225)
_BADGE_BG    = (215, 255, 247)
_BADGE_DOT   = (20, 184, 166)
_BADGE_TEXT  = (15, 118, 110)
_GREEN       = (16, 185, 129)
_GREEN_BG    = (6,  78,  59)
_GREEN_LIGHT = (167, 243, 208)


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = _FONTS_DIR / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def _text_w(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    return int(draw.textlength(text, font=font))


def _centered(draw: ImageDraw.ImageDraw, y: int, text: str, font, color, W: int):
    draw.text(((W - _text_w(draw, text, font)) / 2, y), text, font=font, fill=color)


def _dashed_line(draw: ImageDraw.ImageDraw, y: int, W: int, color=_GRAY_400):
    dash, gap, x = 8, 6, 24
    while x < W - 24:
        draw.line([(x, y), (min(x + dash, W - 24), y)], fill=color, width=1)
        x += dash + gap


def _wrap_lines(text: str, draw, font, max_w: int) -> list[str]:
    words = text.split()
    lines, current = [], ""
    for word in words:
        test = (current + " " + word).strip()
        if _text_w(draw, test, font) <= max_w:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def generate_ticket_card(
    *,
    event_name: str,
    couples_name: str = "",
    event_date: datetime | None = None,
    venue_name: str = "",
    venue_address: str = "",
    guest_first_name: str = "",
    guest_last_name: str = "",
    qr_png_bytes: bytes,
    admitted: bool = False,
    table_name: str = "",
    seat_number: str = "",
) -> bytes:
    W = 640
    QR_SIZE = 260
    PAD = 36

    # ── fonts ─────────────────────────────────────────────────────────────────
    f_tiny  = _font("Inter-Regular.ttf",   15)
    f_small = _font("Inter-Regular.ttf",   18)
    f_bold  = _font("Inter-Bold.ttf",      26)
    f_title = _font("Inter-ExtraBold.ttf", 34)
    f_guest = _font("Inter-ExtraBold.ttf", 30)
    f_badge = _font("Inter-Bold.ttf",      17)

    _tmp = Image.new("RGB", (W, 10))
    _d   = ImageDraw.Draw(_tmp)

    event_lines = _wrap_lines(event_name, _d, f_title, W - PAD * 2)
    venue_str   = ", ".join(filter(None, [venue_name, venue_address]))
    venue_lines = _wrap_lines(venue_str, _d, f_small, W - PAD * 2) if venue_str else []
    has_seat_info = admitted and (table_name or seat_number)

    header_h = (
        28
        + 36        # badge
        + 14
        + 18        # "QR CODE FOR"
        + 10
        + len(event_lines) * 44
        + (30 if couples_name else 0)
        + (30 if event_date else 0)
        + (len(venue_lines) * 26 + 8 if venue_lines else 0)
        + 28
    )
    body_h = (
        32
        + 20        # GUEST label
        + 8
        + 42        # guest name
        + 28
        + QR_SIZE + 24
        + 24
        + 36        # footer
        + 36
    )
    if admitted:
        body_h += 80
    if has_seat_info:
        body_h += 52

    H = header_h + 32 + body_h

    img  = Image.new("RGB", (W, H), _BG_HEADER)
    draw = ImageDraw.Draw(img)
    y    = 28

    # ── HEADER ────────────────────────────────────────────────────────────────
    if admitted:
        blabel, bfill, bdot, btxt = "Admitted", _GREEN_BG, _GREEN, _GREEN_LIGHT
    else:
        blabel, bfill, bdot, btxt = "Valid Ticket", _BADGE_BG, _BADGE_DOT, _BADGE_TEXT

    bw = _text_w(draw, blabel, f_badge) + 56
    bx = (W - bw) // 2
    draw.rounded_rectangle([bx, y, bx + bw, y + 36], radius=18, fill=bfill)
    draw.ellipse([bx + 14, y + 13, bx + 22, y + 21], fill=bdot)
    draw.text((bx + 28, y + 9), blabel, font=f_badge, fill=btxt)
    y += 52

    _centered(draw, y, "QR CODE FOR", f_tiny, _TEAL_LIGHT, W)
    y += 24

    for line in event_lines:
        _centered(draw, y, line, f_title, _WHITE, W)
        y += 44

    if couples_name:
        _centered(draw, y, couples_name, f_small, _GRAY_300, W)
        y += 30

    if event_date:
        _local_date = to_event_local(event_date) or event_date
        _centered(draw, y, _local_date.strftime("%A, %B %-d, %Y"), f_small, _GRAY_400, W)
        y += 30

    if venue_lines:
        for i, line in enumerate(venue_lines):
            prefix = "📍 " if i == 0 else "    "
            full = prefix + line
            fw = _text_w(draw, full, f_small)
            draw.text(((W - fw) // 2, y), full, font=f_small, fill=_TEAL)
            y += 26

    y += 8

    # ── TEAR LINE ─────────────────────────────────────────────────────────────
    notch_y = y
    draw.rectangle([0, notch_y, W, H], fill=_BG_BODY)
    r = 20
    draw.ellipse([-r, notch_y - r, r, notch_y + r],        fill=_BG_HEADER)
    draw.ellipse([W - r, notch_y - r, W + r, notch_y + r], fill=_BG_HEADER)
    _dashed_line(draw, notch_y + 1, W)

    # ── BODY ──────────────────────────────────────────────────────────────────
    y = notch_y + 32 + 24

    _centered(draw, y, "GUEST", f_tiny, _GRAY_400, W)
    y += 26

    guest_name = f"{guest_first_name} {guest_last_name}".strip()
    _centered(draw, y, guest_name, f_guest, _WHITE, W)
    y += 52

    if admitted:
        bp, bh = 24, 64
        draw.rounded_rectangle([bp, y, W - bp, y + bh], radius=14, fill=_GREEN_BG)
        cx, cy, cr = bp + 30, y + bh // 2, 11
        draw.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=_GREEN)
        draw.text((cx - 6, cy - 9), "✓", font=f_bold, fill=_WHITE)
        draw.text((bp + 52, y + 10), "Check-in Complete",          font=f_bold,  fill=_GREEN_LIGHT)
        draw.text((bp + 52, y + 36), f"Welcome, {guest_first_name}!", font=f_small, fill=_GREEN_LIGHT)
        y += bh + 16

    if has_seat_info:
        parts = []
        if table_name:
            parts.append(f"Table: {table_name}")
        if seat_number:
            parts.append(f"Seat: {seat_number}")
        _centered(draw, y, "  ·  ".join(parts), f_bold, _WHITE, W)
        y += 44

    # QR box
    qr_img     = Image.open(io.BytesIO(qr_png_bytes)).convert("RGBA")
    box_pad    = 18
    box_size   = QR_SIZE + box_pad * 2
    qr_box     = Image.new("RGB", (box_size, box_size), _WHITE)
    qr_resized = qr_img.resize((QR_SIZE, QR_SIZE), Image.NEAREST).convert("RGB")
    qr_box.paste(qr_resized, (box_pad, box_pad))
    mask = Image.new("L", (box_size, box_size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, box_size, box_size], radius=16, fill=255)
    qr_final = Image.new("RGB", (box_size, box_size), _BG_BODY)
    qr_final.paste(qr_box, (0, 0), mask)
    img.paste(qr_final, ((W - box_size) // 2, y))
    y += box_size + 24

    footer = "Show this code to the check-in official at the entrance."
    for line in _wrap_lines(footer, draw, f_small, W - PAD * 2):
        _centered(draw, y, line, f_small, _TEAL, W)
        y += 24

    out = io.BytesIO()
    img.convert("RGB").save(out, format="JPEG", quality=92)
    return out.getvalue()
