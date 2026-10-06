from datetime import datetime, timedelta
import pytest
from sqlalchemy import select
from conftest import _Session
from app.models import Event, Guest, ScanEvent, Zone
from app.schemas import InviteSettingsUpdate


def test_five_layouts_and_invalid_setting():
    for name in ('classic','companion','journey','complete','app'):
        assert InviteSettingsUpdate(guest_hub_layout=name).guest_hub_layout == name
    with pytest.raises(ValueError):
        InviteSettingsUpdate(guest_hub_layout='unknown')


async def setup(ctx):
    async with _Session() as db:
        event = await db.get(Event, ctx.ids['event_a'])
        event.guest_hub_layout = 'app'
        event.junior_guardian_handoff_enabled = True
        parent = (await db.execute(select(Guest).where(Guest.event_id == event.id))).scalars().first()
        parent.rsvp_status='confirmed'
        parent.invite_token='app-parent'
        child=Guest(event_id=event.id,first_name='Child',last_name='Demo',qr_token='app-child-qr',invite_token='app-child',rsvp_status='confirmed',rsvp_submitter_guest_id=parent.id,admitted=True)
        guardian=Guest(event_id=event.id,first_name='Guardian',last_name='Demo',qr_token='app-guardian-qr',invite_token='app-guardian',rsvp_status='confirmed')
        other_event=Event(org_id=ctx.ids['org_b'],name='Other event',couples_name='Other',event_date=datetime(2026,12,24),checkin_base_url='http://test')
        db.add(other_event);await db.flush()
        other=Guest(event_id=other_event.id,first_name='Other',last_name='Event',qr_token='app-other-qr',invite_token='app-other',rsvp_status='confirmed')
        db.add_all([child,guardian,other]);await db.flush()
        event.guardian_authorizations={child.id:[{'guardian_guest_id':parent.id,'source':'rsvp_submitter'},{'guardian_guest_id':guardian.id,'source':'guardian_hub_other'}],other.id:[{'guardian_guest_id':parent.id,'source':'admin'}]}
        await db.commit()
        return parent.id,child.id,guardian.id


@pytest.mark.asyncio
async def test_party_credentials_do_not_flow_up_to_parent_or_across_event(ctx):
    parent, child, guardian=await setup(ctx)
    response=await ctx.client.get('/api/invite/token/app-parent/app-party')
    assert response.status_code==200,response.text
    assert response.headers['cache-control']=='no-store, private'
    own=next(r for r in response.json()['members'] if r['id']==parent)
    ticket=await ctx.client.get(f"/api/scan/{own['qr_token']}/ticket")
    assert ticket.status_code==200,ticket.text
    assert ticket.json()['event']['guest_hub_layout']=='app'
    assert {r['id'] for r in response.json()['members']}=={parent,child}
    response=await ctx.client.get('/api/invite/token/app-child/app-party')
    assert {r['id'] for r in response.json()['members']}=={child}
    assert response.json()['members'][0]['is_junior']
    response=await ctx.client.get('/api/invite/token/app-guardian/app-party')
    assert {r['id'] for r in response.json()['members']}=={guardian}
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a'])
        event.guardian_authorizations={child:[{'guardian_guest_id':guardian,'source':'guardian_hub_other','confirmed_at':'2026-10-06T12:00:00Z'}]}
        await db.commit()
    response=await ctx.client.get('/api/invite/token/app-guardian/app-party')
    assert {r['id'] for r in response.json()['members']}=={guardian,child}
    assert (await ctx.client.get('/api/invite/token/not-real/app-party')).status_code==404


@pytest.mark.asyncio
async def test_status_uses_latest_allowed_scan_and_confirmed_handoff(ctx):
    parent,child,_=await setup(ctx)
    now=datetime.utcnow()
    async with _Session() as db:
        zone=Zone(event_id=ctx.ids['event_a'],name='Junior room',capacity=10)
        db.add(zone);await db.flush()
        db.add_all([ScanEvent(event_id=ctx.ids['event_a'],guest_id=child,zone_id=zone.id,direction='in',scanned_at=now-timedelta(minutes=2)),ScanEvent(event_id=ctx.ids['event_a'],guest_id=child,zone_id=zone.id,direction='out',scanned_at=now,denied=True)])
        await db.commit();zone_id=zone.id
    response=await ctx.client.get('/api/invite/token/app-parent/app-party')
    row=next(r for r in response.json()['members'] if r['id']==child)
    assert row['status']=='In Junior room' and row['status_at'].endswith('Z')
    async with _Session() as db:
        db.add(ScanEvent(event_id=ctx.ids['event_a'],guest_id=child,zone_id=zone_id,direction='out',scanned_at=now+timedelta(seconds=1),guardian_guest_id=parent))
        await db.commit()
    row=next(r for r in (await ctx.client.get('/api/invite/token/app-parent/app-party')).json()['members'] if r['id']==child)
    assert row['status']=='Collected'


@pytest.mark.asyncio
async def test_unconfirmed_member_has_no_pass_and_other_layouts_do_not_expose_endpoint(ctx):
    _,child,_=await setup(ctx)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.rsvp_enabled=True
        row=await db.get(Guest,child);row.rsvp_status='pending';row.admitted=False
        await db.commit()
    row=next(r for r in (await ctx.client.get('/api/invite/token/app-parent/app-party')).json()['members'] if r['id']==child)
    assert row['qr_token'] is None
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.guest_hub_layout='classic';await db.commit()
    assert (await ctx.client.get('/api/invite/token/app-parent/app-party')).status_code==404


@pytest.mark.asyncio
async def test_event_app_setting_persists_without_changing_other_settings(ctx):
    ctx.login(ctx.ids['user_a'])
    url=f"/api/events/{ctx.ids['event_a']}/invite-settings"
    response=await ctx.client.put(url,json={'guest_hub_layout':'app'})
    assert response.status_code==200,response.text
    assert response.json()['guest_hub_layout']=='app'
    async with _Session() as db:
        row=await db.get(Event,ctx.ids['event_a'])
        assert row.guest_hub_layout=='app'
        assert row.name=='A Wedding'
    assert (await ctx.client.put(url,json={'guest_hub_layout':'unknown'})).status_code==422
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.put(url,json={'guest_hub_layout':'classic'})).status_code in (403,404)
