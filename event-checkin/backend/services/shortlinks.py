"""Short redirect links, used to keep SMS bodies under the 160-char GSM-7
single-segment limit (see messaging.py's _brand_sms for why every SMS already
carries ~82 chars of fixed brand/compliance overhead before any content)."""
import logging
import secrets
from urllib.parse import urlsplit

from app.database import AsyncSessionLocal
from app.models import ShortLink

logger = logging.getLogger(__name__)


async def shorten_url(target_url: str) -> str:
    """Mint a short /api/s/{code} link redirecting to target_url, reusing
    target_url's own scheme+host (so a white-labeled/custom event domain
    still redirects through itself, not some other event's domain). Opens
    its own session — called from messaging.py's SMS senders, which run as
    background tasks with no request-scoped db session available. Falls back
    to the original URL if the write fails or the URL has no host, so a DB
    hiccup never blocks the SMS send outright (just makes it longer)."""
    parts = urlsplit(target_url)
    if not parts.scheme or not parts.netloc:
        return target_url
    code = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8]
    try:
        async with AsyncSessionLocal() as db:
            db.add(ShortLink(code=code, target_url=target_url))
            await db.commit()
    except Exception:
        logger.exception("shortlinks: failed to persist short link, using full URL")
        return target_url
    return f"{parts.scheme}://{parts.netloc}/api/s/{code}"


async def resolve_short_url(code: str) -> str | None:
    async with AsyncSessionLocal() as db:
        link = await db.get(ShortLink, code)
        return link.target_url if link else None
