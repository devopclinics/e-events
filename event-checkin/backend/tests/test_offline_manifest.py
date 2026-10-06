from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models import Event, ExperienceStep, ExperienceWorkflow, Guest
from conftest import _Session


async def prepare(ctx):
    event_id = ctx.ids['event_a']
    ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.status = 'active'
        event.seating_enabled = False
        event.section_mode_enabled = False
        event.manual_checkin_enabled = True
        event.junior_guardian_handoff_enabled = True
        await db.commit()
    return event_id


@pytest.mark.asyncio
async def test_manifest_has_explicit_utc_expiry_and_guardian_policy(ctx):
    event_id = await prepare(ctx)
    response = await ctx.client.get(f'/api/scan/offline-manifest/{event_id}')
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['version'] == 2
    assert data['event_id'] == event_id
    assert data['manual_checkin_enabled'] is True
    assert data['junior_guardian_handoff_enabled'] is True
    assert data['generated_at'].endswith('Z') and data['expires_at'].endswith('Z')
    generated = datetime.fromisoformat(data['generated_at'].replace('Z', '+00:00'))
    expires = datetime.fromisoformat(data['expires_at'].replace('Z', '+00:00'))
    assert (expires - generated).total_seconds() == 1800
    assert generated <= datetime.now(timezone.utc) < expires
    assert data['offline_admission_block_reason'] is None


@pytest.mark.asyncio
async def test_manifest_preserves_live_consent_and_seating_checks(ctx):
    event_id = await prepare(ctx)
    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.seating_enabled = True
        guest = await db.scalar(select(Guest).where(Guest.event_id == event_id))
        guest.seat_number = None
        guest_id = guest.id
        workflow = ExperienceWorkflow(event_id=event_id, name='Admission safety', status='published', version=1, is_default=True)
        db.add(workflow)
        await db.flush()
        db.add(ExperienceStep(workflow_id=workflow.id, key='consent', type='consent', title='Required consent', required=True, enabled=True, blocks_checkin=True))
        await db.commit()
    response = await ctx.client.get(f'/api/scan/offline-manifest/{event_id}')
    assert response.status_code == 200, response.text
    data = response.json()
    assert 'required admission steps' in data['offline_admission_block_reason']
    guest = next(g for g in data['guests'] if g['id'] == guest_id)
    assert 'seat' in guest['offline_admission_block_reason']


@pytest.mark.asyncio
async def test_manifest_requires_assignment_and_active_event(ctx):
    event_id = await prepare(ctx)
    ctx.login(ctx.ids['user_b'])
    denied = await ctx.client.get(f'/api/scan/offline-manifest/{event_id}')
    assert denied.status_code == 403
    ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.status = 'ended'
        await db.commit()
    inactive = await ctx.client.get(f'/api/scan/offline-manifest/{event_id}')
    assert inactive.status_code == 403
