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


@pytest.mark.asyncio
async def test_invite_email_attaches_qr_with_defaults(monkeypatch):
    sent = _capture(monkeypatch)
    await email_service.send_invite_email(
        {"first_name": "Ada", "last_name": "Lovelace", "email": "ada@x.com", "qr_token": "tok-123"},
        "Spring Gala", "The Hosts", "https://events.example", datetime(2026, 9, 1),
    )
    msg = sent["msg"]
    assert msg["Subject"] == "Your Invitation — Spring Gala"
    assert _qr_part(msg) is not None                     # QR image attached
    html = next(p.get_payload(decode=True).decode() for p in msg.walk()
                if p.get_content_type() == "text/html")
    assert 'cid:qrcode' in html                          # QR referenced in body
    assert '/scan/tok-123' in html                       # ticket link present


@pytest.mark.asyncio
async def test_invite_email_overrides_keep_qr(monkeypatch):
    """A custom full-body template (with {{qr_code}}/{{ticket_link}}) renders the
    custom wording AND keeps the QR + ticket link."""
    sent = _capture(monkeypatch)
    await email_service.send_invite_email(
        {"first_name": "Ada", "last_name": "Lovelace", "email": "ada@x.com", "qr_token": "tok-9"},
        "Spring Gala", "The Hosts", "https://events.example", datetime(2026, 9, 1),
        False, False,
        "Custom subject for {{event_name}}!",
        "<p>Welcome, special guest {{guest_first_name}}.</p>{{qr_code}}"
        '<a href="{{ticket_link}}">ticket</a>',
    )
    msg = sent["msg"]
    assert msg["Subject"] == "Custom subject for Spring Gala!"   # subject placeholders render
    assert _qr_part(msg) is not None                              # QR still attached
    html = next(p.get_payload(decode=True).decode() for p in msg.walk()
                if p.get_content_type() == "text/html")
    assert "Welcome, special guest Ada." in html                 # custom wording rendered
    assert 'cid:qrcode' in html and '/scan/tok-9' in html        # QR + ticket link present


@pytest.mark.asyncio
async def test_invite_email_pairing_cta_only_when_seating(monkeypatch):
    """The {{pairing_cta}} block appears only when seating is enabled (default template)."""
    sent = _capture(monkeypatch)
    await email_service.send_invite_email(
        {"first_name": "Ada", "last_name": "Lovelace", "email": "ada@x.com", "qr_token": "t"},
        "Spring Gala", "The Hosts", "https://events.example", datetime(2026, 9, 1),
        True, False,   # seating on, menu off
    )
    html = next(p.get_payload(decode=True).decode() for p in sent["msg"].walk()
                if p.get_content_type() == "text/html")
    assert "Pair with my partner" in html
    assert "Choose menu" not in html
