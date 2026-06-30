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
    "venue_name", "venue_address", "event_location",
    "table_name", "table_group", "ticket_type",
]

_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


# ── Template registry ──────────────────────────────────────────────────────────

def _t(label, channels, *, subject=None, email_body=None, sms_body=None,
       whatsapp_body=None, mms_body=None, placeholders=None, required=None, email_kind="full",
       group="General", note=None):
    return {
        "label": label,
        "channels": channels,
        "subject": subject,
        "email_body": email_body,
        "sms_body": sms_body,
        "whatsapp_body": whatsapp_body,
        "mms_body": mms_body,
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

_TICKET_EMAIL_PLACEHOLDERS = PLACEHOLDERS + [
    "preview_text", "event_image", "event_image_block", "event_time_row",
    "venue_row", "host_row", "admission_instruction", "calendar_link",
    "calendar_link_block", "directions_link", "directions_link_block",
    "pairing_cta", "menu_cta", "support_email",
]

_TICKET_QR_EMAIL_BODY = """
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f7fb;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dce5ef;">
        <tr>
          <td style="background:#081524;padding:20px 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="left" style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:20px;font-weight:800;line-height:24px;">Festio</td>
                <td align="right" style="font-family:Arial,Helvetica,sans-serif;color:#76fff0;font-size:12px;font-weight:700;line-height:18px;text-transform:uppercase;letter-spacing:1px;">Digital Invitation</td>
              </tr>
            </table>
          </td>
        </tr>
        {{event_image_block}}
        <tr>
          <td style="background:#0d1b2f;padding:34px 28px 30px 28px;">
            <div style="font-family:Arial,Helvetica,sans-serif;color:#2dd4bf;font-size:12px;font-weight:800;line-height:18px;text-transform:uppercase;letter-spacing:1.5px;">You're invited</div>
            <h1 style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:34px;line-height:40px;font-weight:800;margin:8px 0 8px 0;">{{event_name}}</h1>
            <p style="font-family:Arial,Helvetica,sans-serif;color:#d7e2ee;font-size:16px;line-height:24px;margin:0;">Your personal QR ticket is ready. Show it at the entrance for admission.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 8px 28px;">
            <p style="font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:16px;line-height:24px;margin:0 0 8px 0;">Hi {{guest_first_name}},</p>
            <p style="font-family:Arial,Helvetica,sans-serif;color:#42526a;font-size:15px;line-height:24px;margin:0;">You are invited to <strong style="color:#172033;">{{event_name}}</strong>. Keep this email handy for check-in.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px 4px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;">
              <tr>
                <td colspan="2" style="font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:18px;line-height:24px;font-weight:800;padding:18px 18px 8px 18px;">Event details</td>
              </tr>
              <tr>
                <td valign="top" width="110" style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:12px;line-height:18px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;padding:10px 18px;border-top:1px solid #e2e8f0;">Date</td>
                <td valign="top" style="font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:15px;line-height:22px;font-weight:700;padding:10px 18px;border-top:1px solid #e2e8f0;">{{event_date}}</td>
              </tr>
              {{event_time_row}}
              {{venue_row}}
              {{host_row}}
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:26px 28px 8px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;background:#0d1b2f;border-radius:16px;">
              <tr>
                <td align="center" style="padding:28px 20px;">
                  <div style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:20px;line-height:26px;font-weight:800;margin:0 0 6px 0;">Your Admission QR Code</div>
                  <div style="font-family:Arial,Helvetica,sans-serif;color:#cbd5e1;font-size:14px;line-height:21px;margin:0 0 18px 0;">Show this QR code at the entrance for check-in.</div>
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;background:#ffffff;border-radius:18px;">
                    <tr>
                      <td align="center" style="padding:18px;">{{qr_code}}</td>
                    </tr>
                  </table>
                  <div style="font-family:Arial,Helvetica,sans-serif;color:#f8fafc;font-size:13px;line-height:20px;margin:18px 0 0 0;">{{admission_instruction}}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:18px 28px 8px 28px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
              <tr>
                <td align="center" bgcolor="#2dd4bf" style="border-radius:12px;">
                  <a href="{{ticket_link}}" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;color:#05111f;text-decoration:none;font-size:16px;line-height:20px;font-weight:800;padding:16px 28px;border-radius:12px;">View My Ticket</a>
                </td>
              </tr>
            </table>
            <p style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:12px;line-height:18px;margin:14px 0 0 0;">If the button does not work, copy this link:<br><a href="{{ticket_link}}" style="color:#0f766e;text-decoration:underline;word-break:break-all;">{{ticket_link}}</a></p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:6px 28px 12px 28px;">
            {{calendar_link_block}}{{directions_link_block}}
          </td>
        </tr>
        <tr>
          <td style="padding:10px 28px 8px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ecfeff;border:1px solid #99f6e4;border-radius:12px;">
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;color:#115e59;font-size:14px;line-height:21px;padding:14px 16px;"><strong>Security note:</strong> This QR code is unique to you. Please do not share it.</td>
              </tr>
            </table>
          </td>
        </tr>
        {{pairing_cta}}{{menu_cta}}
        <tr>
          <td style="padding:20px 28px 28px 28px;">
            <p style="font-family:Arial,Helvetica,sans-serif;color:#42526a;font-size:15px;line-height:24px;margin:0;">With love,<br><strong style="color:#172033;">{{organizer_name}}</strong></p>
          </td>
        </tr>
        <tr>
          <td align="center" style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 24px;">
            <p style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:12px;line-height:18px;margin:0 0 6px 0;">Powered by <strong style="color:#0f172a;">Festio</strong></p>
            <p style="font-family:Arial,Helvetica,sans-serif;color:#94a3b8;font-size:11px;line-height:17px;margin:0;">You are receiving this email because you were invited to {{event_name}}.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
"""

TEMPLATE_DEFS: dict[str, dict] = {
    # ── Invitations ────────────────────────────────────────────────────────────
    "ticket_qr": _t(
        "Ticket QR email", ["email"], group="Invitations", email_kind="full",
        subject="You're invited to {{event_name}}",
        email_body=_TICKET_QR_EMAIL_BODY,
        placeholders=_TICKET_EMAIL_PLACEHOLDERS,
        required=["qr_code", "ticket_link"],
        note=("Full email is editable. The default is email-client-safe HTML. "
              "{{qr_code}} inserts the QR image and {{ticket_link}} powers the "
              "View My Ticket button. Optional blocks like {{event_image_block}}, "
              "{{venue_row}}, {{calendar_link_block}}, {{directions_link_block}}, "
              "{{pairing_cta}} and {{menu_cta}} are generated automatically. "
              "Keep {{qr_code}} and {{ticket_link}} so guests still get a scannable ticket."),
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
    "mms_invitation": _t(
        "MMS invitation (ticket card)", ["mms"], group="Invitations",
        mms_body="Hi {{guest_first_name}}! You're invited to {{event_name}} on {{event_date}}. Your ticket card is attached — show it at the door.",
        note="Sent with the ticket-card image when MMS is on. Fires at invite time (super-admin MMS toggle).",
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
        "RSVP decline confirmation", ["email", "sms"], group="RSVP",
        subject="We'll miss you — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>Thanks for letting us know you can't make {{event_name}}. "
            "We'll miss you!</p>"
        ),
        sms_body="Hi {{guest_first_name}}, thanks for letting us know you can't make {{event_name}}. We'll miss you!",
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
        "Approval rejected", ["email", "sms"], group="Approval",
        subject="Update on your RSVP — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>Thank you for your interest in {{event_name}}. Unfortunately we're "
            "unable to confirm your place at this time.</p>"
        ),
        sms_body="Hi {{guest_first_name}}, thank you for your interest in {{event_name}}. Unfortunately we're unable to confirm your place at this time.",
    ),
    # ── Day-of / operational ────────────────────────────────────────────────────
    "admission_confirmation": _t(
        "Check-in confirmation", ["email", "sms", "whatsapp", "mms"], group="Day-of",
        email_kind="block",
        subject="You're checked in — {{event_name}}",
        email_body="<p>Welcome, {{guest_first_name}}! You have been successfully admitted.</p>",
        sms_body="Welcome {{guest_first_name}}! You're checked in to {{event_name}}. Table: {{table_name}}.",
        whatsapp_body="Welcome {{guest_first_name}}! You're checked in. Table: {{table_name}}.",
        mms_body="Welcome {{guest_first_name}}! You're checked in to {{event_name}}. Table: {{table_name}}. Your ticket card is attached.",
        note=("The seating/menu blocks are added automatically; edit the subject and intro copy here. "
              "The MMS body is the caption sent with the ticket-card image."),
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
        "Logistics / shipping notification", ["email", "sms"], group="Add-ons",
        subject="Shipping update — {{event_name}}",
        email_body=(
            "<p>Hi <strong>{{guest_first_name}}</strong>,</p>"
            "<p>Your item for {{event_name}} is on its way.</p>"
        ),
        sms_body="Hi {{guest_first_name}}, your item for {{event_name}} is on its way.",
    ),
    "registry_message": _t(
        "Gift registry message", ["email", "sms"], group="Add-ons",
        subject="Gift registry — {{event_name}}",
        email_body=(
            "<p>Thank you for celebrating {{event_name}} with us. "
            "If you'd like to give a gift, our registry is below.</p>"
        ),
        sms_body="Thank you for celebrating {{event_name}} with us. If you'd like to give a gift, our registry is at {{rsvp_link}}.",
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
_ALLOWED_ATTRS = {
    "href", "style", "src", "alt", "width", "height", "align", "target",
    "role", "bgcolor", "cellpadding", "cellspacing", "border", "valign",
    "colspan",
}
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
        "qr_code": (
            '<img src="https://placehold.co/240x240/png?text=QR" alt="Your admission QR code" '
            'width="240" height="240" style="display:block;width:240px;height:240px;border:0;" />'
        ),
        "venue_name": getattr(event, "venue_name", None) or "Grand Hall",
        "venue_address": getattr(event, "venue_address", None) or "123 Main St",
        "event_location": getattr(event, "venue_address", None) or "123 Main St",
        "table_name": "VIP-1", "table_group": "VIP Tables", "ticket_type": "VIP",
        "message": "Doors open at 6 PM — see you soon!",
    }
    base.update({
        "preview_text": "Your personal QR ticket is ready. Show it at the entrance for admission.",
        "event_image": "https://placehold.co/1200x600/png?text=Event+Image",
        "event_image_block": (
            '<tr><td><img src="https://placehold.co/1200x600/png?text=Event+Image" '
            'alt="Event image" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" /></td></tr>'
        ),
        "event_time_row": (
            '<tr><td valign="top" width="110" style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:12px;line-height:18px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;padding:10px 18px;border-top:1px solid #e2e8f0;">Time</td>'
            '<td valign="top" style="font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:15px;line-height:22px;font-weight:700;padding:10px 18px;border-top:1px solid #e2e8f0;">6:00 PM</td></tr>'
        ),
        "venue_row": (
            '<tr><td valign="top" width="110" style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:12px;line-height:18px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;padding:10px 18px;border-top:1px solid #e2e8f0;">Venue</td>'
            '<td valign="top" style="font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:15px;line-height:22px;font-weight:700;padding:10px 18px;border-top:1px solid #e2e8f0;">Grand Hall<br><span style="font-weight:400;color:#64748b;">123 Main St</span></td></tr>'
        ),
        "host_row": (
            '<tr><td valign="top" width="110" style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:12px;line-height:18px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;padding:10px 18px;border-top:1px solid #e2e8f0;">Host</td>'
            '<td valign="top" style="font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:15px;line-height:22px;font-weight:700;padding:10px 18px;border-top:1px solid #e2e8f0;">The Host</td></tr>'
        ),
        "admission_instruction": "Please bring this email with you for admission.",
        "calendar_link": "https://calendar.google.com/calendar/render?action=TEMPLATE",
        "calendar_link_block": '<a href="https://calendar.google.com/calendar/render?action=TEMPLATE" style="font-family:Arial,Helvetica,sans-serif;color:#0f766e;text-decoration:underline;font-size:14px;font-weight:700;margin:0 8px;">Add to Calendar</a>',
        "directions_link": "https://www.google.com/maps/search/?api=1&query=123+Main+St",
        "directions_link_block": '<a href="https://www.google.com/maps/search/?api=1&query=123+Main+St" style="font-family:Arial,Helvetica,sans-serif;color:#0f766e;text-decoration:underline;font-size:14px;font-weight:700;margin:0 8px;">Get Directions</a>',
        "pairing_cta": "",
        "menu_cta": "",
        "support_email": "support@example.com",
    })
    return base
