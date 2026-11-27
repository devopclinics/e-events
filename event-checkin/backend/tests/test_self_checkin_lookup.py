import pytest
from sqlalchemy import select
from app.models import Event, Guest
from conftest import _Session
from test_venue_party_checkin import setup, location, admit, CONFIG

async def prepare(ctx):
    data = await setup(ctx)
    ev, lead, arrived, later, other, token = data
    async with _Session() as db:
        event = await db.get(Event, ev)
        event.self_checkin_config = {**CONFIG, 'lookup_enabled': True}
        guest = await db.get(Guest, lead['id'])
        guest.email = 'primary@example.test'
        guest.phone = '+18325550123'
        await db.commit()
    return data

async def lookup(ctx, query, **overrides):
    return await ctx.client.post('/api/e/RHOEDA25/lookup', json={'query': query, 'location': location(), **overrides})

@pytest.mark.asyncio
@pytest.mark.parametrize('query', ['Primary', 'primary attendee', ' PRIMARY@EXAMPLE.TEST ', '(832) 555-0123', '+1 832 555 0123'])
async def test_name_phone_and_email_find_same_registration_without_exposing_pass(ctx, query):
    ev, lead, *rest = await prepare(ctx)
    result = await lookup(ctx, query)
    assert result.status_code == 200, result.text
    assert result.headers['cache-control'] == 'no-store, private'
    rows = result.json()['matches']
    assert len(rows) == 1 and rows[0]['name'] == 'Primary Attendee'
    assert set(rows[0]) == {'name', 'lookup_token'}
    selected = await ctx.client.post('/api/e/RHOEDA25/party', json={'token': rows[0]['lookup_token']})
    assert selected.status_code == 200 and selected.json()['viewer_id'] == lead['id']
    assert len(selected.json()['members']) == 3
    assert 'primary@example.test' not in result.text and '+18325550123' not in result.text

@pytest.mark.asyncio
async def test_location_is_required_before_search_and_again_before_admission(ctx):
    ev, lead, arrived, later, other, _ = await prepare(ctx)
    assert (await lookup(ctx, 'Primary', location=None)).status_code == 403
    assert (await lookup(ctx, 'Primary', location=location(latitude=33))).status_code == 403
    token = (await lookup(ctx, 'Primary')).json()['matches'][0]['lookup_token']
    assert (await admit(ctx, token, [lead['id']], location=None)).status_code == 403
    response = await admit(ctx, token, [lead['id'], arrived['id']])
    assert response.status_code == 200 and {r['status'] for r in response.json()} == {'admitted'}
    async with _Session() as db:
        assert not (await db.get(Guest, later['id'])).admitted

@pytest.mark.asyncio
async def test_lookup_selection_cannot_admit_another_rsvp_and_member_cannot_admit_parent(ctx):
    ev, lead, arrived, later, other, _ = await prepare(ctx)
    token = (await lookup(ctx, 'Primary')).json()['matches'][0]['lookup_token']
    assert (await admit(ctx, token, [lead['id'], other['id']])).status_code == 403
    child_token = (await lookup(ctx, 'Arrived')).json()['matches'][0]['lookup_token']
    assert (await admit(ctx, child_token, [lead['id']])).status_code == 403
    async with _Session() as db:
        assert not (await db.get(Guest, lead['id'])).admitted

@pytest.mark.asyncio
async def test_lookup_tokens_expire_are_unforgeable_and_revocable(ctx, monkeypatch):
    from app.routers import self_checkin
    ev, lead, *rest = await prepare(ctx)
    token = (await lookup(ctx, 'Primary')).json()['matches'][0]['lookup_token']
    forged = token[:-1] + ('0' if token[-1] != '0' else '1')
    assert (await ctx.client.post('/api/e/RHOEDA25/party', json={'token': forged})).status_code == 403
    now = self_checkin.time.time()
    monkeypatch.setattr(self_checkin.time, 'time', lambda: now + 601)
    assert (await ctx.client.post('/api/e/RHOEDA25/party', json={'token': token})).status_code == 403
    monkeypatch.setattr(self_checkin.time, 'time', lambda: now)
    async with _Session() as db:
        event = await db.get(Event, ev)
        event.self_checkin_config = {**CONFIG, 'lookup_enabled': False}
        await db.commit()
    assert (await ctx.client.post('/api/e/RHOEDA25/party', json={'token': token})).status_code == 403
    assert (await lookup(ctx, 'Primary')).status_code == 403

@pytest.mark.asyncio
async def test_lookup_never_browses_guest_list_or_matches_partial_contacts(ctx):
    await prepare(ctx)
    for query in ['Pr', '%', 'primary@', '5550123', 'missing@example.test']:
        result = await lookup(ctx, query)
        assert result.status_code == 200 and not result.json()['matches']

@pytest.mark.asyncio
async def test_too_many_name_matches_require_refinement_and_lookup_is_opt_in(ctx):
    ev, *rest = await prepare(ctx)
    async with _Session() as db:
        for i in range(7): db.add(Guest(event_id=ev, first_name='Common', last_name=f'Name{i}'))
        await db.commit()
    result = await lookup(ctx, 'Common')
    assert not result.json()['matches'] and 'narrow' in result.json()['message']
    info = (await ctx.client.get('/api/e/RHOEDA25')).json()
    assert info['lookup_enabled'] and not info['personal_link_required']

@pytest.mark.asyncio
async def test_lookup_needs_geofence_and_admin_configuration(ctx):
    ev, *rest = await prepare(ctx)
    url=f'/api/events/{ev}/self-checkin-config'
    response = await ctx.client.patch(url, json={'lookup_enabled': True})
    assert response.status_code == 422
