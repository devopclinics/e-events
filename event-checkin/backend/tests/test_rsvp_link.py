from sqlalchemy import delete

import pytest

from app.models import Event, Guest, RSVPQuestion, TableGroup, TicketType
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
