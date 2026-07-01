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


def build_flyer_html(ctx: dict, size_key: str) -> str:
    """ctx: {colors, fontPairing, wording{...}, coverImageUrl, qr{enabled,position,data}}."""
    c = ctx.get("colors", {})
    bg = c.get("background", "#0B1220"); surface = c.get("surface", "#111827")
    primary = c.get("primary", "#D4AF37"); accent = c.get("accent", "#14B8A6")
    text = c.get("text", "#FFFFFF")
    font = _FONTS.get(ctx.get("fontPairing", "modern-sans"), _FONTS["modern-sans"])
    w = ctx.get("wording", {})
    cover = ctx.get("coverImageUrl")
    qr = ctx.get("qr", {}) or {}
    qr_pos = qr.get("position", "bottom-right")
    qr_img = qr_data_uri(qr["data"]) if qr.get("enabled") and qr.get("data") else None

    just = {"bottom-left": "flex-start", "bottom-right": "flex-end", "center-bottom": "center"}.get(qr_pos, "flex-end")
    cover_block = (
        f'<div class="cover" style="background-image:url({_esc(cover)})"></div>' if cover else ""
    )

    def row(label, value):
        return f'<div class="row"><span class="lbl">{label}</span><span class="val">{_esc(value)}</span></div>' if value else ""

    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:100%; height:100%; }}
body {{ font-family:{font}; color:{text}; background:{bg}; }}
.flyer {{ width:100%; height:100vh; display:flex; flex-direction:column;
  background:linear-gradient(160deg,{bg},{surface}); position:relative; overflow:hidden; }}
.cover {{ height:42%; background-size:cover; background-position:center; }}
.body {{ flex:1; padding:8% 9%; display:flex; flex-direction:column; }}
.kicker {{ text-transform:uppercase; letter-spacing:.28em; font-size:1.1em; font-weight:800; color:{accent}; }}
.title {{ font-size:4.4em; line-height:1.02; font-weight:900; color:{primary}; margin:.35em 0; }}
.host {{ font-size:1.7em; font-weight:700; color:{text}; opacity:.92; }}
.meta {{ margin-top:auto; display:flex; flex-direction:column; gap:.55em; }}
.row {{ display:flex; gap:.8em; font-size:1.35em; }}
.lbl {{ color:{accent}; font-weight:800; min-width:3.2em; }}
.val {{ color:{text}; opacity:.95; }}
.note {{ margin-top:1em; font-size:1.15em; color:{text}; opacity:.8; }}
.footer {{ display:flex; justify-content:{just}; align-items:flex-end; margin-top:1.4em; gap:1em; }}
.qr {{ width:150px; height:150px; background:#fff; padding:10px; border-radius:14px; }}
.qr img {{ width:100%; height:100%; }}
.rsvp {{ font-size:1.05em; color:{text}; opacity:.75; align-self:center; }}
</style></head><body>
<div class="flyer">
  {cover_block}
  <div class="body">
    <div class="kicker">You're invited</div>
    <div class="title">{_esc(w.get('eventTitle') or 'Your Event')}</div>
    <div class="host">{_esc(w.get('hostName'))}</div>
    <div class="meta">
      {row('When', ' · '.join(x for x in [w.get('date'), w.get('time')] if x))}
      {row('Where', w.get('venue'))}
      {row('', w.get('address'))}
      {f'<div class="note">{_esc(w.get("dressCode"))}</div>' if w.get('dressCode') else ''}
      {f'<div class="note">{_esc(w.get("admissionNote"))}</div>' if w.get('admissionNote') else ''}
      {f'<div class="note">{_esc(w.get("customMessage"))}</div>' if w.get('customMessage') else ''}
      <div class="footer">
        {f'<div class="qr"><img src="{qr_img}"/></div>' if qr_img else ''}
        {f'<div class="rsvp">{_esc(w.get("rsvpNote") or "Scan to RSVP")}</div>' if qr_img else ''}
      </div>
    </div>
  </div>
</div></body></html>"""


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
