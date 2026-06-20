#!/usr/bin/env python3
from pathlib import Path
import textwrap

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "public" / "media"
OUT = MEDIA / "eventqr-intro.pdf"
OUT_VERSIONED = MEDIA / "eventqr-intro-target-audience.pdf"

W, H = 1600, 1131
M = 84

INK = "#0f172a"
MUTED = "#64748b"
SUBTLE = "#e2e8f0"
TEAL = "#0f766e"
TEAL_2 = "#14b8a6"
TEAL_SOFT = "#ccfbf1"
WHITE = "#ffffff"
BG = "#f8fafc"
VIOLET = "#6d28d9"
AMBER = "#d97706"
GREEN = "#16a34a"


def font(name, size):
    base = Path("/usr/share/fonts/truetype/noto")
    return ImageFont.truetype(str(base / name), size)


F = {
    "display": font("NotoSansDisplay-Bold.ttf", 74),
    "h1": font("NotoSansDisplay-Bold.ttf", 58),
    "h2": font("NotoSansDisplay-Bold.ttf", 40),
    "h3": font("NotoSans-Bold.ttf", 28),
    "body": font("NotoSans-Regular.ttf", 23),
    "body_b": font("NotoSans-Bold.ttf", 23),
    "small": font("NotoSans-Regular.ttf", 18),
    "small_b": font("NotoSans-Bold.ttf", 18),
    "tiny_b": font("NotoSans-Bold.ttf", 15),
}


def page(bg=WHITE):
    return Image.new("RGB", (W, H), bg)


def draw_text(draw, xy, text, fnt, fill=INK, width=None, line_gap=8):
    x, y = xy
    if not width:
        draw.text((x, y), text, font=fnt, fill=fill)
        return y + fnt.getbbox(text)[3] - fnt.getbbox(text)[1]

    avg = max(1, int(width / (fnt.size * 0.56)))
    lines = []
    for part in str(text).split("\n"):
        lines.extend(textwrap.wrap(part, width=avg) or [""])
    for line in lines:
        draw.text((x, y), line, font=fnt, fill=fill)
        y += fnt.size + line_gap
    return y


def label(draw, x, y, text, fill=TEAL, bg=TEAL_SOFT):
    pad_x, pad_y = 14, 8
    bbox = draw.textbbox((0, 0), text.upper(), font=F["tiny_b"])
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.rounded_rectangle((x, y, x + w + pad_x * 2, y + h + pad_y * 2), radius=999, fill=bg)
    draw.text((x + pad_x, y + pad_y - 1), text.upper(), font=F["tiny_b"], fill=fill)
    return x + w + pad_x * 2


def footer(draw, n):
    draw.line((M, H - 62, W - M, H - 62), fill="#e5e7eb", width=2)
    draw.text((M, H - 43), "EventQR - Introductory Guide", font=F["small"], fill=MUTED)
    txt = f"{n:02d}"
    bbox = draw.textbbox((0, 0), txt, font=F["small_b"])
    draw.text((W - M - (bbox[2] - bbox[0]), H - 43), txt, font=F["small_b"], fill=TEAL)


def rounded_paste(canvas, img, box, radius=28, shadow=True):
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    img = ImageOps.contain(img.convert("RGB"), (bw, bh), Image.Resampling.LANCZOS)
    ix = x1 + (bw - img.width) // 2
    iy = y1 + (bh - img.height) // 2

    if shadow:
        sh = Image.new("RGBA", (img.width + 36, img.height + 36), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        sd.rounded_rectangle((18, 18, img.width + 18, img.height + 18), radius=radius, fill=(15, 23, 42, 70))
        sh = sh.filter(ImageFilter.GaussianBlur(14))
        canvas.paste(sh, (ix - 18, iy - 10), sh)

    mask = Image.new("L", img.size, 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, img.width, img.height), radius=radius, fill=255)
    canvas.paste(img, (ix, iy), mask)
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((ix, iy, ix + img.width, iy + img.height), radius=radius, outline=SUBTLE, width=3)


def img(name):
    return Image.open(MEDIA / name)


def browser_frame(canvas, image_name, box, caption=None):
    x1, y1, x2, y2 = box
    bar = 46
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((x1, y1, x2, y2), radius=34, fill="#ffffff", outline=SUBTLE, width=3)
    d.rounded_rectangle((x1, y1, x2, y1 + bar), radius=34, fill="#f1f5f9")
    d.rectangle((x1, y1 + bar - 18, x2, y1 + bar), fill="#f1f5f9")
    for i, c in enumerate(["#ef4444", "#f59e0b", "#22c55e"]):
        d.ellipse((x1 + 24 + i * 26, y1 + 17, x1 + 38 + i * 26, y1 + 31), fill=c)
    rounded_paste(canvas, img(image_name), (x1 + 18, y1 + bar + 18, x2 - 18, y2 - 18), radius=18, shadow=False)
    if caption:
        draw_text(d, (x1, y2 + 16), caption, F["small"], MUTED, width=x2 - x1)


def feature_card(draw, box, title, body, color=TEAL):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, radius=18, fill=WHITE, outline=SUBTLE, width=2)
    draw.rounded_rectangle((x1 + 24, y1 + 24, x1 + 66, y1 + 66), radius=12, fill=color)
    draw.text((x1 + 38, y1 + 27), "+", font=F["h3"], fill=WHITE)
    title_bottom = draw_text(draw, (x1 + 84, y1 + 25), title, F["body_b"], INK, width=x2 - x1 - 110)
    body_y = max(y1 + 84, title_bottom + 12)
    draw_text(draw, (x1 + 24, body_y), body, F["small"], MUTED, width=x2 - x1 - 48, line_gap=6)


def cover():
    p = page(BG)
    d = ImageDraw.Draw(p)
    d.rectangle((0, 0, W, 320), fill=INK)
    d.rectangle((0, 320, W, H), fill=BG)
    label(d, M, 82, "introductory guide", WHITE, TEAL)
    draw_text(d, (M, 135), "EventQR", F["display"], WHITE)
    draw_text(d, (M, 226), "Invitations, RSVPs, QR check-in, and live event operations in one app.", F["body"], "#cbd5e1", width=660)
    title_bottom = draw_text(d, (M, 420), "Built for organizers who need a clean guest list, reliable entry, and real-time visibility on event day.", F["h2"], INK, width=650, line_gap=10)
    draw_text(d, (M, title_bottom + 26), "Use this short PDF to understand the end-to-end workflow before creating your first event.", F["body"], MUTED, width=575)
    audience_y = title_bottom + 145
    d.rounded_rectangle((M, audience_y, M + 590, audience_y + 238), radius=24, fill=WHITE, outline=SUBTLE, width=2)
    draw_text(d, (M + 28, audience_y + 26), "Target audience", F["body_b"], INK)
    audience = [
        "Event planners and professional organizers",
        "Hall owners, venues, and event centers",
        "Caterers, waiter services, and hospitality teams",
        "Companies running launches, conferences, and staff events",
    ]
    y = audience_y + 76
    for item in audience:
        d.ellipse((M + 30, y + 9, M + 44, y + 23), fill=TEAL_2)
        y = draw_text(d, (M + 62, y), item, F["small"], MUTED, width=490, line_gap=5) + 6
    browser_frame(p, "help-event-setup.png", (825, 112, 1498, 690))
    browser_frame(p, "help-guest-invite.png", (720, 690, 1390, 1040))
    footer(d, 1)
    return p


def workflow():
    p = page()
    d = ImageDraw.Draw(p)
    label(d, M, 78, "how it works")
    title_bottom = draw_text(d, (M, 125), "From guest list to the door", F["h1"], INK)
    draw_text(d, (M, title_bottom + 22), "EventQR keeps the event lifecycle in one workspace, so your team is not stitching together spreadsheets, messaging apps, and paper lists.", F["body"], MUTED, width=930)
    steps = [
        ("1", "Create event", "Set name, host, date, slug, and status."),
        ("2", "Add guests", "Import a spreadsheet or sync from a shared sheet."),
        ("3", "Invite and RSVP", "Send personal links by email, SMS, or WhatsApp."),
        ("4", "Check in", "Scan QR tickets from any phone browser."),
        ("5", "Review results", "Track RSVPs, arrivals, occupancy, and orders."),
    ]
    x, y = M, 340
    for n, title, body in steps:
        d.rounded_rectangle((x, y, x + 250, y + 255), radius=24, fill="#f8fafc", outline=SUBTLE, width=2)
        d.ellipse((x + 24, y + 24, x + 82, y + 82), fill=TEAL)
        d.text((x + 43, y + 33), n, font=F["body_b"], fill=WHITE)
        title_bottom = draw_text(d, (x + 24, y + 104), title, F["h3"], INK, width=200)
        draw_text(d, (x + 24, title_bottom + 14), body, F["small"], MUTED, width=205, line_gap=6)
        x += 285
    browser_frame(p, "help-guests.png", (M, 680, 735, 985), "Guest management: import, search, RSVP status, ticket type, and check-in record.")
    browser_frame(p, "help-results.png", (820, 680, W - M, 985), "Results: live counts, RSVP breakdown, check-in timing, and operational summaries.")
    footer(d, 2)
    return p


def setup_invites():
    p = page(BG)
    d = ImageDraw.Draw(p)
    label(d, M, 78, "organizer setup")
    draw_text(d, (M, 125), "Create the event, then invite the right people", F["h1"], INK, width=720)
    bullets = [
        ("Event workspace", "Each event has its own guests, invite settings, features, and team permissions."),
        ("Flexible import", "Upload CSV/Excel-style guest files or use shared sheet links for repeat sync."),
        ("Invite page", "Guests can RSVP, answer custom questions, choose orders, and receive a personal QR ticket."),
        ("Private or shared links", "Use one public event link or personal invite links when forwarding needs control."),
    ]
    y = 320
    for title, body in bullets:
        d.rounded_rectangle((M, y, 690, y + 118), radius=18, fill=WHITE, outline=SUBTLE, width=2)
        d.ellipse((M + 28, y + 36, M + 58, y + 66), fill=TEAL_2)
        draw_text(d, (M + 82, y + 24), title, F["body_b"], INK, width=520)
        draw_text(d, (M + 82, y + 61), body, F["small"], MUTED, width=520, line_gap=5)
        y += 140
    browser_frame(p, "help-invites-rsvp.png", (775, 92, W - M, 970), "Invite and RSVP setup with deadlines, approval, custom questions, cover image, and preview.")
    footer(d, 3)
    return p


def checkin():
    p = page()
    d = ImageDraw.Draw(p)
    label(d, M, 78, "event day")
    title_bottom = draw_text(d, (M, 125), "Fast QR admission from any phone", F["h1"], INK, width=700)
    draw_text(d, (M, title_bottom + 22), "Staff open the Check-in page, choose a gate or area, start the camera, and scan each guest's QR ticket. Results are immediate: admitted, already admitted, or denied by rule.", F["body"], MUTED, width=670)
    feature_card(d, (M, 425, 500, 615), "No app install", "The scanner runs in a mobile browser, which keeps event-day setup simple.", TEAL)
    feature_card(d, (M + 440, 425, M + 856, 615), "Access rules", "Paid events can enforce ticket types, zones, gates, and venue capacity.", VIOLET)
    feature_card(d, (M, 655, 500, 845), "Live feedback", "Green, yellow, and red outcomes help staff act quickly at the door.", GREEN)
    feature_card(d, (M + 440, 655, M + 856, 845), "Team roles", "Admins manage the event; staff get focused access to check-in and results.", AMBER)
    browser_frame(p, "help-check-in.png", (1000, 130, W - M, 995), "Check-in page: camera scanning, manual lookup, recent scans, and gate context.")
    footer(d, 4)
    return p


def operations():
    p = page(BG)
    d = ImageDraw.Draw(p)
    label(d, M, 78, "paid operations")
    title_bottom = draw_text(d, (M, 125), "Add the tools your event actually needs", F["h1"], INK, width=800)
    draw_text(d, (M, title_bottom + 22), "Event Passes unlock the higher-touch workflows that matter for formal events, venues, teams, vendors, and multi-zone entry.", F["body"], MUTED, width=820)
    cards = [
        ("Seating and orders", "Assign tables, collect meal or item choices, and give staff a live orders view.", "help-orders-view.png"),
        ("Entry areas", "Control who can enter VIP, backstage, or other areas using ticket rules and tags.", "help-entry-areas.png"),
        ("Deliveries", "Collect addresses and manage packing, shipping, or gift delivery by guest.", "help-deliveries.png"),
        ("Gift list", "Coordinate gift items or cash funds without duplicate claims.", "help-gift-list.png"),
    ]
    positions = [(M, 380), (830, 380), (M, 720), (830, 720)]
    for (title, body, image), (x, y) in zip(cards, positions):
        d.rounded_rectangle((x, y, x + 680, y + 300), radius=24, fill=WHITE, outline=SUBTLE, width=2)
        rounded_paste(p, img(image), (x + 26, y + 24, x + 310, y + 218), radius=16, shadow=False)
        draw_text(d, (x + 335, y + 40), title, F["h3"], INK, width=300)
        draw_text(d, (x + 335, y + 92), body, F["small"], MUTED, width=300, line_gap=6)
    footer(d, 5)
    return p


def team_billing():
    p = page()
    d = ImageDraw.Draw(p)
    label(d, M, 78, "access and pricing")
    title_bottom = draw_text(d, (M, 125), "Simple roles. Simple event passes.", F["h1"], INK, width=780)
    draw_text(d, (M, title_bottom + 22), "Start free for small email-only events. Upgrade per event when you need QR check-in, SMS/WhatsApp delivery, more guests, or advanced operations.", F["body"], MUTED, width=770)
    feature_card(d, (M, 410, 505, 620), "Free tier", "Up to 25 guests, email invitations, self-serve RSVP, and custom questions.", TEAL)
    feature_card(d, (M + 445, 410, M + 866, 620), "Event Pass", "Unlock QR check-in, message credits, seating, orders, access zones, logistics, and registry.", VIOLET)
    feature_card(d, (M, 670, 505, 880), "Team access", "Assign admins, staff, and read-only order access to the right event.", GREEN)
    feature_card(d, (M + 445, 670, M + 866, 880), "Message credits", "Top up credits for SMS and WhatsApp broadcasts or personal invite sends.", AMBER)
    browser_frame(p, "help-team.png", (1010, 110, W - M, 555), "Team permissions and event assignment.")
    browser_frame(p, "help-event-pass.png", (940, 610, W - M, 985), "Event Pass area with tiers and usage.")
    footer(d, 6)
    return p


def close():
    p = page(INK)
    d = ImageDraw.Draw(p)
    label(d, M, 90, "next step", INK, TEAL_SOFT)
    draw_text(d, (M, 150), "Run your first event in EventQR", F["display"], WHITE, width=850, line_gap=12)
    draw_text(d, (M, 350), "1. Create an account\n2. Create a draft event\n3. Import a small test guest list\n4. Send yourself an invite\n5. Activate the event and scan your ticket", F["h3"], "#dbeafe", width=700, line_gap=18)
    d.rounded_rectangle((M, 750, 690, 855), radius=20, fill=TEAL)
    draw_text(d, (M + 36, 779), "events.vsgs.io/register", F["h3"], WHITE)
    browser_frame(p, "help-guest-invite.png", (820, 150, W - M, 930), "Guest ticket page with RSVP details and QR access.")
    draw_text(d, (M, 980), "EventQR - invitations, RSVPs, QR check-in, and event operations.", F["body"], "#94a3b8", width=660)
    footer(d, 7)
    return p


def main():
    pages = [cover(), workflow(), setup_invites(), checkin(), operations(), team_billing(), close()]
    pages[0].save(OUT, save_all=True, append_images=pages[1:], resolution=150.0)
    pages[0].save(OUT_VERSIONED, save_all=True, append_images=pages[1:], resolution=150.0)
    print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    print(f"Wrote {OUT_VERSIONED} ({OUT_VERSIONED.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
