"""Server-rendered Open Graph pages for public share links.

The frontend is a client-rendered SPA, so link-preview crawlers (WhatsApp,
Facebook, iMessage, Slack, Telegram, X/Twitter, LinkedIn, Discord, …) that do
NOT execute JavaScript only ever see the static generic tags in index.html.
This router returns a tiny HTML document with per-event og:/twitter: tags so a
shared RSVP/invite/registry link previews with the event's own name, date,
venue and cover image.

The proxy (proxy.conf) routes ONLY crawler user-agents for the public share
paths here — real browsers still get the SPA. Each page also carries a
client-side redirect to the canonical SPA URL so a human who somehow lands on
it is bounced straight into the app.
"""
import html as _html
from urllib.parse import urljoin

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event
from ..timeutil import to_event_local
from .invite import _get_public_event, _get_public_event_by_rsvp_token
from .registry import _event_by_token as _get_event_by_registry_token

router = APIRouter()

# Default social card shipped with the frontend (frontend/public/media/).
_DEFAULT_IMAGE = "/media/og-image.png"
_SITE_NAME = "Festio"


def _abs_url(base_url: str, value: str | None) -> str:
    """Resolve a possibly-relative asset path against the event's public base."""
    if not value:
        return ""
    value = str(value).strip()
    if value.startswith(("http://", "https://")):
        return value
    return urljoin((base_url or "").rstrip("/") + "/", value.lstrip("/"))


def _fmt_date(event: Event) -> str:
    local = to_event_local(event.event_date)
    if not local:
        return ""
    try:
        return local.strftime("%A, %B %-d, %Y")
    except ValueError:
        return local.strftime("%A, %B %d, %Y").replace(" 0", " ")


def _render(event: Event, *, title: str, description: str, canonical_path: str) -> HTMLResponse:
    """Build a minimal OG document for `event`. `canonical_path` is the SPA
    route (e.g. /rsvp/<token>) a human should be redirected to."""
    base = (event.checkin_base_url or "").rstrip("/")
    image = _abs_url(base, event.invite_cover_image) or _abs_url(base, _DEFAULT_IMAGE)
    canonical = f"{base}{canonical_path}"

    t = _html.escape(title)
    d = _html.escape(description)
    img = _html.escape(image)
    url = _html.escape(canonical)
    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{t}</title>
<meta name="description" content="{d}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="{_SITE_NAME}" />
<meta property="og:title" content="{t}" />
<meta property="og:description" content="{d}" />
<meta property="og:url" content="{url}" />
<meta property="og:image" content="{img}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{t}" />
<meta name="twitter:description" content="{d}" />
<meta name="twitter:image" content="{img}" />
<link rel="canonical" href="{url}" />
<meta http-equiv="refresh" content="0; url={url}" />
</head>
<body>
<p>Redirecting to <a href="{url}">{t}</a>…</p>
<script>location.replace({url!r});</script>
</body>
</html>"""
    return HTMLResponse(doc)


def _invite_copy(event: Event) -> tuple[str, str]:
    """(title, description) for an event invite/RSVP preview."""
    name = event.name or "You're invited"
    title = name
    bits = []
    if event.couples_name:
        bits.append(event.couples_name)
    date = _fmt_date(event)
    if date:
        bits.append(date)
    if event.venue_name:
        bits.append(event.venue_name)
    tail = " · ".join(bits)
    description = f"You're invited — tap to RSVP.{(' ' + tail) if tail else ''}"
    return title, description


@router.get("/rsvp/{rsvp_token}", response_class=HTMLResponse)
async def og_rsvp(rsvp_token: str, db: AsyncSession = Depends(get_db)):
    event = await _get_public_event_by_rsvp_token(rsvp_token, db)
    title, description = _invite_copy(event)
    return _render(event, title=title, description=description,
                   canonical_path=f"/rsvp/{rsvp_token}")


@router.get("/invite/{event_id}", response_class=HTMLResponse)
async def og_invite(event_id: str, db: AsyncSession = Depends(get_db)):
    event = await _get_public_event(event_id, db)
    title, description = _invite_copy(event)
    return _render(event, title=title, description=description,
                   canonical_path=f"/invite/{event_id}")


@router.get("/registry/{token}", response_class=HTMLResponse)
async def og_registry(token: str, db: AsyncSession = Depends(get_db)):
    event = await _get_event_by_registry_token(token, db)
    name = event.name or "Gift Registry"
    title = f"{name} — Gift Registry"
    parts = [p for p in (event.couples_name, event.venue_name) if p]
    tail = " · ".join(parts)
    description = f"See the gift registry and reserve a gift.{(' ' + tail) if tail else ''}"
    return _render(event, title=title, description=description,
                   canonical_path=f"/registry/{token}")
