"""Fail-closed publication gates for public invitations and queued event sends."""
import re
import unicodedata
from fastapi import HTTPException
from ..models import Organization

UNAVAILABLE = "Invitation unavailable. This invitation has been removed or is not available for public access."

# Confirmed incident indicator. Match host boundaries, including subdomains;
# never visit user-provided URLs to classify them.
CONFIRMED_PHISHING_HOST = re.compile(r"(?<![a-z0-9-])ndkskxkd\.com(?![a-z0-9.-])", re.I)

def invitation_content_blocked(value):
    normalized = unicodedata.normalize("NFKC", value or "")
    return bool(CONFIRMED_PHISHING_HOST.search(normalized))

def validate_invitation_content(value):
    if invitation_content_blocked(value):
        raise HTTPException(422, "This invitation contains a blocked destination. Remove it before saving or publishing.")

async def event_communications_blocked(event, db):
    if event is None:
        return True
    review = (event.setup_preferences or {}).get("abuse_review") or {}
    if review.get("status") == "blocked" or event.cancelled or invitation_content_blocked(event.invite_message):
        return True
    org = await db.get(Organization, event.org_id)
    return org is None or not org.is_active

async def require_safe_event_communications(event, db):
    if await event_communications_blocked(event, db):
        raise HTTPException(410, UNAVAILABLE)

async def require_public_invitation(event, db):
    # Abuse takes precedence over lifecycle text. Never echo attacker content,
    # destination links, account details or private moderation reasons.
    if await event_communications_blocked(event, db):
        raise HTTPException(410, UNAVAILABLE)
    if event.status == "ended":
        raise HTTPException(410, "This event has ended")
    if event.status != "active":
        raise HTTPException(404, UNAVAILABLE)
