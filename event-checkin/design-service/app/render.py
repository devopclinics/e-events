"""Flyer rendering — structured HTML/CSS → PNG (social sizes) and PDF (print).

Not a drag-and-drop canvas: fixed template zones, editable text, replaceable
image, controlled colors + QR placement. Rendered headlessly with Playwright
(Chromium). Fonts use offline CSS stacks so rendering never depends on network.
"""
import base64
import html as _html
import io

import qrcode
from playwright.async_api import async_playwright

# PNG social sizes (px) and PDF print sizes (mm).
PNG_SIZES = {"square": (1080, 1080), "story": (1080, 1920), "portrait": (1080, 1350)}
PDF_SIZES = {"a5": ("148mm", "210mm"), "a4": ("210mm", "297mm")}

_FONTS = {
    "classic-serif":  'Georgia, "Times New Roman", serif',
    "elegant-serif":  '"Iowan Old Style", Georgia, serif',
    "modern-sans":    'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    "bold-sans":      '"Segoe UI", system-ui, Roboto, sans-serif',
    "display-rounded":'"Trebuchet MS", "Segoe UI", sans-serif',
}

_SCRIPT_FONT = '"Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive'


def qr_data_uri(data: str) -> str:
    qr = qrcode.QRCode(border=1, box_size=10)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _esc(v) -> str:
    return _html.escape(str(v)) if v else ""


def _css_url(v) -> str:
    return _html.escape(str(v), quote=True) if v else ""


def _text(w: dict, key: str, fallback: str = "") -> str:
    value = str(w.get(key) or "").strip()
    return value or fallback


def build_flyer_html(ctx: dict, size_key: str) -> str:
    """ctx: {template, colors, fontPairing, wording, coverImageUrl, imagePosition, qr}."""
    c = ctx.get("colors", {})
    bg = c.get("background", "#0B1220"); surface = c.get("surface", "#111827")
    primary = c.get("primary", "#D4AF37"); accent = c.get("accent", "#14B8A6")
    text = c.get("text", "#FFFFFF")
    tpl = ctx.get("template") or {}
    flyer_def = tpl.get("flyerDefinition") or {}
    layout = flyer_def.get("layout") or tpl.get("layout", {}).get("flyer") or "photo-right-curved-divider"
    layout_aliases = {
        "afroluxe": "framed-center-card",
        "arch": "framed-center-card",
        "botanical": "framed-center-card",
        "cinematic": "photo-right-curved-divider",
        "diagonal": "color-pop-stickers",
        "editorial": "full-bleed-photo",
        "full_photo": "full-bleed-photo",
        "full-photo": "full-bleed-photo",
        "futurist": "color-pop-stickers",
        "glass_card": "framed-center-card",
        "lux_card": "framed-center-card",
        "luxe_arches": "framed-center-card",
        "luxe_split": "photo-right-curved-divider",
        "magazine": "full-bleed-photo",
        "minimal": "text-center",
        "mono": "text-center",
        "neon": "color-pop-stickers",
        "postcard": "color-pop-stickers",
        "photo-first": "full-bleed-photo",
        "photo-first-birthday-celebration": "full-bleed-photo",
        "photo-wedding": "full-bleed-photo",
        "split_curve": "photo-right-curved-divider",
    }
    layout = layout_aliases.get(layout, layout)
    layout_class = "".join(ch if ch.isalnum() else "-" for ch in layout).strip("-")
    font = _FONTS.get(ctx.get("fontPairing", "modern-sans"), _FONTS["modern-sans"])
    w = ctx.get("wording", {})
    cover = ctx.get("coverImageUrl")
    position = ctx.get("imagePosition") or {}
    pos_x = int(position.get("x", 50))
    pos_y = int(position.get("y", 50))
    zoom = int(position.get("zoom", 115))
    rotate = int(position.get("rotate", 0))
    zone_scale = max(0.7, min(float(position.get("zoneScale", 100)) / 100, 1.6))
    zone_x = max(-60, min(int(position.get("boxX", 0)), 60))
    zone_y = max(-60, min(int(position.get("boxY", 0)), 60))
    qr = ctx.get("qr", {}) or {}
    qr_pos = qr.get("position", "bottom-right")
    qr_img = qr_data_uri(qr["data"]) if qr.get("enabled") and qr.get("data") else None
    try:
        text_scale = float(ctx.get("textScale", 1))
    except (TypeError, ValueError):
        text_scale = 1
    text_scale = max(0.8, min(text_scale, 1.45))

    just = {"bottom-left": "flex-start", "bottom-right": "flex-end", "center-bottom": "center"}.get(qr_pos, "flex-end")

    def row(icon, label, value):
        if not value:
            return ""
        return f'<div class="detail-row"><span class="detail-icon">{icon}</span><span><b>{label}</b><em>{_esc(value)}</em></span></div>'

    event_title = _text(w, "eventTitle", "Birthday")
    host = _text(w, "hostName")
    invite_label = _text(w, "inviteLabel", "You're invited to celebrate")
    subtitle = _text(w, "eventSubtitle", _text(w, "customMessage", "Join us for an evening of good vibes, great company, and memories in the making."))
    rsvp_by = _text(w, "rsvpBy", _text(w, "rsvpNote", "Kindly reply soon."))
    footer = _text(w, "footerMessage", _text(w, "footerNote", "I can't wait to celebrate with you."))
    phone = _text(w, "phone")
    email = _text(w, "email")
    contact = " · ".join(x for x in [phone, email] if x)
    photo_boost = 1.12 if rotate else 1
    photo_style = f"background-image:url('{_css_url(cover)}');background-position:{pos_x}% {pos_y}%;background-size:{zoom}% auto;transform:rotate({rotate}deg) scale({photo_boost});transform-origin:center;" if cover else ""
    full_bg_style = "background-image:linear-gradient(90deg, rgba(0,0,0,.76), rgba(0,0,0,.24));" if cover else ""

    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:100%; height:100%; }}
body {{ font-family:{font}; color:{text}; background:{bg}; }}
.flyer {{ --text-scale:{text_scale}; --photo-zone-scale:{zone_scale}; --photo-zone-x:{zone_x}%; --photo-zone-y:{zone_y}%; width:100vw; height:100vh; position:relative; overflow:hidden; background:linear-gradient(150deg,{bg},{surface}); isolation:isolate; }}
.flyer::before {{ content:""; position:absolute; inset:-12%; background:radial-gradient(circle at 16% 9%, {accent}34, transparent 25%), radial-gradient(circle at 94% 92%, {primary}38, transparent 32%); z-index:-3; }}
.flyer::after {{ content:""; position:absolute; inset:0; background:linear-gradient(90deg, rgba(255,255,255,.06), transparent 34%, rgba(255,255,255,.04)); mix-blend-mode:screen; z-index:-2; }}
.particle {{ position:absolute; width:14px; height:14px; border-radius:3px; background:{primary}; opacity:.86; transform:rotate(28deg); box-shadow:0 0 24px {primary}99; }}
.p1 {{ left:10%; top:5%; }} .p2 {{ left:54%; top:7%; width:9px; height:9px; }} .p3 {{ left:8%; bottom:18%; width:8px; height:8px; }} .p4 {{ right:8%; bottom:11%; width:18px; height:18px; }}
.balloon {{ position:absolute; border-radius:999px 999px 880px 880px; filter:drop-shadow(0 22px 20px rgba(0,0,0,.28)); opacity:.95; }}
.balloon.one {{ right:9%; top:4%; width:15%; height:13%; background:linear-gradient(145deg,{primary},#5b4209); }}
.balloon.two {{ right:2%; top:7%; width:13%; height:11%; background:linear-gradient(145deg,#111,#555); }}
.balloon.three {{ right:8%; bottom:6%; width:17%; height:14%; background:linear-gradient(145deg,{accent},#5b3007); }}
.photo-zone {{ position:absolute; overflow:hidden; background:linear-gradient(145deg, rgba(255,255,255,.1), rgba(255,255,255,.02)); background-repeat:no-repeat; }}
.photo-fill {{ position:absolute; inset:0; background-repeat:no-repeat; }}
.photo-placeholder {{ position:absolute; inset:0; display:grid; place-items:center; color:{text}; font-size:calc(2.9vh * var(--text-scale)); font-weight:900; text-align:center; padding:9%; opacity:.72; background:linear-gradient(145deg, rgba(255,255,255,.12), rgba(255,255,255,.03)); }}
.content {{ position:absolute; z-index:4; }}
.kicker {{ text-transform:uppercase; letter-spacing:.22em; font-size:calc(2.45vh * var(--text-scale)); font-weight:900; color:{text}; }}
.host {{ margin-top:.5vh; font-size:calc(3.6vh * var(--text-scale)); font-weight:800; color:{text}; }}
.title {{ margin-top:1.5vh; color:{primary}; font-size:calc(9.7vh * var(--text-scale)); line-height:.88; font-weight:900; letter-spacing:-.03em; }}
.script-title {{ font-family:{_SCRIPT_FONT}; font-weight:500; letter-spacing:0; text-shadow:0 0 20px {primary}44; }}
.subtitle {{ margin-top:3vh; max-width:82%; color:{text}; font-size:calc(2.45vh * var(--text-scale)); line-height:1.42; font-weight:700; text-transform:uppercase; letter-spacing:.06em; opacity:.94; }}
.details {{ margin-top:3.4vh; display:grid; gap:1.7vh; }}
.detail-row {{ display:grid; grid-template-columns:5.2vh 1fr; gap:1.5vh; align-items:center; color:{text}; font-size:calc(2.35vh * var(--text-scale)); }}
.detail-icon {{ width:4.8vh; height:4.8vh; display:grid; place-items:center; border-radius:1.2vh; background:{primary}; color:{bg}; font-size:calc(2.7vh * var(--text-scale)); font-weight:900; }}
.detail-row b {{ display:block; color:{primary}; font-size:calc(1.65vh * var(--text-scale)); text-transform:uppercase; letter-spacing:.18em; }}
.detail-row em {{ display:block; margin-top:.25vh; font-style:normal; font-weight:900; line-height:1.24; }}
.rsvp-card {{ margin-top:3.2vh; width:50%; min-height:11vh; display:grid; align-content:center; border:1px solid {primary}; border-radius:1.4vh; background:linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.02)); padding:2vh 2.4vh; box-shadow:0 20px 50px rgba(0,0,0,.28); }}
.rsvp-card strong {{ display:block; color:{primary}; font-size:calc(5.9vh * var(--text-scale)); line-height:.9; letter-spacing:.14em; }}
.rsvp-card span {{ display:block; margin-top:1.2vh; color:{text}; font-size:calc(1.95vh * var(--text-scale)); line-height:1.28; text-transform:uppercase; letter-spacing:.09em; }}
.contact {{ margin-top:1.9vh; max-width:calc(100% - 18vh); color:{text}; font-size:calc(2.05vh * var(--text-scale)); font-weight:700; opacity:.9; }}
.footer-copy {{ margin-top:1.7vh; width:min(70%, calc(100% - 18vh)); color:{primary}; font-family:{_SCRIPT_FONT}; font-size:calc(3.2vh * var(--text-scale)); line-height:1.05; text-align:center; }}
.qr-wrap {{ position:absolute; z-index:6; bottom:4.4%; display:flex; justify-content:{just}; width:100%; padding:0 7%; pointer-events:none; }}
.qr {{ width:14vh; height:14vh; background:#fff; padding:1.1vh; border-radius:1.2vh; box-shadow:0 24px 46px rgba(0,0,0,.34); }}
.qr img {{ width:100%; height:100%; display:block; }}
.photo-right-curved-divider .photo-zone {{ right:-4%; top:0; width:48%; height:100%; border-radius:48% 0 0 48% / 50% 0 0 50%; border-left:.55vh solid {primary}; box-shadow:-24px 0 40px rgba(0,0,0,.38); transform:translate(var(--photo-zone-x), var(--photo-zone-y)) scale(var(--photo-zone-scale)); transform-origin:center right; }}
.photo-right-curved-divider .photo-fill {{ {photo_style} }}
.photo-right-curved-divider .content {{ left:7.5%; top:5%; width:52%; height:87%; }}
.photo-right-curved-divider .title {{ font-size:calc(10.6vh * var(--text-scale)); }}
.color-pop-stickers {{ background:linear-gradient(145deg,{bg},{surface}); }}
.color-pop-stickers .photo-zone {{ right:7%; top:9%; width:36%; height:34%; border-radius:5vh; transform:translate(var(--photo-zone-x), var(--photo-zone-y)) rotate(3deg) scale(var(--photo-zone-scale)); transform-origin:center; border:.8vh solid #fff; box-shadow:0 24px 60px rgba(0,0,0,.28); }}
.color-pop-stickers .photo-fill {{ {photo_style} }}
.color-pop-stickers .content {{ left:7%; right:7%; top:9%; bottom:7%; }}
.color-pop-stickers .title {{ max-width:58%; font-size:calc(10.1vh * var(--text-scale)); }}
.color-pop-stickers .subtitle {{ max-width:52%; }}
.color-pop-stickers .details {{ width:58%; }}
.color-pop-stickers .rsvp-card {{ width:42%; background:{primary}; color:{bg}; border:0; }} .color-pop-stickers .rsvp-card strong,.color-pop-stickers .rsvp-card span {{ color:{bg}; }}
.playful-photo-badge {{ background:radial-gradient(circle at 20% 20%, {accent}33, transparent 22%), linear-gradient(135deg,{bg},{surface}); }}
.playful-photo-badge .photo-zone {{ right:8%; top:8%; width:34%; height:27%; border-radius:999px; border:.9vh solid {primary}; box-shadow:0 28px 70px rgba(0,0,0,.2); transform:translate(var(--photo-zone-x), var(--photo-zone-y)) scale(var(--photo-zone-scale)); transform-origin:center; }}
.playful-photo-badge .photo-fill {{ {photo_style} }}
.playful-photo-badge .content {{ left:8%; right:8%; top:11%; bottom:8%; text-align:left; }}
.playful-photo-badge .title {{ max-width:58%; color:{primary}; }}
.playful-photo-badge .subtitle {{ max-width:58%; text-transform:none; letter-spacing:0; }}
.playful-photo-badge .rsvp-card {{ width:56%; border:0; background:{accent}; }} .playful-photo-badge .rsvp-card strong,.playful-photo-badge .rsvp-card span {{ color:{bg}; }}
.framed-center-card {{ background:{bg}; }}
.framed-center-card .photo-zone {{ left:50%; top:8%; width:28%; height:20%; transform:translateX(-50%) translate(var(--photo-zone-x), var(--photo-zone-y)) scale(var(--photo-zone-scale)); transform-origin:center; border-radius:999px; border:.55vh solid {primary}; box-shadow:0 20px 48px rgba(0,0,0,.18); }}
.framed-center-card .photo-fill {{ {photo_style} }}
.framed-center-card .content {{ left:9%; right:9%; top:7%; bottom:7%; display:flex; flex-direction:column; align-items:center; text-align:center; padding:4%; border:.25vh solid {primary}; background:linear-gradient(180deg, rgba(255,255,255,.84), rgba(255,255,255,.65)); color:{text}; }}
.framed-center-card .kicker,.framed-center-card .host,.framed-center-card .subtitle,.framed-center-card .detail-row,.framed-center-card .contact {{ color:{text}; }}
.framed-center-card .title {{ margin-top:22%; font-size:calc(8.6vh * var(--text-scale)); }}
.framed-center-card .subtitle {{ max-width:70%; text-transform:none; letter-spacing:0; }}
.framed-center-card .details {{ width:72%; }}
.framed-center-card .rsvp-card {{ width:44%; }}
.framed-center-card .footer-copy {{ width:70%; max-width:70%; color:{primary}; }}
.full-bleed-photo {{ {full_bg_style} background-repeat:no-repeat; }}
.full-bleed-photo .photo-zone {{ display:block; inset:0; border:0; border-radius:0; transform:translate(var(--photo-zone-x), var(--photo-zone-y)) scale(var(--photo-zone-scale)); transform-origin:center; z-index:-1; }}
.full-bleed-photo .photo-fill {{ {photo_style} opacity:.78; }}
.full-bleed-photo .content {{ left:7%; right:7%; bottom:7%; top:auto; min-height:50%; padding:4.5%; border-radius:4vh; background:linear-gradient(145deg, rgba(0,0,0,.68), rgba(0,0,0,.32)); backdrop-filter:blur(4px); }}
.full-bleed-photo .title {{ font-size:calc(9.7vh * var(--text-scale)); }}
.full-bleed-photo .subtitle {{ max-width:82%; }}
.full-bleed-photo .rsvp-card {{ width:40%; }}
@media (max-aspect-ratio: 3/4) {{
  .photo-right-curved-divider .photo-zone {{ width:54%; }}
  .photo-right-curved-divider .content {{ width:58%; }}
  .title {{ font-size:calc(7.8vh * var(--text-scale)); }}
  .script-title {{ font-size:calc(8.4vh * var(--text-scale)); }}
  .rsvp-card {{ width:64%; }}
}}
</style></head><body>
<div class="flyer {layout_class}">
  <span class="particle p1"></span><span class="particle p2"></span><span class="particle p3"></span><span class="particle p4"></span>
  <span class="balloon one"></span><span class="balloon two"></span><span class="balloon three"></span>
  <div class="photo-zone">
    {f'<div class="photo-fill"></div>' if cover else '<div class="photo-placeholder">Upload<br>Main Photo</div>'}
  </div>
  <main class="content">
    <div class="kicker">{_esc(invite_label)}</div>
    {f'<div class="host">{_esc(host)}</div>' if host else ''}
    <h1 class="title script-title">{_esc(event_title)}</h1>
    {f'<p class="subtitle">{_esc(subtitle)}</p>' if subtitle else ''}
    <section class="details">
      {row('▣', 'Date', w.get('date'))}
      {row('◷', 'Time', w.get('time'))}
      {row('⌖', 'Venue', w.get('venue'))}
      {row('⌁', 'Address', w.get('address'))}
    </section>
    <section class="rsvp-card"><strong>RSVP</strong><span>{_esc(rsvp_by)}</span></section>
    {f'<p class="contact">{_esc(contact)}</p>' if contact else ''}
    {f'<div class="footer-copy">{_esc(footer)}</div>' if footer else ''}
  </main>
  {f'<div class="qr-wrap"><div class="qr"><img alt="RSVP QR code" src="{qr_img}"/></div></div>' if qr_img else ''}
</div></body></html>"""


async def render_html_pdf(html: str, width: str = "1200px", height: str = "800px", landscape: bool = True, timeout_s: int = 30) -> bytes:
    """Render arbitrary self-contained HTML to a PDF (used for the floor plan)."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        try:
            page = await browser.new_page()
            await page.set_content(html, wait_until="load", timeout=timeout_s * 1000)
            return await page.pdf(width=width, height=height, landscape=landscape, print_background=True)
        finally:
            await browser.close()


async def render_flyer(ctx: dict, size_key: str, fmt: str, timeout_s: int = 30) -> bytes:
    """Render the flyer. fmt='png' for social sizes, 'pdf' for a5/a4."""
    html = build_flyer_html(ctx, size_key)
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        try:
            if fmt == "pdf":
                width, height = PDF_SIZES.get(size_key, PDF_SIZES["a5"])
                page = await browser.new_page()
                await page.set_content(html, wait_until="load", timeout=timeout_s * 1000)
                return await page.pdf(width=width, height=height, print_background=True)
            w, h = PNG_SIZES.get(size_key, PNG_SIZES["portrait"])
            page = await browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            await page.set_content(html, wait_until="load", timeout=timeout_s * 1000)
            return await page.screenshot(clip={"x": 0, "y": 0, "width": w, "height": h})
        finally:
            await browser.close()
