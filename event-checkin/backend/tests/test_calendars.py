"""Event Calendars (Gatsby-parity feature): contact/contact-list CRUD,
calendar CRUD + event curation ownership checks, CalendarAccess token
idempotency, logo upload, the "send links" distribution action, and the
public resolve endpoint for both public and private modes."""
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app import storage
from app.models import (
    Calendar, CalendarAccess, CalendarContactList, CalendarEvent, Contact, ContactList,
    ContactListMember, Event, Guest, Membership, Organization,
)
from app.routers import calendars as calendars_mod
from app.routers.admin import DEFAULT_ORG_ID
from conftest import _Session


def _mock_storage(monkeypatch):
    saved, deleted = {}, []

    def fake_save(subpath, data, content_type):
        saved[subpath] = (data, content_type)
        return f"/api/uploads/{subpath}"

    monkeypatch.setattr(storage, "save", fake_save)
    monkeypatch.setattr(storage, "delete", lambda subpath: deleted.append(subpath))
    return saved, deleted


async def _second_event(org_id: str, name="B Wedding", days_from_now=30) -> str:
    async with _Session() as s:
        ev = Event(
            org_id=org_id, name=name, couples_name="B & B",
            event_date=datetime.utcnow() + timedelta(days=days_from_now), checkin_base_url="http://x",
        )
        s.add(ev)
        await s.commit()
        return ev.id


# ── Multi-org owner: legacy default org must not win ────────────────────────
# Real bug found via live testing (2026-07-25): a user who owns both the
# legacy shared DEFAULT_ORG_ID ("vsgs", auto-created earliest, every
# pre-2026-06-07 user is a member) AND their own real org ended up with
# Calendars/Contact Lists silently created under "vsgs" instead — no error,
# no indication anywhere in the UI, just events failing to attach (org
# mismatch 404) once curated against the org actually shown in their nav.

@pytest.mark.asyncio
async def test_calendar_creation_prefers_real_org_over_legacy_default_org(ctx):
    async with _Session() as s:
        legacy = Organization(id=DEFAULT_ORG_ID, name="vsgs", slug="vsgs",
                               created_at=datetime(2020, 1, 1))
        s.add(legacy)
        await s.flush()
        s.add(Membership(org_id=DEFAULT_ORG_ID, user_id=ctx.ids["user_a"].id, role="owner"))
        await s.commit()

    # user_a now owns both the legacy org (created earliest) and org_a
    # (their real org, created later, per conftest's fixture setup).
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal"})
    assert created.status_code == 201, created.text

    async with _Session() as s:
        cal = await s.get(Calendar, created.json()["id"])
        assert cal.org_id == ctx.ids["org_a"]
        assert cal.org_id != DEFAULT_ORG_ID


# ── Contact lists / contacts ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_managed_org_requires_owner_or_admin(ctx):
    """A user with no org membership at all gets 403 (not 404/500) — the
    real "no Firebase login" 401 case can't be exercised in this test harness
    since get_current_user is overridden to always resolve ctx.login()'s
    value rather than raising, same limitation noted in test_api_keys.py."""
    async with _Session() as s:
        from app.models import User
        stranger = User(name="Stranger", email="stranger@x.com", role="official")
        s.add(stranger)
        await s.commit()
        stranger_id = stranger

    ctx.login(stranger_id)
    r = await ctx.client.get("/api/organizations/me/contact-lists")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_contact_list_and_contact_crud(ctx):
    ctx.login(ctx.ids["user_a"])
    created = await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "VIPs"})
    assert created.status_code == 201, created.text
    list_id = created.json()["id"]
    assert created.json()["contact_count"] == 0

    added = await ctx.client.post(f"/api/organizations/me/contact-lists/{list_id}/contacts",
                                   json={"first_name": "Jane", "last_name": "Doe", "email": "Jane@Example.com"})
    assert added.status_code == 201, added.text
    assert added.json()["email"] == "jane@example.com"   # normalized lowercase

    listing = await ctx.client.get(f"/api/organizations/me/contact-lists/{list_id}/contacts")
    assert len(listing.json()) == 1

    lists = await ctx.client.get("/api/organizations/me/contact-lists")
    assert lists.json()[0]["contact_count"] == 1

    contact_id = added.json()["id"]
    removed = await ctx.client.delete(f"/api/organizations/me/contact-lists/{list_id}/contacts/{contact_id}")
    assert removed.status_code == 204
    listing2 = await ctx.client.get(f"/api/organizations/me/contact-lists/{list_id}/contacts")
    assert len(listing2.json()) == 0

    deleted = await ctx.client.delete(f"/api/organizations/me/contact-lists/{list_id}")
    assert deleted.status_code == 204


@pytest.mark.asyncio
async def test_add_contact_upserts_by_email_across_lists(ctx):
    ctx.login(ctx.ids["user_a"])
    l1 = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "List 1"})).json()["id"]
    l2 = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "List 2"})).json()["id"]

    c1 = await ctx.client.post(f"/api/organizations/me/contact-lists/{l1}/contacts",
                                json={"first_name": "Jane", "email": "jane@example.com"})
    c2 = await ctx.client.post(f"/api/organizations/me/contact-lists/{l2}/contacts",
                                json={"first_name": "Jane", "email": "jane@example.com"})
    assert c1.json()["id"] == c2.json()["id"]   # same Contact row, just linked into two lists

    async with _Session() as s:
        count = len((await s.execute(select(Contact).where(Contact.email == "jane@example.com"))).scalars().all())
        assert count == 1


@pytest.mark.asyncio
async def test_paste_contacts_parses_lines_and_skips_malformed(ctx):
    ctx.login(ctx.ids["user_a"])
    list_id = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "Pasted"})).json()["id"]
    text = "Jane Doe, jane@example.com\nBob Smith,bob@example.com\nnot a valid line\n\n"
    r = await ctx.client.post(f"/api/organizations/me/contact-lists/{list_id}/contacts/paste", json={"text": text})
    assert r.status_code == 201, r.text
    emails = {c["email"] for c in r.json()}
    assert emails == {"jane@example.com", "bob@example.com"}


@pytest.mark.asyncio
async def test_import_contacts_csv_flexible_headers(ctx):
    ctx.login(ctx.ids["user_a"])
    list_id = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "CSV"})).json()["id"]
    csv_text = "First Name,Last Name,Email\nJane,Doe,jane@example.com\nBob,Smith,bob@example.com\n,,not-an-email\n"
    r = await ctx.client.post(
        f"/api/organizations/me/contact-lists/{list_id}/contacts/csv",
        files={"file": ("contacts.csv", csv_text.encode(), "text/csv")},
    )
    assert r.status_code == 201, r.text
    emails = {c["email"] for c in r.json()}
    assert emails == {"jane@example.com", "bob@example.com"}

    listing = await ctx.client.get(f"/api/organizations/me/contact-lists/{list_id}/contacts")
    assert len(listing.json()) == 2


@pytest.mark.asyncio
async def test_import_contacts_csv_requires_email_column(ctx):
    ctx.login(ctx.ids["user_a"])
    list_id = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "Bad CSV"})).json()["id"]
    csv_text = "first_name,last_name\nJane,Doe\n"
    r = await ctx.client.post(
        f"/api/organizations/me/contact-lists/{list_id}/contacts/csv",
        files={"file": ("contacts.csv", csv_text.encode(), "text/csv")},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_import_contacts_csv_derives_first_name_from_email_when_missing(ctx):
    ctx.login(ctx.ids["user_a"])
    list_id = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "NoName"})).json()["id"]
    csv_text = "email\njane@example.com\n"
    r = await ctx.client.post(
        f"/api/organizations/me/contact-lists/{list_id}/contacts/csv",
        files={"file": ("contacts.csv", csv_text.encode(), "text/csv")},
    )
    assert r.status_code == 201, r.text
    assert r.json()[0]["first_name"] == "jane"


@pytest.mark.asyncio
async def test_import_contacts_csv_backfills_access_when_list_already_attached(ctx):
    ctx.login(ctx.ids["user_a"])
    list_id = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "L"})).json()["id"]
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal", "visibility": "private"})).json()
    await ctx.client.put(f"/api/organizations/me/calendars/{cal['id']}/contact-lists", json={"contact_list_ids": [list_id]})

    csv_text = "email,first_name\njane@example.com,Jane\n"
    await ctx.client.post(
        f"/api/organizations/me/contact-lists/{list_id}/contacts/csv",
        files={"file": ("contacts.csv", csv_text.encode(), "text/csv")},
    )
    async with _Session() as s:
        rows = (await s.execute(select(CalendarAccess).where(CalendarAccess.calendar_id == cal["id"]))).scalars().all()
        assert len(rows) == 1


# ── Calendar CRUD ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_public_calendar_gets_share_token_private_does_not(ctx):
    ctx.login(ctx.ids["user_a"])
    pub = await ctx.client.post("/api/organizations/me/calendars", json={"title": "Upcoming Events", "visibility": "public"})
    assert pub.status_code == 201, pub.text
    assert pub.json()["share_token"]

    priv = await ctx.client.post("/api/organizations/me/calendars", json={"title": "Members Only", "visibility": "private"})
    assert priv.status_code == 201
    assert priv.json()["share_token"] is None


@pytest.mark.asyncio
async def test_switching_to_public_generates_share_token(ctx):
    ctx.login(ctx.ids["user_a"])
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "X", "visibility": "private"})).json()
    assert cal["share_token"] is None
    updated = await ctx.client.put(f"/api/organizations/me/calendars/{cal['id']}", json={"visibility": "public"})
    assert updated.json()["share_token"]


@pytest.mark.asyncio
async def test_calendar_scoped_to_owning_org(ctx):
    ctx.login(ctx.ids["user_a"])
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "A's calendar"})).json()

    ctx.login(ctx.ids["user_b"])
    r = await ctx.client.get(f"/api/organizations/me/calendars/{cal['id']}")
    assert r.status_code == 404


# ── Curation ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_curate_add_remove_reorder_events(ctx):
    ctx.login(ctx.ids["user_a"])
    ev_a = ctx.ids["event_a"]
    ev_b = await _second_event(ctx.ids["org_a"])
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal"})).json()
    cid = cal["id"]

    added1 = await ctx.client.post(f"/api/organizations/me/calendars/{cid}/events/{ev_a}")
    assert added1.status_code == 201
    added2 = await ctx.client.post(f"/api/organizations/me/calendars/{cid}/events/{ev_b}")
    assert set(added2.json()["event_ids"]) == {ev_a, ev_b}

    reordered = await ctx.client.post(f"/api/organizations/me/calendars/{cid}/events/reorder",
                                       json={"event_ids": [ev_b, ev_a]})
    assert reordered.json()["event_ids"] == [ev_b, ev_a]

    removed = await ctx.client.delete(f"/api/organizations/me/calendars/{cid}/events/{ev_b}")
    assert removed.json()["event_ids"] == [ev_a]


@pytest.mark.asyncio
async def test_cannot_curate_another_orgs_event(ctx):
    ctx.login(ctx.ids["user_b"])
    ev_b_owned = await _second_event(ctx.ids["org_b"])
    ctx.login(ctx.ids["user_a"])
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal"})).json()
    r = await ctx.client.post(f"/api/organizations/me/calendars/{cal['id']}/events/{ev_b_owned}")
    assert r.status_code == 404


# ── Private audience / CalendarAccess idempotency ────────────────────────────

@pytest.mark.asyncio
async def test_attaching_contact_list_mints_access_tokens_idempotently(ctx):
    ctx.login(ctx.ids["user_a"])
    list_id = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "L"})).json()["id"]
    await ctx.client.post(f"/api/organizations/me/contact-lists/{list_id}/contacts",
                           json={"first_name": "Jane", "email": "jane@example.com"})
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal", "visibility": "private"})).json()
    cid = cal["id"]

    r1 = await ctx.client.put(f"/api/organizations/me/calendars/{cid}/contact-lists", json={"contact_list_ids": [list_id]})
    assert r1.status_code == 200
    async with _Session() as s:
        rows = (await s.execute(select(CalendarAccess).where(CalendarAccess.calendar_id == cid))).scalars().all()
        assert len(rows) == 1
        token = rows[0].token

    # Re-attaching the same list must not duplicate the access row/token.
    r2 = await ctx.client.put(f"/api/organizations/me/calendars/{cid}/contact-lists", json={"contact_list_ids": [list_id]})
    assert r2.status_code == 200
    async with _Session() as s:
        rows = (await s.execute(select(CalendarAccess).where(CalendarAccess.calendar_id == cid))).scalars().all()
        assert len(rows) == 1
        assert rows[0].token == token


@pytest.mark.asyncio
async def test_new_contact_added_to_attached_list_backfills_access(ctx):
    ctx.login(ctx.ids["user_a"])
    list_id = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "L"})).json()["id"]
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal", "visibility": "private"})).json()
    cid = cal["id"]
    await ctx.client.put(f"/api/organizations/me/calendars/{cid}/contact-lists", json={"contact_list_ids": [list_id]})

    await ctx.client.post(f"/api/organizations/me/contact-lists/{list_id}/contacts",
                           json={"first_name": "New", "email": "new@example.com"})
    async with _Session() as s:
        rows = (await s.execute(select(CalendarAccess).where(CalendarAccess.calendar_id == cid))).scalars().all()
        assert len(rows) == 1


# ── Logo upload ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_and_delete_logo(ctx, monkeypatch):
    saved, deleted = _mock_storage(monkeypatch)
    ctx.login(ctx.ids["user_a"])
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal"})).json()
    cid = cal["id"]

    uploaded = await ctx.client.post(f"/api/organizations/me/calendars/{cid}/upload-logo",
                                      files={"file": ("logo.png", b"pngdata", "image/png")})
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["logo_url"].startswith("/api/uploads/calendars/")

    removed = await ctx.client.delete(f"/api/organizations/me/calendars/{cid}/upload-logo")
    assert removed.status_code == 200
    assert removed.json()["logo_url"] is None
    assert len(deleted) == 1


# ── Send links ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_send_links_queues_email_per_contact(ctx, monkeypatch):
    sent = []
    async def fake_email(to, subject, html, *args, **kwargs):
        sent.append((to, subject))
    monkeypatch.setattr(calendars_mod, "send_simple_email", fake_email)

    ctx.login(ctx.ids["user_a"])
    list_id = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "L"})).json()["id"]
    await ctx.client.post(f"/api/organizations/me/contact-lists/{list_id}/contacts",
                           json={"first_name": "Jane", "email": "jane@example.com"})
    await ctx.client.post(f"/api/organizations/me/contact-lists/{list_id}/contacts",
                           json={"first_name": "Bob", "email": "bob@example.com"})
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal", "visibility": "private"})).json()
    cid = cal["id"]
    await ctx.client.put(f"/api/organizations/me/calendars/{cid}/contact-lists", json={"contact_list_ids": [list_id]})

    r = await ctx.client.post(f"/api/organizations/me/calendars/{cid}/send")
    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 2
    assert len(sent) == 2


@pytest.mark.asyncio
async def test_send_links_rejected_for_public_calendar(ctx):
    ctx.login(ctx.ids["user_a"])
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal", "visibility": "public"})).json()
    r = await ctx.client.post(f"/api/organizations/me/calendars/{cal['id']}/send")
    assert r.status_code == 400


# ── Public resolve endpoint ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_resolve_unknown_token_404s(ctx):
    ctx.login(None)
    r = await ctx.client.get(f"/api/calendars/{uuid.uuid4()}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_resolve_public_calendar_lists_curated_events(ctx):
    ctx.login(ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Upcoming", "visibility": "public"})).json()
    await ctx.client.post(f"/api/organizations/me/calendars/{cal['id']}/events/{ev}")

    ctx.login(None)
    r = await ctx.client.get(f"/api/calendars/{cal['share_token']}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "public"
    assert body["contact"] is None
    assert len(body["events"]) == 1
    assert body["events"][0]["id"] == ev
    assert "venue_name" not in body["events"][0]   # deliberately excluded, see schema comment


@pytest.mark.asyncio
async def test_resolve_hides_past_events_when_flagged(ctx):
    ctx.login(ctx.ids["user_a"])
    async with _Session() as s:
        past = Event(org_id=ctx.ids["org_a"], name="Past Event", couples_name="P & P",
                      event_date=datetime.utcnow() - timedelta(days=5), checkin_base_url="http://x")
        s.add(past)
        await s.commit()
        past_id = past.id

    cal = (await ctx.client.post("/api/organizations/me/calendars",
                                  json={"title": "Cal", "visibility": "public", "hide_past_events": True})).json()
    await ctx.client.post(f"/api/organizations/me/calendars/{cal['id']}/events/{past_id}")

    ctx.login(None)
    r = await ctx.client.get(f"/api/calendars/{cal['share_token']}")
    assert r.json()["events"] == []

    ctx.login(ctx.ids["user_a"])
    await ctx.client.put(f"/api/organizations/me/calendars/{cal['id']}", json={"hide_past_events": False})
    ctx.login(None)
    r2 = await ctx.client.get(f"/api/calendars/{cal['share_token']}")
    assert len(r2.json()["events"]) == 1


@pytest.mark.asyncio
async def test_resolve_private_calendar_prefill_and_returning_rsvp_status(ctx):
    ctx.login(ctx.ids["user_a"])
    ev = ctx.ids["event_a"]
    list_id = (await ctx.client.post("/api/organizations/me/contact-lists", json={"name": "L"})).json()["id"]
    contact = (await ctx.client.post(f"/api/organizations/me/contact-lists/{list_id}/contacts",
                                      json={"first_name": "Jane", "email": "jane@example.com"})).json()
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal", "visibility": "private"})).json()
    cid = cal["id"]
    await ctx.client.post(f"/api/organizations/me/calendars/{cid}/events/{ev}")
    await ctx.client.put(f"/api/organizations/me/calendars/{cid}/contact-lists", json={"contact_list_ids": [list_id]})

    async with _Session() as s:
        access = (await s.execute(select(CalendarAccess).where(
            CalendarAccess.calendar_id == cid, CalendarAccess.contact_id == contact["id"]
        ))).scalar_one()
        token = access.token

    ctx.login(None)
    # Before registering: not yet a Guest, so the register link carries a prefill.
    r1 = await ctx.client.get(f"/api/calendars/{token}")
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["mode"] == "private"
    assert body1["contact"] == {"first_name": "Jane", "email": "jane@example.com"}
    assert body1["events"][0]["rsvp_status"] is None
    # register_url is the click-tracking redirect, not the final destination
    # directly — follow it (without letting httpx auto-follow) to see where
    # it actually lands and confirm the prefill query params + click count.
    assert f"/api/calendars/{token}/go/{ev}" in body1["events"][0]["register_url"]
    redirected1 = await ctx.client.get(f"/api/calendars/{token}/go/{ev}", follow_redirects=False)
    assert redirected1.status_code == 302
    assert "email=jane%40example.com" in redirected1.headers["location"]

    async with _Session() as s:
        ce = (await s.execute(select(CalendarEvent).where(
            CalendarEvent.calendar_id == cid, CalendarEvent.event_id == ev
        ))).scalar_one()
        assert ce.click_count == 1

    # Once a Guest row exists for that email on that event, status + their
    # own editable link are surfaced instead.
    async with _Session() as s:
        s.add(Guest(event_id=ev, first_name="Jane", last_name="Doe", email="jane@example.com",
                     rsvp_status="confirmed", admitted=False, invite_token=str(uuid.uuid4())))
        await s.commit()

    r2 = await ctx.client.get(f"/api/calendars/{token}")
    body2 = r2.json()
    assert body2["events"][0]["rsvp_status"] == "confirmed"
    redirected2 = await ctx.client.get(f"/api/calendars/{token}/go/{ev}", follow_redirects=False)
    assert "/r/" in redirected2.headers["location"]

    async with _Session() as s:
        ce = (await s.execute(select(CalendarEvent).where(
            CalendarEvent.calendar_id == cid, CalendarEvent.event_id == ev
        ))).scalar_one()
        assert ce.click_count == 2


@pytest.mark.asyncio
async def test_resolve_increments_view_count(ctx):
    ctx.login(ctx.ids["user_a"])
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal", "visibility": "public"})).json()
    assert cal["view_count"] == 0

    ctx.login(None)
    await ctx.client.get(f"/api/calendars/{cal['share_token']}")
    await ctx.client.get(f"/api/calendars/{cal['share_token']}")

    ctx.login(ctx.ids["user_a"])
    refreshed = await ctx.client.get(f"/api/organizations/me/calendars/{cal['id']}")
    assert refreshed.json()["view_count"] == 2


@pytest.mark.asyncio
async def test_public_share_token_does_not_resolve_after_switched_private(ctx):
    ctx.login(ctx.ids["user_a"])
    cal = (await ctx.client.post("/api/organizations/me/calendars", json={"title": "Cal", "visibility": "public"})).json()
    token = cal["share_token"]
    await ctx.client.put(f"/api/organizations/me/calendars/{cal['id']}", json={"visibility": "private"})

    ctx.login(None)
    r = await ctx.client.get(f"/api/calendars/{token}")
    assert r.status_code == 404
