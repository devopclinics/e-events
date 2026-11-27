"""Venue boundaries and personal-token party authorization, with real admission."""
from datetime import datetime, timezone, timedelta
import pytest
from sqlalchemy import select, func
from app.models import Event, Guest
from conftest import _Session
from test_self_checkin import _prep, _add

CONFIG = {"geofence_enabled": True, "party_enabled": True,
          "latitude": 32.83539, "longitude": -97.0144, "radius_m": 150}


def location(**overrides):
    return {"latitude": CONFIG["latitude"], "longitude": CONFIG["longitude"],
            "accuracy_m": 15, "captured_at": datetime.now(timezone.utc).isoformat(), **overrides}


async def setup(ctx):
    ev = ctx.ids["event_a"]
    await _prep(ev)
    ctx.login(ctx.ids["user_a"])
    lead = await _add(ctx, ev, "Primary", "Attendee")
    arrived = await _add(ctx, ev, "Arrived", "Companion")
    later = await _add(ctx, ev, "Later", "Companion")
    stranger = await _add(ctx, ev, "Other", "Party")
    async with _Session() as db:
        event = await db.get(Event, ev)
        event.self_checkin_config = CONFIG.copy()
        for row in (lead, arrived, later):
            guest = await db.get(Guest, row["id"])
            guest.rsvp_submitter_guest_id = lead["id"]
            guest.invite_token = f"personal-invite-{row['id']}"
        await db.commit()
    token = f"personal-invite-{lead['id']}"
    return ev, lead, arrived, later, stranger, token


async def admit(ctx, token, ids, **overrides):
    return await ctx.client.post('/api/e/RHOEDA25/party/checkin', json={
        "token": token, "guest_ids": ids, "confirm_arrived": True,
        "location": location(), **overrides,
    })


@pytest.mark.asyncio
async def test_only_selected_arrivals_admitted_and_retry_is_idempotent(ctx):
    ev, lead, arrived, later, other, token = await setup(ctx)
    info = (await ctx.client.get('/api/e/RHOEDA25')).json()
    assert info['location_required'] and info['personal_link_required'] and info['party_enabled']
    assert 'latitude' not in str(info)
    party = await ctx.client.post('/api/e/RHOEDA25/party', json={"token": token})
    assert party.status_code == 200
    assert party.headers['cache-control'] == 'no-store, private'
    assert {m['id'] for m in party.json()['members']} == {lead['id'], arrived['id'], later['id']}
    assert all(set(m) == {'id', 'name', 'admitted'} for m in party.json()['members'])
    response = await admit(ctx, token, [lead['id'], arrived['id']])
    assert response.status_code == 200, response.text
    assert [r['status'] for r in response.json()] == ['admitted', 'admitted']
    async with _Session() as db:
        assert (await db.get(Guest, later['id'])).admitted is False
        assert (await db.get(Guest, other['id'])).admitted is False
        first = (await db.get(Guest, arrived['id'])).admitted_at
    retry = await admit(ctx, token, [arrived['id'], arrived['id']])
    assert [r['status'] for r in retry.json()] == ['already_admitted']
    async with _Session() as db:
        assert (await db.get(Guest, arrived['id'])).admitted_at == first


@pytest.mark.asyncio
@pytest.mark.parametrize('bad_location', [None, location(latitude=33), location(accuracy_m=500),
    location(captured_at=(datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat()),
    location(captured_at=(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat())])
async def test_location_failure_does_not_admit_anyone(ctx, bad_location):
    ev, lead, arrived, later, other, token = await setup(ctx)
    response = await admit(ctx, token, [lead['id'], arrived['id']], location=bad_location)
    assert response.status_code == 403, response.text
    async with _Session() as db:
        assert not await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id == ev, Guest.admitted.is_(True)))


@pytest.mark.asyncio
async def test_other_party_id_rejects_whole_selection_and_member_cannot_admit_parent(ctx):
    ev, lead, arrived, later, other, token = await setup(ctx)
    response = await admit(ctx, token, [lead['id'], other['id']])
    assert response.status_code == 403
    member_token = f"personal-invite-{arrived['id']}"
    party = await ctx.client.post('/api/e/RHOEDA25/party', json={'token': member_token})
    assert [m['id'] for m in party.json()['members']] == [arrived['id']]
    assert (await admit(ctx, member_token, [lead['id']])).status_code == 403
    async with _Session() as db:
        assert not (await db.get(Guest, lead['id'])).admitted


@pytest.mark.asyncio
async def test_no_bypass_through_legacy_endpoints_and_confirmation_required(ctx):
    ev, lead, arrived, later, other, token = await setup(ctx)
    assert (await ctx.client.post(f"/api/e/RHOEDA25/checkin/{lead['id']}")).status_code == 403
    assert (await ctx.client.post('/api/e/RHOEDA25/search', json={'query': 'Primary'})).status_code == 403
    assert (await admit(ctx, token, [lead['id']], confirm_arrived=False)).status_code == 422
    assert (await admit(ctx, token, [])).status_code == 422
    assert (await admit(ctx, 'invalid-personal-token', [lead['id']])).status_code == 404


@pytest.mark.asyncio
async def test_closed_event_and_wrong_event_token_denied(ctx):
    ev, lead, arrived, later, other, token = await setup(ctx)
    async with _Session() as db:
        event = await db.get(Event, ev)
        event.self_checkin_enabled = False
        await db.commit()
    assert (await admit(ctx, token, [lead['id']])).status_code == 403


@pytest.mark.asyncio
async def test_configuration_validation_and_tenant_access(ctx):
    ev, *rest = await setup(ctx)
    path = f'/api/events/{ev}/self-checkin-config'
    assert (await ctx.client.patch(path, json=CONFIG)).status_code == 200
    for config in ({'geofence_enabled': True}, {**CONFIG, 'radius_m': 1}, {**CONFIG, 'latitude': 91}):
        assert (await ctx.client.patch(path, json=config)).status_code == 422
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.patch(path, json=CONFIG)).status_code in (403, 404)


@pytest.mark.asyncio
async def test_each_person_retains_admission_denials(ctx):
    ev, lead, arrived, later, other, token = await setup(ctx)
    async with _Session() as db:
        guest = await db.get(Guest, arrived['id'])
        guest.rsvp_status = 'declined'
        await db.commit()
    response = await admit(ctx, token, [lead['id'], arrived['id']])
    assert response.status_code == 200
    assert {r['status'] for r in response.json()} == {'admitted', 'denied'}
    async with _Session() as db:
        assert not (await db.get(Guest, arrived['id'])).admitted


@pytest.mark.asyncio
async def test_geofence_also_protects_single_guest_without_party_mode(ctx):
    ev, lead, arrived, later, other, token = await setup(ctx)
    async with _Session() as db:
        event = await db.get(Event, ev)
        event.self_checkin_config = {**CONFIG, 'party_enabled': False}
        await db.commit()
    path = f"/api/e/RHOEDA25/checkin/{lead['id']}"
    assert (await ctx.client.post(path)).status_code == 403
    assert (await ctx.client.post(path, json={'location': location(latitude=33)})).status_code == 403
    assert (await ctx.client.post(path, json={'location': location()})).json()['status'] == 'admitted'


@pytest.mark.asyncio
async def test_token_from_another_event_is_rejected(ctx):
    ev, lead, arrived, later, other, token = await setup(ctx)
    async with _Session() as db:
        event = Event(org_id=ctx.ids['org_b'], name='Other Venue Event', couples_name='Other',
                      event_date=datetime(2027, 1, 1), status='active', is_paid=True, checkin_base_url='http://test')
        db.add(event)
        await db.flush()
        db.add(Guest(event_id=event.id, first_name='Foreign', last_name='Guest',
                     invite_token='foreign-personal-invite-token', qr_token='foreign-qr-token'))
        await db.commit()
    response = await admit(ctx, 'foreign-personal-invite-token', [lead['id']])
    assert response.status_code == 404
    async with _Session() as db:
        assert not (await db.get(Guest, lead['id'])).admitted


def test_event_template_preserves_venue_protection():
    from app.routers.events import _DUPLICATE_TEMPLATE_FIELDS
    assert 'self_checkin_config' in _DUPLICATE_TEMPLATE_FIELDS
