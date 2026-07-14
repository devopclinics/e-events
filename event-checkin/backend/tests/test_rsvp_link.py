from sqlalchemy import delete, select

import pytest

from app.models import Event, Guest, RSVPQuestion, SeatingTable, TableGroup, TicketType
from conftest import _Session


@pytest.mark.asyncio
async def test_public_rsvp_link_uses_event_token(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.rsvp_token = "share-token-123"
        event.rsvp_require_approval = True
        await s.execute(delete(Guest).where(Guest.event_id == ev))
        await s.commit()

    page = await ctx.client.get("/api/invite/link/share-token-123")
    assert page.status_code == 200
    payload = page.json()
    assert payload["id"] == ev
    assert payload["rsvp_token"] == "share-token-123"

    response = await ctx.client.post(
        "/api/invite/link/share-token-123/rsvp",
        json={
            "first_name": "Prospect",
            "last_name": "Guest",
            "email": "prospect@example.com",
        },
    )
    assert response.status_code == 201
    assert response.json()["rsvp_status"] == "pending"

    missing = await ctx.client.get("/api/invite/link/not-real")
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_public_rsvp_link_can_create_multiple_pending_invitees(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "multi-token-123"
        event.rsvp_require_approval = True
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 3
        event.is_paid = True
        event.guest_cap = 10
        await s.execute(delete(Guest).where(Guest.event_id == ev))
        vip_group = TableGroup(event_id=ev, name="VIP & Dignitaries", tag="VIP")
        family_group = TableGroup(event_id=ev, name="Parents & Invited Guests", tag="FAMILY")
        vip_ticket = TicketType(event_id=ev, name="VIP/Dignitary")
        family_ticket = TicketType(event_id=ev, name="Invited Guest")
        s.add_all([vip_group, family_group, vip_ticket, family_ticket])
        await s.commit()

    response = await ctx.client.post(
        "/api/invite/link/multi-token-123/rsvp",
        json={
            "first_name": "Parent",
            "last_name": "Submitter",
            "email": "submitter@example.com",
            "phone": "+14155550100",
            "sms_consent": True,
            "answers": {},
            "invitees": [
                {
                    "full_name": "Aisha Bello",
                    "phone": "+14155550101",
                    "email": "aisha@example.com",
                    "relationship": "Aunt",
                    "guest_type": "Invited Guest",
                },
                {
                    "full_name": "Dr Imran Eleha",
                    "phone": "+14155550102",
                    "guest_type": "VIP/Dignitary",
                    "notes": "Guest of honour",
                },
            ],
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["rsvp_status"] == "pending"
    assert "Parent plus 2 invited guests" in response.json()["message"]

    async with _Session() as s:
        guests = (await s.execute(
            __import__("sqlalchemy").select(Guest).where(Guest.event_id == ev).order_by(Guest.first_name)
        )).scalars().all()
        assert len(guests) == 3
        by_name = {f"{g.first_name} {g.last_name}".strip(): g for g in guests}
        assert by_name["Parent Submitter"].rsvp_submitter_guest_id == by_name["Parent Submitter"].id
        assert by_name["Parent Submitter"].rsvp_relationship == "Self"
        assert by_name["Parent Submitter"].rsvp_status == "pending"
        assert by_name["Parent Submitter"].sms_consent is True
        assert by_name["Aisha Bello"].rsvp_submitter_email == "submitter@example.com"
        assert by_name["Aisha Bello"].rsvp_submitter_guest_id == by_name["Parent Submitter"].id
        assert by_name["Aisha Bello"].rsvp_relationship == "Aunt"
        assert by_name["Aisha Bello"].rsvp_status == "pending"
        assert by_name["Aisha Bello"].sms_consent is False
        assert by_name["Aisha Bello"].qr_generated_at is None
        assert by_name["Dr Imran Eleha"].is_vip is True
        assert by_name["Dr Imran Eleha"].rsvp_guest_type == "VIP/Dignitary"
        assert by_name["Dr Imran Eleha"].sms_consent is False


@pytest.mark.asyncio
async def test_multi_invitee_rsvp_enforces_category_limit_rules(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "category-limit-token"
        event.rsvp_require_approval = True
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 10
        event.rsvp_multi_invitee_limit_rules = {
            "Transition ceremony parent/guardian": 2,
            "Haflatul-Qur'an parent/guardian": 10,
        }
        event.is_paid = True
        event.guest_cap = 20
        await s.execute(delete(Guest).where(Guest.event_id == ev))
        q = RSVPQuestion(
            event_id=ev,
            question="Invitation category",
            question_type="select",
            options="[\"Transition ceremony parent/guardian\",\"Haflatul-Qur'an parent/guardian\"]",
            is_required=True,
            sort_order=1,
        )
        s.add(q)
        await s.commit()
        question_id = q.id

    too_many = await ctx.client.post(
        "/api/invite/link/category-limit-token/rsvp",
        json={
            "first_name": "Parent",
            "last_name": "Submitter",
            "email": "category-parent@example.com",
            "answers": {question_id: "Transition ceremony parent/guardian"},
            "invitees": [
                {"full_name": "Guest One"},
                {"full_name": "Guest Two"},
                {"full_name": "Guest Three"},
            ],
        },
    )
    assert too_many.status_code == 422
    assert "up to 2 invited guests" in too_many.text

    allowed = await ctx.client.post(
        "/api/invite/link/category-limit-token/rsvp",
        json={
            "first_name": "Parent",
            "last_name": "Submitter",
            "email": "category-parent@example.com",
            "answers": {question_id: "Haflatul-Qur'an parent/guardian"},
            "invitees": [
                {"full_name": "Guest One"},
                {"full_name": "Guest Two"},
                {"full_name": "Guest Three"},
            ],
        },
    )
    assert allowed.status_code == 201, allowed.text
    assert "Parent plus 3 invited guests" in allowed.json()["message"]


@pytest.mark.asyncio
async def test_multi_invitee_rsvp_supports_submitter_only_category(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "submitter-only-token"
        event.rsvp_require_approval = True
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 10
        event.rsvp_multi_invitee_limit_rules = {
            "Individual invited guest": 0,
            "Transition ceremony parent/guardian": 2,
        }
        event.is_paid = True
        event.guest_cap = 20
        await s.execute(delete(Guest).where(Guest.event_id == ev))
        q = RSVPQuestion(
            event_id=ev,
            question="Invitation category",
            question_type="select",
            options="[\"Individual invited guest\",\"Transition ceremony parent/guardian\"]",
            is_required=True,
            sort_order=1,
        )
        s.add(q)
        await s.commit()
        question_id = q.id

    rejected = await ctx.client.post(
        "/api/invite/link/submitter-only-token/rsvp",
        json={
            "first_name": "Direct",
            "last_name": "Guest",
            "email": "direct-with-extra@example.com",
            "answers": {question_id: "Individual invited guest"},
            "invitees": [{"full_name": "Extra Guest"}],
        },
    )
    assert rejected.status_code == 422
    assert "submitter only" in rejected.text

    accepted = await ctx.client.post(
        "/api/invite/link/submitter-only-token/rsvp",
        json={
            "first_name": "Direct",
            "last_name": "Guest",
            "email": "direct@example.com",
            "answers": {question_id: "Individual invited guest"},
            "invitees": [],
        },
    )
    assert accepted.status_code == 201, accepted.text
    assert "RSVP received for Direct." in accepted.json()["message"]

    async with _Session() as s:
        guests = (await s.execute(
            __import__("sqlalchemy").select(Guest).where(Guest.event_id == ev)
        )).scalars().all()
        assert len(guests) == 1
        assert guests[0].rsvp_submitter_guest_id == guests[0].id
        assert guests[0].rsvp_guest_type == "Individual invited guest"


@pytest.mark.asyncio
async def test_multi_invitee_rsvp_can_allow_duplicate_emails(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "duplicate-email-token"
        event.rsvp_require_approval = True
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 5
        event.rsvp_allow_duplicate_emails = False
        event.is_paid = True
        event.guest_cap = 20
        await s.execute(delete(Guest).where(Guest.event_id == ev))
        await s.commit()

    payload = {
        "first_name": "Parent",
        "last_name": "Submitter",
        "email": "parent@example.com",
        "answers": {},
        "invitees": [
            {"full_name": "Guest One", "email": "family@example.com"},
            {"full_name": "Guest Two", "email": "family@example.com"},
        ],
    }

    rejected = await ctx.client.post("/api/invite/link/duplicate-email-token/rsvp", json=payload)
    assert rejected.status_code == 409
    assert "Duplicate invitee contact" in rejected.text

    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_allow_duplicate_emails = True
        await s.commit()

    allowed = await ctx.client.post("/api/invite/link/duplicate-email-token/rsvp", json=payload)
    assert allowed.status_code == 201, allowed.text
    assert "Parent plus 2 invited guests" in allowed.json()["message"]


@pytest.mark.asyncio
async def test_multi_invitee_rsvp_maps_category_to_submitter_and_invitee_tables(ctx):
    """The submitter's SELECTED invitation category maps to a submitter table
    bucket and a separate invited-guests table bucket (SeatingTable.category)."""
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "cat-seating-token"
        event.rsvp_require_approval = False
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 10
        event.rsvp_multi_invitee_limit_rules = {"Hafla & Graduands": 10, "Individual invited guest": 0}
        event.rsvp_category_seating_rules = {
            "Hafla & Graduands": {"submitter": "Hafla Parents", "invitee": "Graduands Guests"},
        }
        event.is_paid = True
        event.guest_cap = 20
        await s.execute(delete(Guest).where(Guest.event_id == ev))
        q = RSVPQuestion(
            event_id=ev, question="Invitation category", question_type="select",
            options="[\"Hafla & Graduands\",\"Individual invited guest\"]", is_required=True, sort_order=1,
        )
        # Two tables sharing the invitee bucket → invitees distribute across them.
        t_sub = SeatingTable(event_id=ev, name="Hafla Parents 1", capacity=10, category="Hafla Parents")
        t_g1 = SeatingTable(event_id=ev, name="Graduands Guests 1", capacity=1, category="Graduands Guests", sort_order=1)
        t_g2 = SeatingTable(event_id=ev, name="Graduands Guests 2", capacity=10, category="Graduands Guests", sort_order=2)
        s.add_all([q, t_sub, t_g1, t_g2])
        await s.commit()
        question_id, sub_id, g1_id, g2_id = q.id, t_sub.id, t_g1.id, t_g2.id

    response = await ctx.client.post(
        "/api/invite/link/cat-seating-token/rsvp",
        json={
            "first_name": "Hafla", "last_name": "Parent", "email": "hafla@example.com",
            "answers": {question_id: "Hafla & Graduands"},
            "invitees": [
                {"full_name": "Guest One", "email": "g1@example.com"},
                {"full_name": "Guest Two", "email": "g2@example.com"},
            ],
        },
    )
    assert response.status_code == 201, response.text

    async with _Session() as s:
        guests = (await s.execute(select(Guest).where(Guest.event_id == ev))).scalars().all()
        by_name = {f"{g.first_name} {g.last_name}".strip(): g for g in guests}
        # Submitter → submitter bucket table.
        assert by_name["Hafla Parent"].table_id == sub_id
        # First invitee fills the capacity-1 bucket table, second overflows to the next.
        assert by_name["Guest One"].table_id == g1_id
        assert by_name["Guest Two"].table_id == g2_id


@pytest.mark.asyncio
async def test_multi_invitee_rsvp_per_field_required_flags(ctx):
    """Submitter and invitee email/phone required-ness is driven independently by
    the rsvp_*_required flags (only enforced when the field is also collected)."""
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "req-flags-token"
        event.rsvp_require_approval = False
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 5
        event.is_paid = True
        event.guest_cap = 20
        event.rsvp_collect_email = True
        event.rsvp_collect_phone = True
        # Submitter: email optional, phone required. Invitees: email required, phone optional.
        event.rsvp_email_required = False
        event.rsvp_phone_required = True
        event.rsvp_invitee_email_required = True
        event.rsvp_invitee_phone_required = False
        await s.execute(delete(Guest).where(Guest.event_id == ev))
        await s.commit()

    base = {"first_name": "Sub", "last_name": "Mitter", "answers": {}}

    # Submitter phone required → missing phone is rejected (email may be omitted).
    r1 = await ctx.client.post("/api/invite/link/req-flags-token/rsvp",
        json={**base, "invitees": []})
    assert r1.status_code == 422 and "phone is required" in r1.text.lower()

    # Invitee email required → invitee without email is rejected.
    r2 = await ctx.client.post("/api/invite/link/req-flags-token/rsvp",
        json={**base, "phone": "+14155550100", "invitees": [{"full_name": "No Email Guest"}]})
    assert r2.status_code == 422 and "email is required" in r2.text.lower()

    # Satisfies both: submitter phone present (no email), invitee has email (no phone).
    r3 = await ctx.client.post("/api/invite/link/req-flags-token/rsvp",
        json={**base, "phone": "+14155550100",
              "invitees": [{"full_name": "Emailed Guest", "email": "g@example.com"}]})
    assert r3.status_code == 201, r3.text
