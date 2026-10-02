import pytest
from sqlalchemy import select

from app.models import Event, Guest, ScanEvent
from conftest import _Session


@pytest.mark.asyncio
async def test_guardian_handoff_is_opt_in_and_audited(ctx):
    event_id = ctx.ids["event_a"]
    ctx.login(ctx.ids["superadmin"])
    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.is_paid = True
        event.status = "active"
        event.venue_access_enabled = True
        await db.commit()

    zone = (await ctx.client.post(f"/api/events/{event_id}/zones", json={"name": "Junior A", "direction_mode": "both"})).json()
    async def guest(first):
        response = await ctx.client.post(f"/api/events/{event_id}/guests", json={"first_name": first, "last_name": "Demo"})
        assert response.status_code == 201, response.text
        return response.json()

    child, guardian, stranger = await guest("Child"), await guest("Guardian"), await guest("Stranger")

    # Existing behavior is unchanged while the new capability is disabled.
    plain = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": "in"})
    assert plain.status_code == 200 and plain.json()["denied"] is False
    await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": "out"})

    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.junior_guardian_handoff_enabled = True
        event.separate_admission_access_enabled = True
        event.guardian_authorizations = {child["id"]: [{"guardian_guest_id": guardian["id"], "relationship": "Parent"}]}
        child_row = await db.get(Guest, child["id"])
        child_row.admitted = False
        child_row.admitted_at = None
        await db.commit()

    before_admission = await ctx.client.post(
        f"/api/scan/{child['qr_token']}/zone",
        json={"zone_id": zone["id"], "direction": "in", "guardian_token": guardian["qr_token"]},
    )
    assert before_admission.json()["denied"] is True
    assert "check in to the convention" in before_admission.json()["deny_reason"]

    admission = await ctx.client.post(f"/api/scan/{child['qr_token']}")
    assert admission.status_code == 200 and admission.json()["status"] == "admitted"

    missing = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": "in"})
    assert missing.json()["denied"] is True
    wrong = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": "in", "guardian_token": stranger["qr_token"]})
    assert wrong.json()["denied"] is True

    for direction in ("in", "out", "in", "out"):
        response = await ctx.client.post(f"/api/scan/{child['qr_token']}/zone", json={"zone_id": zone["id"], "direction": direction, "guardian_token": guardian["qr_token"]})
        assert response.status_code == 200 and response.json()["denied"] is False
        assert response.json()["guardian_name"] == "Guardian Demo"
        assert response.json()["guardian_verification_method"] == "guardian_qr"

    config = await ctx.client.get(f"/api/events/{event_id}/access/guardian-authorizations")
    assert config.status_code == 200
    assert config.json()["authorizations"][0]["guardian_name"] == "Guardian Demo"

    update = await ctx.client.put(
        f"/api/events/{event_id}/access/guardian-authorizations",
        json={"enabled": True, "authorizations": [{
            "child_guest_id": child["id"], "guardian_guest_id": guardian["id"], "relationship": "Parent"
        }]},
    )
    assert update.status_code == 200 and update.json()["enabled"] is True

    movements = await ctx.client.get(f"/api/events/{event_id}/access/movements")
    assert movements.status_code == 200
    verified_movements = [row for row in movements.json() if row["guardian_guest_id"]]
    assert len(verified_movements) == 4
    assert all(row["guardian_name"] == "Guardian Demo" for row in verified_movements)

    journey = await ctx.client.get(f"/api/events/{event_id}/guests/{child['id']}/journey")
    assert journey.status_code == 200
    assert len([row for row in journey.json() if row["guardian_name"] == "Guardian Demo"]) == 4

    async with _Session() as db:
        rows = (await db.execute(ScanEvent.__table__.select().where(ScanEvent.guest_id == child["id"]))).all()
        verified = [row for row in rows if row.guardian_guest_id]
        assert len(verified) == 4
        assert all(row.guardian_relationship == "Parent" and row.scanned_by == ctx.ids["superadmin"].id for row in verified)


@pytest.mark.asyncio
async def test_admin_round_trip_does_not_un_confirm_pending_entry(ctx):
    """A pending (source='rsvp_other', confirmed_at=None) entry must survive an
    admin GET -> edit -> PUT round trip untouched — otherwise saving the admin
    panel for any reason silently defeats the confirmation gate."""
    event_id = ctx.ids["event_a"]
    ctx.login(ctx.ids["superadmin"])
    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.is_paid = True
        event.venue_access_enabled = True
        await db.commit()

    async def guest(first):
        response = await ctx.client.post(f"/api/events/{event_id}/guests", json={"first_name": first, "last_name": "Demo"})
        return response.json()

    child, pending_guardian, admin_guardian = await guest("Child2"), await guest("Other Party Member"), await guest("Admin Named")

    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.junior_guardian_handoff_enabled = True
        event.guardian_authorizations = {
            child["id"]: [
                {"guardian_guest_id": pending_guardian["id"], "relationship": "Aunt", "source": "rsvp_other", "confirmed_at": None},
                {"guardian_guest_id": admin_guardian["id"], "relationship": "Uncle"},
            ]
        }
        await db.commit()

    config = (await ctx.client.get(f"/api/events/{event_id}/access/guardian-authorizations")).json()
    rows = config["authorizations"]
    pending_row = next(r for r in rows if r["guardian_guest_id"] == pending_guardian["id"])
    admin_row = next(r for r in rows if r["guardian_guest_id"] == admin_guardian["id"])
    assert pending_row["status"] == "pending"
    assert pending_row["source"] == "rsvp_other" and pending_row["confirmed_at"] is None
    assert admin_row["status"] == "admin"

    # Admin adds a brand-new, unrelated authorization and saves (round-trips
    # the rows it loaded from GET, echoing source/confirmed_at back verbatim).
    stranger = await guest("New Admin Guardian")
    new_row = {"child_guest_id": child["id"], "guardian_guest_id": stranger["id"], "relationship": "Neighbor"}
    update = await ctx.client.put(
        f"/api/events/{event_id}/access/guardian-authorizations",
        json={"enabled": True, "designation_scope": "party", "authorizations": rows + [new_row]},
    )
    assert update.status_code == 200
    saved = {r["guardian_guest_id"]: r for r in update.json()["authorizations"]}
    assert saved[pending_guardian["id"]]["status"] == "pending"  # NOT silently confirmed
    assert saved[pending_guardian["id"]]["source"] == "rsvp_other"
    assert saved[admin_guardian["id"]]["status"] == "admin"
    assert saved[stranger["id"]]["status"] == "admin"  # genuinely new row, legacy shape


async def _rsvp_guests_by_name(ev):
    async with _Session() as s:
        guests = (await s.execute(select(Guest).where(Guest.event_id == ev))).scalars().all()
        return {f"{g.first_name} {g.last_name}".strip(): g for g in guests}


@pytest.mark.asyncio
async def test_rsvp_non_junior_invitee_gets_no_guardian_tracking(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "rsvp-junior-token-1"
        event.rsvp_require_approval = False
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 5
        event.junior_guardian_handoff_enabled = True
        event.is_paid = True
        event.guest_cap = 20
        await s.commit()

    response = await ctx.client.post(
        "/api/invite/link/rsvp-junior-token-1/rsvp",
        json={
            "first_name": "Parent", "last_name": "One", "email": "parent1@example.com",
            "answers": {},
            "invitees": [{"full_name": "Adult Guest", "is_junior": False}],
        },
    )
    assert response.status_code == 201, response.text

    async with _Session() as s:
        event = await s.get(Event, ev)
        assert not (event.guardian_authorizations or {})


@pytest.mark.asyncio
async def test_rsvp_submitter_auto_authorized_no_confirmation_needed(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "rsvp-junior-token-2"
        event.rsvp_require_approval = False
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 5
        event.junior_guardian_handoff_enabled = True
        event.checkout_enabled = True
        event.status = "active"
        event.is_paid = True
        event.guest_cap = 20
        await s.commit()

    response = await ctx.client.post(
        "/api/invite/link/rsvp-junior-token-2/rsvp",
        json={
            "first_name": "Parent", "last_name": "Two", "email": "parent2@example.com",
            "answers": {},
            "invitees": [{"full_name": "Junior Two", "is_junior": True}],
        },
    )
    assert response.status_code == 201, response.text

    by_name = await _rsvp_guests_by_name(ev)
    parent, child = by_name["Parent Two"], by_name["Junior Two"]

    async with _Session() as s:
        event = await s.get(Event, ev)
        entries = event.guardian_authorizations[child.id]
        assert len(entries) == 1
        assert entries[0]["guardian_guest_id"] == parent.id
        assert entries[0]["source"] == "rsvp_submitter"
        assert entries[0]["confirmed_at"] is not None
        child_row = await s.get(Guest, child.id)
        child_row.admitted = True
        await s.commit()

    # No confirm step needed — submitter can check the child out immediately.
    checkout = await ctx.client.post(
        f"/api/scan/{child.qr_token}/checkout", json={"guardian_token": parent.qr_token},
    )
    assert checkout.json()["status"] == "checked_out"


@pytest.mark.asyncio
async def test_rsvp_third_party_designation_needs_confirmation(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "rsvp-junior-token-3"
        event.rsvp_require_approval = False
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 5
        event.junior_guardian_handoff_enabled = True
        event.checkout_enabled = True
        event.status = "active"
        event.is_paid = True
        event.guest_cap = 20
        await s.commit()

    # invitees[0] = Junior Three (is_junior), invitees[1] = Aunt Three (not a
    # junior) — Junior Three designates invitees[1] (index 1) as an additional
    # pickup-authorized guardian.
    response = await ctx.client.post(
        "/api/invite/link/rsvp-junior-token-3/rsvp",
        json={
            "first_name": "Parent", "last_name": "Three", "email": "parent3@example.com",
            "answers": {},
            "invitees": [
                {"full_name": "Junior Three", "is_junior": True, "pickup_authorized_by_invitee_indices": [1]},
                {"full_name": "Aunt Three", "is_junior": False},
            ],
        },
    )
    assert response.status_code == 201, response.text

    by_name = await _rsvp_guests_by_name(ev)
    parent, child, aunt = by_name["Parent Three"], by_name["Junior Three"], by_name["Aunt Three"]

    async with _Session() as s:
        event = await s.get(Event, ev)
        entries = {e["guardian_guest_id"]: e for e in event.guardian_authorizations[child.id]}
        assert entries[parent.id]["source"] == "rsvp_submitter" and entries[parent.id]["confirmed_at"]
        assert entries[aunt.id]["source"] == "rsvp_other" and entries[aunt.id]["confirmed_at"] is None
        child_row = await s.get(Guest, child.id)
        child_row.admitted = True
        await s.commit()

    # Surfaced on the aunt's own token page.
    aunt_page = await ctx.client.get(f"/api/invite/token/{aunt.invite_token}")
    assert aunt_page.status_code == 200
    pending = aunt_page.json()["pending_guardian_confirmations"]
    assert len(pending) == 1 and pending[0]["child_guest_id"] == child.id

    # Not yet usable at checkout.
    denied = await ctx.client.post(
        f"/api/scan/{child.qr_token}/checkout", json={"guardian_token": aunt.qr_token},
    )
    assert denied.json()["status"] == "guardian_required"

    # Confirming via the aunt's own token flips it.
    confirm = await ctx.client.post(
        f"/api/invite/token/{aunt.invite_token}/guardian-authorizations/confirm", json={},
    )
    assert confirm.status_code == 200
    assert child.id in confirm.json()["confirmed"]

    # Now usable.
    ok = await ctx.client.post(
        f"/api/scan/{child.qr_token}/checkout", json={"guardian_token": aunt.qr_token},
    )
    assert ok.json()["status"] == "checked_out"

    # Aunt's pending list is now empty.
    aunt_page_after = await ctx.client.get(f"/api/invite/token/{aunt.invite_token}")
    assert aunt_page_after.json()["pending_guardian_confirmations"] == []


@pytest.mark.asyncio
async def test_guardian_confirm_cannot_touch_others_entries(ctx):
    ev = ctx.ids["event_a"]
    ctx.login(ctx.ids["user_a"])
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.junior_guardian_handoff_enabled = True
        await s.commit()

    async def guest(first):
        response = await ctx.client.post(f"/api/events/{ev}/guests", json={"first_name": first, "last_name": "Confirm"})
        return response.json()

    child, real_guardian, unrelated = await guest("ChildX"), await guest("RealGuardian"), await guest("Unrelated")
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.guardian_authorizations = {
            child["id"]: [{"guardian_guest_id": real_guardian["id"], "relationship": "Aunt", "source": "rsvp_other", "confirmed_at": None}],
        }
        await s.commit()

    attempt = await ctx.client.post(
        f"/api/invite/token/{unrelated['qr_token']}/guardian-authorizations/confirm",
        json={"child_guest_ids": [child["id"]]},
    )
    assert attempt.status_code == 200
    assert attempt.json()["confirmed"] == []

    async with _Session() as s:
        event = await s.get(Event, ev)
        assert event.guardian_authorizations[child["id"]][0]["confirmed_at"] is None


async def _rsvp_junior_party(ctx, ev, token, parent_name, child_name):
    """Submit a 1-parent + 1-junior-child RSVP, check the child in, and return
    (parent_guest, child_guest) dicts from the DB (with current qr/invite tokens)."""
    response = await ctx.client.post(
        f"/api/invite/link/{token}/rsvp",
        json={
            "first_name": parent_name, "last_name": "Hub", "email": f"{parent_name.lower()}@example.com",
            "answers": {},
            "invitees": [{"full_name": f"{child_name} Hub", "is_junior": True}],
        },
    )
    assert response.status_code == 201, response.text
    by_name = await _rsvp_guests_by_name(ev)
    parent, child = by_name[f"{parent_name} Hub"], by_name[f"{child_name} Hub"]
    async with _Session() as s:
        child_row = await s.get(Guest, child.id)
        child_row.admitted = True
        await s.commit()
    return parent, child


@pytest.mark.asyncio
async def test_guesthub_party_scope_add_succeeds_without_search(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "rsvp-hub-token-1"
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 5
        event.junior_guardian_handoff_enabled = True
        event.guardian_designation_scope = "party"
        event.is_paid = True
        event.guest_cap = 20
        await s.commit()

    # Two separate RSVP parties — Family A's parent, Family A's child, and a
    # third guest from a DIFFERENT family to prove cross-party isn't allowed
    # under party scope.
    parent_a, child_a = await _rsvp_junior_party(ctx, ev, "rsvp-hub-token-1", "ParentA", "ChildA")
    response_b = await ctx.client.post(
        "/api/invite/link/rsvp-hub-token-1/rsvp",
        json={"first_name": "ParentB", "last_name": "Hub", "email": "parentb@example.com", "answers": {}, "invitees": []},
    )
    assert response_b.status_code == 201
    by_name = await _rsvp_guests_by_name(ev)
    parent_b = by_name["ParentB Hub"]
    async with _Session() as s:
        row = await s.get(Guest, parent_b.id)
        row.admitted = True
        await s.commit()

    # Cross-party (parent_b is not in parent_a's party) rejected under "party" scope.
    cross = await ctx.client.post(
        f"/api/invite/token/{parent_a.invite_token}/guardian-authorizations",
        json={"child_guest_id": child_a.id, "guardian_guest_id": parent_b.id, "relationship": "Friend"},
    )
    assert cross.status_code == 400

    # Search is unavailable in party scope.
    search = await ctx.client.get(f"/api/invite/token/{parent_a.invite_token}/guardian-search?q=Pa")
    assert search.status_code == 400


@pytest.mark.asyncio
async def test_guesthub_any_guest_scope_search_and_add(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "rsvp-hub-token-2"
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 5
        event.junior_guardian_handoff_enabled = True
        event.guardian_designation_scope = "any_guest"
        event.checkout_enabled = True
        event.status = "active"
        event.is_paid = True
        event.guest_cap = 20
        await s.commit()
    ctx.login(ctx.ids["user_a"])

    parent_a, child_a = await _rsvp_junior_party(ctx, ev, "rsvp-hub-token-2", "ParentC", "ChildC")
    response_b = await ctx.client.post(
        "/api/invite/link/rsvp-hub-token-2/rsvp",
        json={"first_name": "Unrelated", "last_name": "Hub", "email": "unrelatedhub@example.com", "answers": {}, "invitees": []},
    )
    assert response_b.status_code == 201
    by_name = await _rsvp_guests_by_name(ev)
    stranger = by_name["Unrelated Hub"]

    # Not checked in yet — not searchable.
    not_found = await ctx.client.get(f"/api/invite/token/{parent_a.invite_token}/guardian-search?q=Unre")
    assert not_found.json() == []

    async with _Session() as s:
        row = await s.get(Guest, stranger.id)
        row.admitted = True
        await s.commit()

    found = await ctx.client.get(f"/api/invite/token/{parent_a.invite_token}/guardian-search?q=Unre")
    assert found.status_code == 200
    assert any(r["guest_id"] == stranger.id for r in found.json())

    add = await ctx.client.post(
        f"/api/invite/token/{parent_a.invite_token}/guardian-authorizations",
        json={"child_guest_id": child_a.id, "guardian_guest_id": stranger.id, "relationship": "Family friend"},
    )
    assert add.status_code == 200

    async with _Session() as s:
        event = await s.get(Event, ev)
        entries = {e["guardian_guest_id"]: e for e in event.guardian_authorizations[child_a.id]}
        assert entries[stranger.id]["source"] == "guardian_hub_other"
        assert entries[stranger.id]["confirmed_at"] is None

    # Not usable at checkout until confirmed.
    denied = await ctx.client.post(
        f"/api/scan/{child_a.qr_token}/checkout", json={"guardian_token": stranger.qr_token},
    )
    assert denied.json()["status"] == "guardian_required"

    confirm = await ctx.client.post(
        f"/api/invite/token/{stranger.invite_token}/guardian-authorizations/confirm", json={},
    )
    assert confirm.status_code == 200 and child_a.id in confirm.json()["confirmed"]

    ok = await ctx.client.post(
        f"/api/scan/{child_a.qr_token}/checkout", json={"guardian_token": stranger.qr_token},
    )
    assert ok.json()["status"] == "checked_out"


@pytest.mark.asyncio
async def test_guesthub_cannot_manage_guest_they_did_not_submit(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "rsvp-hub-token-3"
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 5
        event.junior_guardian_handoff_enabled = True
        event.guardian_designation_scope = "any_guest"
        event.is_paid = True
        event.guest_cap = 20
        await s.commit()

    parent_a, child_a = await _rsvp_junior_party(ctx, ev, "rsvp-hub-token-3", "ParentD", "ChildD")
    response_b = await ctx.client.post(
        "/api/invite/link/rsvp-hub-token-3/rsvp",
        json={"first_name": "ParentE", "last_name": "Hub", "email": "parente@example.com", "answers": {}, "invitees": []},
    )
    assert response_b.status_code == 201
    by_name = await _rsvp_guests_by_name(ev)
    parent_e = by_name["ParentE Hub"]

    # parent_e tries to manage parent_a's child — not theirs, must be rejected.
    attempt = await ctx.client.post(
        f"/api/invite/token/{parent_e.invite_token}/guardian-authorizations",
        json={"child_guest_id": child_a.id, "guardian_guest_id": parent_e.id, "relationship": "Friend"},
    )
    assert attempt.status_code == 403


@pytest.mark.asyncio
async def test_my_juniors_endpoint_scoped_to_own_party(ctx):
    ev = ctx.ids["event_a"]
    async with _Session() as s:
        event = await s.get(Event, ev)
        event.rsvp_enabled = True
        event.invite_mode = "open"
        event.rsvp_token = "rsvp-hub-token-4"
        event.rsvp_multi_invitee_enabled = True
        event.rsvp_multi_invitee_limit = 5
        event.junior_guardian_handoff_enabled = True
        event.guardian_designation_scope = "party"
        event.is_paid = True
        event.guest_cap = 20
        await s.commit()

    parent_a, child_a = await _rsvp_junior_party(ctx, ev, "rsvp-hub-token-4", "ParentF", "ChildF")
    response_b = await ctx.client.post(
        "/api/invite/link/rsvp-hub-token-4/rsvp",
        json={"first_name": "ParentG", "last_name": "Hub", "email": "parentg@example.com", "answers": {}, "invitees": []},
    )
    assert response_b.status_code == 201

    mine = await ctx.client.get(f"/api/invite/token/{parent_a.invite_token}/my-juniors")
    assert mine.status_code == 200
    body = mine.json()
    assert body["designation_scope"] == "party"
    assert len(body["juniors"]) == 1
    junior = body["juniors"][0]
    assert junior["child_guest_id"] == child_a.id
    assert junior["guardians"][0]["guardian_guest_id"] == parent_a.id
    assert junior["guardians"][0]["status"] == "confirmed"
    # ParentA's party is just their own child (ChildF) — ParentG is unrelated and must not appear.
    assert [p["guest_id"] for p in body["party"]] == [child_a.id]

    # ParentG (unrelated submission) has no juniors of their own.
    by_name = await _rsvp_guests_by_name(ev)
    parent_g = by_name["ParentG Hub"]
    theirs = await ctx.client.get(f"/api/invite/token/{parent_g.invite_token}/my-juniors")
    assert theirs.json()["juniors"] == []
