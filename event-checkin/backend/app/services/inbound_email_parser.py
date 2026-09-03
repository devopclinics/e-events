"""Provider-neutral normalization of direct and forwarded email messages."""
import hashlib
import html
import re
from dataclasses import dataclass, field
from email.utils import parseaddr

from services.templates import sanitize_html

from ..routers.guests import _normalize_phone


@dataclass(frozen=True)
class ExtractedIdentifier:
    kind: str
    value: str
    source: str
    confidence: str


@dataclass(frozen=True)
class InboundEmailNormalized:
    subject: str
    text: str
    sanitized_html: str | None
    sender: str | None
    original_sender: str | None
    recipients: list[str]
    identifiers: list[ExtractedIdentifier] = field(default_factory=list)
    relevant_headers: dict[str, str] = field(default_factory=dict)
    message_id: str | None = None
    fingerprint: str = ""


_LABELS = {
    "reference": re.compile(r"(?im)^\s*(?:festio\s+)?(?:guest|participant|attendee)\s+(?:id|reference)\s*:\s*([A-Za-z0-9_.:-]{6,160})\s*$"),
    "email": re.compile(r"(?im)^\s*(?:guest|participant|attendee)\s+email\s*:\s*([^\s<>]+@[^\s<>]+)\s*$"),
    "phone": re.compile(r"(?im)^\s*(?:guest|participant|attendee)\s+(?:phone|mobile)\s*:\s*([+()0-9 .-]{7,40})\s*$"),
    "name": re.compile(r"(?im)^\s*(?:guest|participant|attendee)\s+(?:name|full name)\s*:\s*([^\r\n]{2,255})\s*$"),
}
_FORWARDED_FROM = re.compile(
    r"(?im)^\s*(?:from|original sender)\s*:\s*(?:[^\r\n<]*<)?([^\s<>]+@[^\s<>]+)>?\s*$"
)
_COMPACT_FORWARDED_FROM = re.compile(
    r"(?i)\bfrom\s*:\s*(?:[^<\r\n]{0,160}<)?([^\s<>]+@[^\s<>]+)>"
)
_WAIVERSIGN_SUBJECT_NAME = re.compile(
    r"(?i)electronically-signed\s+document\s+for\s+(.+?)(?:\s+\([^)]+\))?\s*$"
)
_SAFE_HEADERS = {
    "from", "return-path", "reply-to", "resent-from", "x-original-sender",
    "message-id", "authentication-results", "received-spf",
}


def _address(value) -> str | None:
    parsed = parseaddr(str(value or ""))[1].strip().lower()
    return parsed or None


def _html_to_text(value: str) -> str:
    value = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", value)
    value = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", value)
    return html.unescape(re.sub(r"(?s)<[^>]+>", " ", value))


def normalize_received_email(raw: dict) -> InboundEmailNormalized:
    headers = {
        str(key).lower(): str(value)[:2000]
        for key, value in (raw.get("headers") or {}).items()
        if str(key).lower() in _SAFE_HEADERS
    }
    raw_html = str(raw.get("html") or "")
    sanitized = sanitize_html(raw_html)[:20000] if raw_html else None
    text = str(raw.get("text") or "")
    if not text and raw_html:
        text = _html_to_text(raw_html)
    text = text.replace("\x00", "")[:200000]
    sender = _address(raw.get("from"))
    original = _address(headers.get("x-original-sender") or headers.get("resent-from"))
    if not original and re.search(r"(?i)forwarded message|original message", text):
        # Nested forwards (for example provider -> organizer -> Festio) contain
        # multiple From lines. The deepest/last one is the original provider;
        # the first often repeats the authenticated transport sender.
        matches = _FORWARDED_FROM.findall(text) or _COMPACT_FORWARDED_FROM.findall(text)
        forwarded = [_address(value) for value in matches]
        original = next((value for value in reversed(forwarded) if value and value != sender), None)

    identifiers: list[ExtractedIdentifier] = []
    for match in _LABELS["reference"].finditer(text):
        identifiers.append(ExtractedIdentifier("reference", match.group(1).strip(), "labelled_reference", "high"))
    for match in _LABELS["email"].finditer(text):
        value = _address(match.group(1))
        if value:
            identifiers.append(ExtractedIdentifier("email", value, "labelled_guest_email", "high"))
    for match in _LABELS["phone"].finditer(text):
        value = _normalize_phone(match.group(1))
        if value:
            identifiers.append(ExtractedIdentifier("phone", value, "labelled_guest_phone", "high"))
    for match in _LABELS["name"].finditer(text):
        value = " ".join(match.group(1).split()).casefold()
        if value:
            identifiers.append(ExtractedIdentifier("name", value, "labelled_guest_name", "medium"))
    # WaiverSign completion notices put the participant name in the subject,
    # e.g. "Electronically-Signed Document for Test 3 User (33312)".
    # Treat this as medium-confidence only; matching still requires a unique
    # guest inside the token-selected event plus trusted-sender/rule checks.
    subject_name = _WAIVERSIGN_SUBJECT_NAME.search(str(raw.get("subject") or "").strip())
    if subject_name:
        value = " ".join(subject_name.group(1).split()).casefold()
        if value:
            identifiers.append(ExtractedIdentifier("name", value, "waiversign_subject_name", "medium"))

    message_id = str(raw.get("message_id") or headers.get("message-id") or "").strip() or None
    fingerprint_material = "\n".join([
        message_id or "",
        original or sender or "",
        str(raw.get("subject") or "").strip().casefold(),
        re.sub(r"\s+", " ", text).strip().casefold(),
    ])
    fingerprint = hashlib.sha256(fingerprint_material.encode("utf-8")).hexdigest()
    return InboundEmailNormalized(
        subject=str(raw.get("subject") or "").strip(),
        text=text,
        sanitized_html=sanitized,
        sender=sender,
        original_sender=original,
        recipients=[value for value in (_address(item) for item in (raw.get("to") or [])) if value],
        identifiers=identifiers,
        relevant_headers=headers,
        message_id=message_id,
        fingerprint=fingerprint,
    )
