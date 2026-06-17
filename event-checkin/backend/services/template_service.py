"""Template rendering service.

Resolves the correct template for a given key using the priority chain:
  event-scope override  →  platform default

Renders Jinja2-style {{placeholder}} substitution using the provided context.
"""
import re
from datetime import datetime
from typing import Any

# ── Default platform templates ────────────────────────────────────────────────

DEFAULTS: dict[str, dict[str, Any]] = {
    "invite_email": {
        "subject": "You're invited to {{event_name}}",
        "email_body": (
            "Hi {{guest_first_name}},\n\n"
            "You're cordially invited to {{event_name}} on {{event_date}}.\n\n"
            "Your personal QR ticket: {{ticket_link}}\n\n"
            "Show this at the entrance.\n\n"
            "Warm regards,\n{{organizer_name}}"
        ),
        "sms_body": (
            "Hi {{guest_first_name}}, you're invited to {{event_name}} on {{event_date}}. "
            "Your ticket: {{ticket_link}}"
        ),
        "whatsapp_body": (
            "Hi {{guest_first_name}} 👋\n\nYou're invited to *{{event_name}}* on {{event_date}}.\n\n"
            "Your personal QR ticket:\n{{ticket_link}}\n\nSee you there!"
        ),
    },
    "invite_reminder": {
        "subject": "Reminder: {{event_name}} is coming up!",
        "email_body": (
            "Hi {{guest_first_name}},\n\n"
            "Just a reminder that {{event_name}} is on {{event_date}}.\n\n"
            "Your ticket: {{ticket_link}}\n\nSee you there!\n\n{{organizer_name}}"
        ),
        "sms_body": (
            "Reminder: {{event_name}} is on {{event_date}}. Your ticket: {{ticket_link}}"
        ),
        "whatsapp_body": (
            "Hi {{guest_first_name}} 👋 Reminder: *{{event_name}}* is on {{event_date}}.\n\nTicket: {{ticket_link}}"
        ),
    },
    "admission_confirmation": {
        "subject": "Check-in Complete - {{event_name}}",
        "email_body": (
            '<!DOCTYPE html>\n'
            '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>\n'
            '<body style="margin:0;padding:18px;background:#e9edf1;font-family:\'Segoe UI\',Arial,sans-serif;">\n'
            '<table role="presentation" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;">\n'
            '<tr><td style="padding:0;">\n'
            '<div style="border-radius:18px;overflow:hidden;box-shadow:0 14px 40px rgba(4,18,30,.18);">\n'
            '<div style="background:linear-gradient(180deg,#021124 0%,#05182d 100%);padding:18px 22px;text-align:center;color:#d9f7ff;">\n'
            '<div style="display:inline-block;background:#d7fff7;color:#0f766e;border-radius:999px;padding:6px 14px;font-size:12px;font-weight:700;">Admitted</div>\n'
            '<h1 style="margin:12px 0 2px;color:#ffffff;font-size:28px;line-height:1.12;font-weight:700;">{{event_name}}</h1>\n'
            '<div style="font-size:13px;opacity:.9;">{{organizer_name}}</div>\n'
            '<div style="font-size:13px;opacity:.82;margin-top:4px;">{{event_date}}</div>\n'
            '</div>\n'
            '<div style="background:#0f2232;padding:20px 22px;text-align:center;color:#f5fbff;">\n'
            '<div style="font-size:12px;letter-spacing:.9px;text-transform:uppercase;color:#8bb3cc;">Guest</div>\n'
            '<div style="font-size:30px;font-weight:700;line-height:1.1;margin-top:6px;">{{guest_first_name}}</div>\n'
            '<div style="margin:14px auto 0;display:inline-block;padding:8px 12px;border-radius:999px;background:#143347;color:#9fd0ee;font-size:12px;">Checked in at <strong style="color:#e6f6ff;">{{check_in_time}}</strong></div>\n'
            '<table role="presentation" style="margin:14px auto 0;border-collapse:separate;border-spacing:10px 0;">\n'
            '<tr>\n'
            '<td style="background:#143347;border-radius:10px;padding:10px 18px;text-align:center;min-width:88px;">\n'
            '<div style="font-size:10px;color:#7da9c6;text-transform:uppercase;letter-spacing:.6px;">Table</div>\n'
            '<div style="font-size:18px;color:#ffffff;font-weight:700;margin-top:4px;">{{table_name}}</div>\n'
            '</td>\n'
            '<td style="background:#143347;border-radius:10px;padding:10px 18px;text-align:center;min-width:88px;">\n'
            '<div style="font-size:10px;color:#7da9c6;text-transform:uppercase;letter-spacing:.6px;">Seat</div>\n'
            '<div style="font-size:18px;color:#ffffff;font-weight:700;margin-top:4px;">{{seat_number}}</div>\n'
            '</td>\n'
            '</tr>\n'
            '</table>\n'
            '<div style="margin:18px auto 8px;padding:10px;border-radius:12px;background:#0b1c2a;border:1px solid #1f4059;max-width:240px;">{{qr_code}}</div>\n'
            '<p style="margin:0;"><a href="{{ticket_link}}" style="display:inline-block;background:#14b8a6;color:#052024;text-decoration:none;font-weight:700;font-size:13px;padding:10px 16px;border-radius:10px;">View your ticket online -></a></p>\n'
            '</div>\n'
            '</div>\n'
            '</td></tr>\n'
            '</table>\n'
            '</body></html>'
        ),
        "sms_body": (
            "Welcome, {{guest_first_name}}! You're checked in to {{event_name}}. "
            "Table: {{table_name}}, Seat: {{seat_number}}."
        ),
        "whatsapp_body": (
            "Welcome, {{guest_first_name}}! ✅\n\nYou've been checked in to *{{event_name}}*.\n"
            "🪑 Table: {{table_name}} | Seat: {{seat_number}}"
        ),
    },
    "rsvp_confirmation": {
        "subject": "RSVP confirmed — {{event_name}}",
        "email_body": (
            "Hi {{guest_first_name}},\n\nYour RSVP for {{event_name}} is confirmed.\n\n"
            "Date: {{event_date}}\n\nWe'll see you there!\n\n{{organizer_name}}"
        ),
        "sms_body": "RSVP confirmed for {{event_name}} on {{event_date}}. See you there!",
        "whatsapp_body": "Hi {{guest_first_name}} ✅ RSVP confirmed for *{{event_name}}* on {{event_date}}.",
    },
    "rsvp_decline": {
        "subject": "We'll miss you at {{event_name}}",
        "email_body": (
            "Hi {{guest_first_name}},\n\nWe received your RSVP decline for {{event_name}}. "
            "We're sorry you can't make it!\n\n{{organizer_name}}"
        ),
        "sms_body": "We received your decline for {{event_name}}. We'll miss you!",
        "whatsapp_body": "Hi {{guest_first_name}}, we received your RSVP decline for *{{event_name}}*. We'll miss you! 💙",
    },
    "approval_pending": {
        "subject": "Your request for {{event_name}} is under review",
        "email_body": (
            "Hi {{guest_first_name}},\n\nYour request to attend {{event_name}} is being reviewed. "
            "You'll hear from us shortly.\n\n{{organizer_name}}"
        ),
        "sms_body": "Your request for {{event_name}} is under review. We'll notify you soon.",
        "whatsapp_body": "Hi {{guest_first_name}}, your request for *{{event_name}}* is under review. We'll notify you soon.",
    },
    "approval_accepted": {
        "subject": "You're approved for {{event_name}}!",
        "email_body": (
            "Hi {{guest_first_name}},\n\nGreat news — you've been approved for {{event_name}} on {{event_date}}!\n\n"
            "Your ticket: {{ticket_link}}\n\n{{organizer_name}}"
        ),
        "sms_body": "You're approved for {{event_name}}! Your ticket: {{ticket_link}}",
        "whatsapp_body": "Hi {{guest_first_name}} 🎉 You're approved for *{{event_name}}*! Ticket: {{ticket_link}}",
    },
    "approval_rejected": {
        "subject": "Update on your request for {{event_name}}",
        "email_body": (
            "Hi {{guest_first_name}},\n\nUnfortunately we're unable to accommodate your request "
            "for {{event_name}} at this time.\n\n{{organizer_name}}"
        ),
        "sms_body": "We're unable to accommodate your request for {{event_name}} at this time.",
        "whatsapp_body": "Hi {{guest_first_name}}, unfortunately your request for *{{event_name}}* was not approved at this time.",
    },
}

# Ordered list of all known keys for listing in the UI.
ALL_TEMPLATE_KEYS: list[str] = list(DEFAULTS.keys())

# All recognised placeholder names shown in the UI.
ALL_PLACEHOLDERS: list[str] = [
    "guest_first_name", "guest_last_name", "guest_full_name",
    "event_name", "event_date", "event_time", "check_in_time",
    "organizer_name", "rsvp_link", "ticket_link", "qr_code",
    "venue_name", "venue_address",
    "table_name", "seat_number", "table_group",
    "ticket_type",
]

# ── Sample context used for previews ─────────────────────────────────────────

def _sample_context(event_name: str = "Alicia & James Wedding") -> dict[str, str]:
    return {
        "guest_first_name": "Jane",
        "guest_last_name": "Smith",
        "guest_full_name": "Jane Smith",
        "event_name": event_name,
        "event_date": "Saturday, 21 June 2026",
        "event_time": "6:00 PM",
        "check_in_time": "7:32 PM",
        "organizer_name": "The Organising Team",
        "rsvp_link": "https://events.example.com/rsvp/sample-token",
        "ticket_link": "https://events.example.com/scan/sample-token",
        "qr_code": "[QR CODE]",
        "venue_name": "Grand Ballroom",
        "venue_address": "123 Event Street, City",
        "table_name": "Table 5",
        "seat_number": "3",
        "table_group": "VIP Tables",
        "ticket_type": "Standard",
    }


# ── Rendering ─────────────────────────────────────────────────────────────────

_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def render(template: str, context: dict[str, str]) -> str:
    """Replace {{placeholder}} tokens with values from context.
    Unknown placeholders are left as-is."""
    def _replace(m: re.Match) -> str:
        return context.get(m.group(1), m.group(0))
    return _PLACEHOLDER_RE.sub(_replace, template)


def render_template(
    fields: dict[str, str | None],
    context: dict[str, str],
) -> dict[str, str | None]:
    """Render all non-None fields and return a dict of rendered strings."""
    return {
        k: render(v, context) if v is not None else None
        for k, v in fields.items()
    }


# ── Lookup with fallback hierarchy ───────────────────────────────────────────

async def resolve_template(
    template_key: str,
    event_id: str | None,
    db,
) -> dict[str, str | None]:
    """Return the effective template fields (subject / *_body) for a key.

    Priority: event-level row  →  platform default.
    """
    from sqlalchemy import select as sa_select
    from app.models import MessageTemplate

    override: MessageTemplate | None = None

    if event_id:
        override = (await db.execute(
            sa_select(MessageTemplate).where(
                MessageTemplate.template_key == template_key,
                MessageTemplate.scope == "event",
                MessageTemplate.event_id == event_id,
            )
        )).scalar_one_or_none()

    if override is None:
        override = (await db.execute(
            sa_select(MessageTemplate).where(
                MessageTemplate.template_key == template_key,
                MessageTemplate.scope == "platform",
                MessageTemplate.event_id.is_(None),
            )
        )).scalar_one_or_none()

    defaults = DEFAULTS.get(template_key, {})

    return {
        "subject":        (override.subject        if override and override.subject        is not None else defaults.get("subject")),
        "email_body":     (override.email_body     if override and override.email_body     is not None else defaults.get("email_body")),
        "sms_body":       (override.sms_body       if override and override.sms_body       is not None else defaults.get("sms_body")),
        "whatsapp_body":  (override.whatsapp_body  if override and override.whatsapp_body  is not None else defaults.get("whatsapp_body")),
    }
