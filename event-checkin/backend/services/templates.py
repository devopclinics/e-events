"""Customizable message-template engine.

Platform defaults live here in TEMPLATE_DEFS; per-event overrides live in the
`message_templates` table. Resolution order is event-override → code default.

Each template declares the channels it uses (email / sms / whatsapp), the default
subject + per-channel bodies (written with `{{placeholder}}` tokens), the allowed
placeholders (for the editor palette) and the required ones (validated on save).

Two email shapes:
  - email_kind="full"  → the saved/default email body IS the full HTML email.
  - email_kind="block" → the saved/default body is an intro/message block that the
    code-controlled email shell (QR image, menu/CTA blocks) wraps. This keeps the
    rich transactional emails safe while still letting organizers edit the copy.
"""
import html as _html
import re
from html.parser import HTMLParser

# ── Supported placeholders ─────────────────────────────────────────────────────

PLACEHOLDERS = [
    "guest_first_name", "guest_last_name", "guest_full_name",
    "event_name", "event_date", "event_time", "organizer_name",
    "rsvp_link", "ticket_link", "qr_code",
    "venue_name", "venue_address",
    "table_name", "table_group", "ticket_type",
]

_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


# ── Template registry ──────────────────────────────────────────────────────────

def _t(label, channels, *, subject=None, email_body=None, sms_body=None,
       whatsapp_body=None, placeholders=None, required=None, email_kind="full",
       group="General", note=None):
    return {
        "label": label,
        "channels": channels,
        "subject": subject,
        "email_body": email_body,
        "sms_body": sms_body,
        "whatsapp_body": whatsapp_body,
        "placeholders": placeholders or PLACEHOLDERS,
        "required": required or [],
        "email_kind": email_kind,
        "group": group,
        "note": note,
    }


_EMAIL_SHELL_DEFAULT = (
    "<p>Hi {{guest_first_name}},</p>"
    "<p>{{event_name}} — we can't wait to see you.</p>"
)

TEMPLATE_DEFS: dict[str, dict] = {
    # ── Invitations ────────────────────────────────────────────────────────────
    "ticket_qr": _t(
        "Ticket QR email", ["email"], group="Invitations", email_kind="full",
        subject="Your Invitation — {{event_name}}",
        email_body=(
            '<h1 style="color:#1a1a2e;">You\'re Invited!</h1>'
            "<p>Dear <strong>{{guest_full_name}}</strong>,</p>"
            "<p>We are delighted to invite you to <strong>{{event_name}}</strong> "
            "on <strong>{{event_date}}</strong>.</p>"
            "<p>Please present the QR code below at the entrance on the day of the event:</p>"
            '<div style="text-align:center;margin:30px 0;">{{qr_code}}</div>'
            '<p style="text-align:center;margin:0 0 24px 0;">'
            '<a href="{{ticket_link}}" style="color:#0f766e;font-size:14px;font-weight:600;text-decoration:none;">'
            'View your ticket online →</a></p>'
            "{{pairing_cta}}{{menu_cta}}"
            '<p style="color:#666;font-size:14px;">This QR code is unique to you — please do not share it.</p>'
            "<p>With love,<br/><strong>{{organizer_name}}</strong></p>"
        ),
        placeholders=PLACEHOLDERS + ["pairing_cta", "menu_cta"],
        note=("Full email is editable. {{qr_code}} inserts the QR image; "
              "{{pairing_cta}} / {{menu_cta}} insert the partner-pairing and "
              "meal-choice buttons (auto-blank when those features are off). "
              "Keep {{qr_code}} so guests still get a scannable code."),
    ),
    "sms_invitation": _t(
        "SMS invitation", ["sms"], group="Invitations",
        sms_body="Hi {{guest_first_name}}! You're invited to {{event_name}} on {{event_date}}. Your ticket: {{ticket_link}}",
        required=["ticket_link"],
    ),
    "whatsapp_invitation": _t(
        "WhatsApp invitation", ["whatsapp"], group="Invitations",
        whatsapp_body="Hi {{guest_first_name}}! You're invited to {{event_name}} on {{event_date}}. Your ticket: {{ticket_link}}",
        required=["ticket_link"],
    ),
    "rsvp_invitation": _t(
        "RSVP invitation (manual)", ["email", "sms", "whatsapp"], group="Invitations",
        subject="You're invited — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>You have been personally invited to <strong>{{event_name}}</strong> "
            "on <strong>{{event_date}}</strong>.</p>"
            '<p><a href="{{rsvp_link}}">RSVP now →</a></p>'
        ),
        sms_body="Hi {{guest_first_name}}! You're invited to {{event_name}}. RSVP here: {{rsvp_link}}",
        whatsapp_body="Hi {{guest_first_name}}! You're invited to {{event_name}}. RSVP here: {{rsvp_link}}",
        required=["rsvp_link"],
    ),
    "rsvp_reminder": _t(
        "RSVP reminder", ["email", "sms", "whatsapp"], group="RSVP",
        subject="Reminder: please RSVP — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>This is a friendly reminder to RSVP for <strong>{{event_name}}</strong> "
            "on {{event_date}}.</p>"
            '<p><a href="{{rsvp_link}}">RSVP now →</a></p>'
        ),
        sms_body="Reminder: please RSVP for {{event_name}}. {{rsvp_link}}",
        whatsapp_body="Reminder: please RSVP for {{event_name}}. {{rsvp_link}}",
    ),
    # ── RSVP responses ──────────────────────────────────────────────────────────
    "rsvp_confirmation": _t(
        "RSVP confirmation", ["email", "sms", "whatsapp"], group="RSVP",
        subject="You're confirmed — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>Thanks for confirming! We've reserved your place at "
            "<strong>{{event_name}}</strong> on {{event_date}}.</p>"
        ),
        sms_body="You're confirmed for {{event_name}} on {{event_date}}. See you there!",
        whatsapp_body="You're confirmed for {{event_name}} on {{event_date}}. See you there!",
    ),
    "rsvp_decline": _t(
        "RSVP decline confirmation", ["email"], group="RSVP",
        subject="We'll miss you — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>Thanks for letting us know you can't make {{event_name}}. "
            "We'll miss you!</p>"
        ),
    ),
    # ── Approval workflow ───────────────────────────────────────────────────────
    "approval_pending": _t(
        "Approval pending", ["email", "sms", "whatsapp"], group="Approval",
        subject="We received your RSVP — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>Thanks for your RSVP to {{event_name}}. It's pending approval — "
            "we'll be in touch shortly.</p>"
        ),
        sms_body="Thanks {{guest_first_name}}! Your RSVP for {{event_name}} is pending approval.",
        whatsapp_body="Thanks {{guest_first_name}}! Your RSVP for {{event_name}} is pending approval.",
    ),
    "approval_accepted": _t(
        "Approval accepted", ["email", "sms", "whatsapp"], group="Approval",
        subject="You're approved — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>Good news — your RSVP to <strong>{{event_name}}</strong> has been "
            "approved. Your ticket: <a href=\"{{ticket_link}}\">view ticket</a>.</p>"
        ),
        sms_body="Approved! Your ticket for {{event_name}}: {{ticket_link}}",
        whatsapp_body="Approved! Your ticket for {{event_name}}: {{ticket_link}}",
    ),
    "approval_rejected": _t(
        "Approval rejected", ["email"], group="Approval",
        subject="Update on your RSVP — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>Thank you for your interest in {{event_name}}. Unfortunately we're "
            "unable to confirm your place at this time.</p>"
        ),
    ),
    # ── Day-of / operational ────────────────────────────────────────────────────
    "admission_confirmation": _t(
        "Check-in confirmation", ["email", "sms", "whatsapp"], group="Day-of",
        email_kind="block",
        subject="You're checked in — {{event_name}}",
        email_body="<p>Welcome, {{guest_first_name}}! You have been successfully admitted.</p>",
        sms_body="Welcome {{guest_first_name}}! You're checked in to {{event_name}}. Table: {{table_name}}.",
        whatsapp_body="Welcome {{guest_first_name}}! You're checked in. Table: {{table_name}}.",
        note="The seating/menu blocks are added automatically; edit the subject and intro copy here.",
    ),
    "broadcast": _t(
        "Event update / broadcast", ["email", "sms", "whatsapp"], group="Day-of",
        subject="Update — {{event_name}}",
        email_body=(
            "<h2>{{event_name}}</h2>"
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>{{message}}</p>"
        ),
        sms_body="Hi {{guest_first_name}}! {{message}}",
        whatsapp_body="Hi {{guest_first_name}}! {{message}}",
        placeholders=PLACEHOLDERS + ["message"],
        note="{{message}} is the free-text update typed when sending the broadcast.",
    ),
    # ── Add-ons ─────────────────────────────────────────────────────────────────
    "logistics_notification": _t(
        "Logistics / shipping notification", ["email"], group="Add-ons",
        subject="Shipping update — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>Your item for {{event_name}} is on its way.</p>"
        ),
    ),
    "registry_message": _t(
        "Gift registry message", ["email"], group="Add-ons",
        subject="Gift registry — {{event_name}}",
        email_body=(
            "<p>Thank you for celebrating {{event_name}} with us. "
            "If you'd like to give a gift, our registry is below.</p>"
        ),
        note="Shown on the public registry page / registry emails.",
    ),
}


def template_keys() -> list[str]:
    return list(TEMPLATE_DEFS.keys())


# ── Rendering ──────────────────────────────────────────────────────────────────

def render(text: str | None, context: dict) -> str:
    """Substitute {{placeholders}} from context. Unknown/missing → empty string."""
    if not text:
        return ""
    def repl(m: re.Match) -> str:
        val = context.get(m.group(1))
        return "" if val is None else str(val)
    return _TOKEN_RE.sub(repl, text)


def used_placeholders(text: str | None) -> set[str]:
    return set(_TOKEN_RE.findall(text or ""))


def missing_required(key: str, body: str | None, *, channel: str) -> list[str]:
    """Required placeholders for `key` that are absent from a saved body.
    Only enforced when the body is non-empty (empty = fall back to default)."""
    spec = TEMPLATE_DEFS.get(key)
    if not spec or not body:
        return []
    present = used_placeholders(body)
    return [p for p in spec["required"] if p not in present]


# ── HTML sanitization (stdlib, allowlist) ──────────────────────────────────────

_ALLOWED_TAGS = {
    "p", "br", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "span",
    "div", "h1", "h2", "h3", "h4", "blockquote", "hr", "table", "tr", "td", "th",
    "tbody", "thead", "img", "small",
}
_ALLOWED_ATTRS = {"href", "style", "src", "alt", "width", "height", "align", "target"}
_VOID = {"br", "hr", "img"}
_DROP_CONTENT = {"script", "style"}


class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._skip_depth = 0

    def _safe_attrs(self, attrs):
        kept = []
        for k, v in attrs:
            k = (k or "").lower()
            if k.startswith("on") or k not in _ALLOWED_ATTRS:
                continue
            val = v or ""
            if k in ("href", "src") and re.match(r"\s*javascript:", val, re.I):
                continue
            kept.append(f'{k}="{_html.escape(val, quote=True)}"')
        return (" " + " ".join(kept)) if kept else ""

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in _DROP_CONTENT:
            self._skip_depth += 1
            return
        if self._skip_depth or tag not in _ALLOWED_TAGS:
            return
        slash = "/" if tag in _VOID else ""
        self.out.append(f"<{tag}{self._safe_attrs(attrs)}{slash}>")

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if tag in _DROP_CONTENT or self._skip_depth:
            return
        if tag in _ALLOWED_TAGS:
            self.out.append(f"<{tag}{self._safe_attrs(attrs)}/>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in _DROP_CONTENT:
            if self._skip_depth:
                self._skip_depth -= 1
            return
        if self._skip_depth or tag in _VOID or tag not in _ALLOWED_TAGS:
            return
        self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self._skip_depth:
            self.out.append(_html.escape(data, quote=False))


def sanitize_html(html_text: str | None) -> str:
    if not html_text:
        return ""
    p = _Sanitizer()
    p.feed(html_text)
    p.close()
    return "".join(p.out)


# ── Context builders ───────────────────────────────────────────────────────────

def _fmt_date(dt) -> str:
    try:
        return dt.strftime("%A, %d %B %Y")
    except Exception:
        return ""


def _fmt_time(dt) -> str:
    try:
        return dt.strftime("%I:%M %p").lstrip("0")
    except Exception:
        return ""


def build_context(event, guest=None, *, extras: dict | None = None) -> dict:
    """Placeholder values from an event (+ optional guest). Relationship-derived
    fields (table_name, table_group, ticket_type, links) are passed in `extras`
    by the caller, which already has them resolved — this never lazy-loads."""
    ctx = {p: "" for p in PLACEHOLDERS}
    if event is not None:
        ctx["event_name"] = event.name or ""
        ctx["event_date"] = _fmt_date(getattr(event, "event_date", None))
        ctx["event_time"] = _fmt_time(getattr(event, "event_date", None))
        ctx["organizer_name"] = getattr(event, "couples_name", "") or ""
        ctx["venue_name"] = getattr(event, "venue_name", "") or ""
        ctx["venue_address"] = getattr(event, "venue_address", "") or ""
    if guest is not None:
        first = getattr(guest, "first_name", "") or ""
        last = getattr(guest, "last_name", "") or ""
        ctx["guest_first_name"] = first
        ctx["guest_last_name"] = last
        ctx["guest_full_name"] = f"{first} {last}".strip()
    if extras:
        ctx.update({k: ("" if v is None else v) for k, v in extras.items()})
    return ctx


def sample_context(event=None) -> dict:
    """Sample placeholder values for the Preview button."""
    base = {
        "guest_first_name": "Ada", "guest_last_name": "Lovelace",
        "guest_full_name": "Ada Lovelace",
        "event_name": getattr(event, "name", None) or "Spring Gala",
        "event_date": _fmt_date(getattr(event, "event_date", None)) or "Saturday, 12 September 2026",
        "event_time": _fmt_time(getattr(event, "event_date", None)) or "6:00 PM",
        "organizer_name": getattr(event, "couples_name", None) or "The Host",
        "rsvp_link": "https://events.example/r/sample",
        "ticket_link": "https://events.example/scan/sample",
        "qr_code": "https://events.example/scan/sample",
        "venue_name": getattr(event, "venue_name", None) or "Grand Hall",
        "venue_address": getattr(event, "venue_address", None) or "123 Main St",
        "table_name": "VIP-1", "table_group": "VIP Tables", "ticket_type": "VIP",
        "message": "Doors open at 6 PM — see you soon!",
    }
    return base
