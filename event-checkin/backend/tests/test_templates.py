"""Customizable message templates: rendering, validation, fallback/resolution,
permissions, reset+audit, sanitization and test-send."""
import pytest

from app.models import Event, Guest, User, Membership, MessageTemplate, MessageTemplateAudit
from app.routers import guests as guests_router
from app.routers import templates as tpl_router
from services import templates as tpl
from conftest import _Session


# ── Pure engine ─────────────────────────────────────────────────────────────────

def test_render_substitutes_and_blanks_missing():
    out = tpl.render("Hi {{guest_first_name}} to {{event_name}}{{unknown}}",
                     {"guest_first_name": "Ada", "event_name": "Gala"})
    assert out == "Hi Ada to Gala"


def test_missing_required_detects_dropped_placeholder():
    # sms_invitation requires {{ticket_link}}
    assert tpl.missing_required("sms_invitation", "no link here", channel="sms") == ["ticket_link"]
    assert tpl.missing_required("sms_invitation", "go {{ticket_link}}", channel="sms") == []


def test_sanitize_strips_script_and_handlers():
    dirty = '<p onclick="evil()">hi</p><script>x()</script><a href="javascript:1">l</a>'
    clean = tpl.sanitize_html(dirty)
    assert "script" not in clean.lower()
    assert "onclick" not in clean.lower()
    assert "javascript:" not in clean.lower()
    assert "hi" in clean


# ── API: list / fallback ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_shows_defaults_then_override(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]

    listing = (await ctx.client.get(f"/api/events/{ev}/templates")).json()
    assert len(listing) == len(tpl.TEMPLATE_DEFS)
    assert any(t["key"] == "experience_next_steps" for t in listing)
    bc = next(t for t in listing if t["key"] == "broadcast")
    assert bc["source"] == "default"

    saved = await ctx.client.put(f"/api/events/{ev}/templates/broadcast",
                                 json={"subject": "Hi", "sms_body": "Yo {{guest_first_name}}"})
    assert saved.status_code == 200
    assert saved.json()["source"] == "event-customized"
    assert saved.json()["effective"]["sms_body"] == "Yo {{guest_first_name}}"
    # Email falls back to the default since only sms/subject were set.
    assert saved.json()["effective"]["email_body"] == tpl.TEMPLATE_DEFS["broadcast"]["email_body"]


@pytest.mark.asyncio
async def test_save_rejects_missing_required_placeholder(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    bad = await ctx.client.put(f"/api/events/{ev}/templates/sms_invitation",
                               json={"sms_body": "No link in here"})
    assert bad.status_code == 400
    assert "ticket_link" in bad.json()["detail"]


@pytest.mark.asyncio
async def test_save_rejects_wrong_channel(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    # ticket_qr is email-only — an SMS body is rejected.
    bad = await ctx.client.put(f"/api/events/{ev}/templates/ticket_qr",
                               json={"sms_body": "hi"})
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_save_sanitizes_html(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    r = await ctx.client.put(f"/api/events/{ev}/templates/rsvp_decline",
                             json={"email_body": "<p>bye</p><script>steal()</script>"})
    assert r.status_code == 200
    assert "script" not in r.json()["effective"]["email_body"].lower()


@pytest.mark.asyncio
async def test_reset_deletes_override_and_writes_audit(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    await ctx.client.put(f"/api/events/{ev}/templates/broadcast", json={"subject": "X"})
    reset = await ctx.client.delete(f"/api/events/{ev}/templates/broadcast")
    assert reset.status_code == 200
    assert reset.json()["source"] == "default"

    async with _Session() as s:
        remaining = (await s.execute(
            MessageTemplate.__table__.select().where(MessageTemplate.event_id == ev)
        )).all()
        audits = (await s.execute(
            MessageTemplateAudit.__table__.select().where(MessageTemplateAudit.event_id == ev)
        )).all()
    assert remaining == []
    actions = {a.action for a in audits}
    assert "save" in actions and "reset" in actions


@pytest.mark.asyncio
async def test_preview_renders_sample_data(ctx):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    r = await ctx.client.post(f"/api/events/{ev}/templates/broadcast/preview",
                              json={"sms_body": "Hi {{guest_first_name}} — {{message}}"})
    assert r.status_code == 200
    assert r.json()["sms_body"] == "Hi Ada — Doors open at 6 PM — see you soon!"


@pytest.mark.asyncio
async def test_staff_cannot_edit_templates(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        staff = User(name="Stan", email="stan@a.com", role="official")
        s.add(staff)
        await s.flush()
        s.add(Membership(org_id=ctx.ids["org_a"], user_id=staff.id, role="staff"))
        await s.commit()
        staff_obj = staff
    ctx.login(staff_obj)
    r = await ctx.client.get(f"/api/events/{ev}/templates")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_test_send_dispatches(ctx, monkeypatch):
    ctx.login(ctx.ids["superadmin"])
    ev = ctx.ids["event_a"]
    calls = {}

    async def fake_email(to, subject, html, *args, **kwargs):
        calls["email"] = (to, subject, html)

    monkeypatch.setattr(tpl_router, "send_simple_email", fake_email)
    r = await ctx.client.post(f"/api/events/{ev}/templates/broadcast/test-send",
                              json={"channel": "email", "to": "me@x.com",
                                    "email_body": "<p>Hi {{guest_first_name}}</p>"})
    assert r.status_code == 200
    assert calls["email"][0] == "me@x.com"
    assert "Ada" in calls["email"][2]


@pytest.mark.asyncio
async def test_resend_experience_next_steps_uses_template(ctx, monkeypatch):
    ctx.login(ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        guest = (await s.execute(Guest.__table__.select().where(Guest.event_id == ev))).first()
        guest_id = guest.id

    calls = {}

    async def fake_email(to, subject, html, event_id=None, *args, **kwargs):
        calls["email"] = (to, subject, html, event_id)

    monkeypatch.setattr(guests_router, "send_simple_email", fake_email)
    r = await ctx.client.post(
        f"/api/events/{ev}/guests/{guest_id}/resend-email",
        json={"kind": "experience_next_steps"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert calls["email"][0] == "g@a.com"
    assert "Your next steps" in calls["email"][1]
    assert "no pending" in calls["email"][2]
