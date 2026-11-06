import pytest
from sqlalchemy import select
from app.models import Event,Guest,Zone,Gate,ScanEvent
from conftest import _Session

async def prep(ctx):
    ctx.login(ctx.ids['superadmin']); eid=ctx.ids['event_a']
    async with _Session() as db:
        e=await db.get(Event,eid);e.venue_access_enabled=True;e.is_paid=True;e.status='active';e.seating_enabled=False
        z1=Zone(event_id=eid,name='Conference',direction_mode='both');z2=Zone(event_id=eid,name='Dinner',direction_mode='both');db.add_all([z1,z2]);await db.flush()
        e.setup_preferences={'restricted_session_ids':[z1.id,z2.id]}
        g=await db.scalar(select(Guest).where(Guest.event_id==eid));g.admitted=True
        gate=Gate(event_id=eid,name='Dinner entry',zone_id=z2.id,direction='in');db.add(gate);await db.commit()
        return eid,g.id,g.qr_token,z1.id,z2.id,gate.id

@pytest.mark.asyncio
async def test_independent_entry_block_duplicate_and_exit(ctx):
    eid,gid,qr,conf,dinner,gate=await prep(ctx);root=f'/api/events/{eid}/session-access'
    async with _Session() as db:
        g=await db.get(Guest,gid);g.admitted=False;await db.commit()
    r=await ctx.client.put(root+'/'+conf,json={'guest_ids':[gid],'decision':'allow'});assert r.status_code==200,r.text
    r=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf});assert r.status_code==200,r.text;assert not r.json()['denied']
    r=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf});assert r.json()['denied'];assert 'already inside' in r.json()['deny_reason']
    r=await ctx.client.post(f'/api/events/{eid}/gates/{gate}/scan',json={'qr_token':qr});assert r.status_code==200,r.text;assert not r.json()['allowed'];assert 'approval' in r.json()['message']
    await ctx.client.put(root+'/'+dinner,json={'guest_ids':[gid],'decision':'allow'})
    r=await ctx.client.post(f'/api/events/{eid}/gates/{gate}/scan',json={'qr_token':qr});assert r.json()['allowed'],r.text
    await ctx.client.put(root+'/'+dinner,json={'guest_ids':[gid],'decision':'block'})
    r=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':dinner});assert r.json()['denied'];assert 'Blocked' in r.json()['deny_reason']
    r=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':dinner,'direction':'out'});assert not r.json()['denied'],r.text
    async with _Session() as db:
        scans=(await db.scalars(select(ScanEvent).where(ScanEvent.guest_id==gid))).all();assert sum(not s.denied and s.direction=='in' for s in scans)==2

@pytest.mark.asyncio
async def test_tenant_and_reset_review(ctx):
    eid,gid,qr,conf,dinner,gate=await prep(ctx);root=f'/api/events/{eid}/session-access'
    r=await ctx.client.put(root+'/'+conf,json={'guest_ids':[gid,'foreign-guest'],'decision':'allow'});assert r.status_code==404
    await ctx.client.put(root+'/'+conf,json={'guest_ids':[gid],'decision':'allow'})
    await ctx.client.put(root+'/'+conf,json={'guest_ids':[gid],'decision':'review'})
    r=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf});assert r.json()['denied'];assert 'approval' in r.json()['deny_reason']
    ctx.login(ctx.ids['user_b']);r=await ctx.client.get(root);assert r.status_code==404
    r=await ctx.client.put(root+'/'+conf,json={'guest_ids':[gid],'decision':'allow'});assert r.status_code==404

@pytest.mark.asyncio
async def test_existing_unrestricted_event_unchanged(ctx):
    eid,gid,qr,conf,dinner,gate=await prep(ctx)
    async with _Session() as db:
        e=await db.get(Event,eid);e.setup_preferences={};await db.commit()
    r=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf});assert not r.json()['denied'],r.text
    await ctx.client.put(f'/api/events/{eid}/session-access/{dinner}',json={'guest_ids':[gid],'decision':'block'})
    r=await ctx.client.post(f'/api/events/{eid}/gates/{gate}/scan',json={'qr_token':qr});assert not r.json()['allowed'];assert 'Blocked' in r.json()['message']


@pytest.mark.asyncio
async def test_guest_directory_exposes_scoped_session_decisions(ctx):
    eid,gid,qr,conf,dinner,gate=await prep(ctx)
    root=f'/api/events/{eid}/session-access'
    await ctx.client.put(root+'/'+conf,json={'guest_ids':[gid],'decision':'allow'})
    await ctx.client.put(root+'/'+dinner,json={'guest_ids':[gid],'decision':'block'})
    response=await ctx.client.get(f'/api/events/{eid}/guests')
    assert response.status_code==200,response.text
    guest=next(g for g in response.json() if g['id']==gid)
    statuses={s['name']:s for s in guest['session_access']}
    assert statuses['Conference']['decision']=='allow'
    assert statuses['Dinner']['decision']=='block'
    assert all(s['restricted'] for s in statuses.values())
    await ctx.client.put(root+'/'+conf,json={'guest_ids':[gid],'decision':'review'})
    guest=next(g for g in (await ctx.client.get(f'/api/events/{eid}/guests')).json() if g['id']==gid)
    assert next(s for s in guest['session_access'] if s['zone_id']==conf)['decision']=='review'
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(f'/api/events/{eid}/guests')).status_code==404
    async with _Session() as db:
        from datetime import datetime
        other_event=Event(org_id=ctx.ids['org_b'],name='Other event',couples_name='Other',event_date=datetime(2026,11,11),checkin_base_url='http://test')
        db.add(other_event);await db.flush()
        db.add(Guest(event_id=other_event.id,first_name='Other',last_name='Guest'))
        await db.commit();other_id=other_event.id
    other=await ctx.client.get(f"/api/events/{other_id}/guests")
    assert other.status_code==200,other.text
    assert all(g['session_access']==[] for g in other.json())
