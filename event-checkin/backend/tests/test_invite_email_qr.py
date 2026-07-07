"""Regression guard: the invite email always attaches the QR image, and the
template subject/intro overrides never remove it."""
from datetime import datetime

import pytest

from services import email_service


def _capture(monkeypatch):
    sent = {}
    async def fake_send(msg):
        sent["msg"] = msg
    monkeypatch.setattr(email_service, "_send", fake_send)
    return sent


def _qr_part(msg):
    for part in msg.walk():
        if (part.get("Content-ID") or "").strip("<>") == "qrcode":
            return part
    return None


def _part_text(msg, content_type):
    return next(
        p.get_payload(decode=True).decode()
        for p in msg.walk()
        if p.get_content_type() == content_type
    )


@pytest.mark.asyncio
async def test_invite_email_attaches_qr_with_defaults(monkeypatch):
    sent = _capture(monkeypatch)
    await email_service.send_invite_email(
        {"first_name": "Ada", "last_name": "Lovelace", "email": "ada@x.com", "qr_token": "tok-123"},
        "Spring Gala", "The Hosts", "https://events.example", datetime(2026, 9, 1),
    )
    msg = sent["msg"]
    assert msg["Subject"] == "You're invited to Spring Gala"
    assert _qr_part(msg) is not None                     # QR image attached
    html = _part_text(msg, "text/html")
    text = _part_text(msg, "text/plain")
    assert 'cid:qrcode' in html                          # QR referenced in body
    assert '/scan/tok-123' in html                       # ticket link present
    assert "View My Ticket" in html
    assert "Your Admission QR Code" in html
    assert "Venue details coming soon." in html
    assert "View your ticket:" in text
    assert "/scan/tok-123" in text


@pytest.mark.asyncio
async def test_invite_email_overrides_keep_qr(monkeypatch):
    """A custom full-body template (with {{qr_code}}/{{ticket_link}}) renders the
    custom wording AND keeps the QR + ticket link."""
    sent = _capture(monkeypatch)
    await email_service.send_invite_email(
        {"first_name": "Ada", "last_name": "Lovelace", "email": "ada@x.com", "qr_token": "tok-9"},
        "Spring Gala", "The Hosts", "https://events.example", datetime(2026, 9, 1),
        seating_enabled=False,
        menu_enabled=False,
        override_subject="Custom subject for {{event_name}}!",
        override_body="<p>Welcome, special guest {{guest_first_name}}.</p>{{qr_code}}"
        '<a href="{{ticket_link}}">ticket</a>',
    )
    msg = sent["msg"]
    assert msg["Subject"] == "Custom subject for Spring Gala!"   # subject placeholders render
    assert _qr_part(msg) is not None                              # QR still attached
    html = _part_text(msg, "text/html")
    assert "Welcome, special guest Ada." in html                 # custom wording rendered
    assert 'cid:qrcode' in html and '/scan/tok-9' in html        # QR + ticket link present


@pytest.mark.asyncio
async def test_invite_email_pairing_cta_requires_pairing_toggle(monkeypatch):
    """The {{pairing_cta}} block appears only when seating and partner pairing are enabled."""
    sent = _capture(monkeypatch)
    await email_service.send_invite_email(
        {"first_name": "Ada", "last_name": "Lovelace", "email": "ada@x.com", "qr_token": "t"},
        "Spring Gala", "The Hosts", "https://events.example", datetime(2026, 9, 1),
        seating_enabled=True,
        menu_enabled=False,
        partner_pairing_enabled=False,
    )
    html = _part_text(sent["msg"], "text/html")
    assert "Pair with my partner" not in html
    assert "Choose menu" not in html

    sent = _capture(monkeypatch)
    await email_service.send_invite_email(
        {"first_name": "Ada", "last_name": "Lovelace", "email": "ada@x.com", "qr_token": "t"},
        "Spring Gala", "The Hosts", "https://events.example", datetime(2026, 9, 1),
        seating_enabled=True,
        menu_enabled=False,
        partner_pairing_enabled=True,
    )
    html = _part_text(sent["msg"], "text/html")
    assert "Pair with my partner" in html


@pytest.mark.asyncio
async def test_invite_email_renders_event_metadata_blocks(monkeypatch):
    sent = _capture(monkeypatch)
    await email_service.send_invite_email(
        {"first_name": "Am", "last_name": "Ami", "email": "am@x.com", "qr_token": "tok-venue"},
        "Electron Jubilee", "Electron", "https://events.example", datetime(2026, 8, 18, 18, 0),
        venue_name="The Electron Place",
        venue_address="655 Faiwt wa, jaty, tx",
        admission_note="Bring this QR ticket for fast entry.",
        event_image="/api/uploads/events/flyer.png",
    )
    html = _part_text(sent["msg"], "text/html")
    text = _part_text(sent["msg"], "text/plain")
    assert "The Electron Place" in html
    assert "655 Faiwt wa, jaty, tx" in html
    assert "Bring this QR ticket for fast entry." in html
    assert 'src="https://events.example/api/uploads/events/flyer.png"' in html
    assert "Add to Calendar" in html
    assert "Get Directions" in html
    assert "Venue: The Electron Place - 655 Faiwt wa, jaty, tx" in text
