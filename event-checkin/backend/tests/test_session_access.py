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

@pytest.mark.asyncio
async def test_conference_general_seating_then_dinner_uses_existing_tables(ctx):
    from app.models import SeatingTable
    eid,gid,qr,conf,dinner,gate=await prep(ctx)
    async with _Session() as db:
        event=await db.get(Event,eid);event.seating_enabled=True
        guest=await db.get(Guest,gid);guest.admitted=False
        table=SeatingTable(event_id=eid,name='Dinner 1',capacity=2);db.add(table);await db.commit();tid=table.id
    base=f'/api/events/{eid}/session-access'
    for zone,mode in [(conf,'none'),(dinner,'event')]:
        assert (await ctx.client.put(base+'/'+zone+'/seating',json={'mode':mode})).status_code==200
        await ctx.client.put(base+'/'+zone,json={'guest_ids':[gid],'decision':'allow'})
    response=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf})
    assert not response.json()['denied'],response.text
    assert response.json()['table_name'] is None
    async with _Session() as db:
        guest=await db.get(Guest,gid);assert guest.admitted and guest.table_id is None and guest.seat_number is None
    response=await ctx.client.post(f'/api/events/{eid}/gates/{gate}/scan',json={'qr_token':qr})
    assert response.json()['allowed'],response.text
    assert response.json()['table_name']=='Dinner 1' and response.json()['seat_number']=='1'
    response=await ctx.client.post(f'/api/events/{eid}/gates/{gate}/scan',json={'qr_token':qr})
    assert not response.json()['allowed'] and 'already inside' in response.json()['message']
    async with _Session() as db:
        guest=await db.get(Guest,gid);assert guest.table_id==tid and guest.seat_number=='1'
    response=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf,'direction':'out'})
    assert not response.json()['denied'] and response.json()['table_name'] is None

@pytest.mark.asyncio
async def test_dinner_assigned_only_and_full_tables_do_not_record_entry(ctx):
    from app.models import SeatingTable
    eid,gid,qr,conf,dinner,gate=await prep(ctx)
    async with _Session() as db:
        event=await db.get(Event,eid);event.seating_enabled=True
        table=SeatingTable(event_id=eid,name='Full dinner table',capacity=1);db.add(table);await db.flush()
        other=Guest(event_id=eid,first_name='Seated',last_name='Guest',table_id=table.id,seat_number='1');db.add(other)
        await db.commit();tid=table.id
    base=f'/api/events/{eid}/session-access'
    await ctx.client.put(base+'/'+dinner,json={'guest_ids':[gid],'decision':'allow'})
    await ctx.client.put(base+'/'+dinner+'/seating',json={'mode':'assigned'})
    response=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':dinner})
    assert response.json()['denied'] and 'No table assigned' in response.json()['deny_reason']
    async with _Session() as db:
        guest=await db.get(Guest,gid);guest.table_id=tid;await db.commit()
    response=await ctx.client.post(f'/api/events/{eid}/gates/{gate}/scan',json={'qr_token':qr})
    assert not response.json()['allowed'] and 'full' in response.json()['message']
    async with _Session() as db:
        guest=await db.get(Guest,gid);assert guest.seat_number is None
        scans=(await db.scalars(select(ScanEvent).where(ScanEvent.guest_id==gid,ScanEvent.zone_id==dinner))).all();assert all(s.denied for s in scans)
    await ctx.client.put(base+'/'+dinner,json={'guest_ids':[gid],'decision':'block'})
    response=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':dinner})
    assert response.json()['denied'] and 'Blocked' in response.json()['deny_reason']

@pytest.mark.asyncio
async def test_session_seating_modes_scope_and_preserve_other_preferences(ctx):
    eid,gid,qr,conf,dinner,gate=await prep(ctx)
    root=f'/api/events/{eid}/session-access'
    assert (await ctx.client.put(root+'/'+conf+'/seating',json={'mode':'unknown'})).status_code==422
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.put(root+'/'+conf+'/seating',json={'mode':'none'})).status_code==404
    ctx.login(ctx.ids['superadmin'])
    await ctx.client.put(root+'/'+conf+'/seating',json={'mode':'none'})
    response=await ctx.client.get(root)
    assert next(z for z in response.json()['zones'] if z['id']==conf)['seating_mode']=='none'
    async with _Session() as db:
        e=await db.get(Event,eid);assert set(e.setup_preferences['restricted_session_ids'])=={conf,dinner}
    await ctx.client.put(root+'/'+conf+'/seating',json={'mode':'default'})
    async with _Session() as db:
        from app.services.session_access import seating_at_admission
        assert seating_at_admission(await db.get(Event,eid))

@pytest.mark.asyncio
async def test_session_notifications_test_scope_and_no_denied_or_duplicate_receipts(ctx, monkeypatch):
    from app.services import session_notifications as receipts
    emails=[];whatsapp=[]
    async def email(data): emails.append(data)
    async def wa(**kwargs): whatsapp.append(kwargs);return {'status':'queued'}
    async def reserve(*args,**kwargs):return True
    async def credit(ledger,send,**kwargs):await send(**kwargs)
    monkeypatch.setattr(receipts,'_send_email',email)
    monkeypatch.setattr(receipts.messaging,'_channel_ready',lambda *args:True)
    monkeypatch.setattr(receipts.messaging,'_bird_whatsapp_send',wa)
    monkeypatch.setattr(receipts,'reserve_message_credit',reserve)
    monkeypatch.setattr(receipts,'send_with_credit_ledger',credit)
    monkeypatch.setattr(receipts,'can_use_paid_channels',lambda event:True)
    eid,gid,qr,conf,dinner,gate=await prep(ctx)
    async with _Session() as db:
        e=await db.get(Event,eid);e.notify_email=True;e.notify_whatsapp=True
        e.channel_policy={'session_checkin':{'mode':'all','channels':['email','whatsapp']}}
        g=await db.get(Guest,gid);g.phone='+18327941707';g.whatsapp_consent=True
        e.setup_preferences={**e.setup_preferences,'session_seating_modes':{conf:'none'},'session_checkin_notifications':{'enabled':True,'audience':'test','test_guest_ids':[gid],'zone_ids':[conf,dinner],'whatsapp_templates':{'link':'approved-link','table':'approved-table'}}}
        await db.commit()
    root=f'/api/events/{eid}/session-access'
    await ctx.client.put(root+'/'+conf,json={'guest_ids':[gid],'decision':'allow'})
    await ctx.client.put(root+'/'+dinner,json={'guest_ids':[gid],'decision':'block'})
    result=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf})
    assert result.json()['notifications']=={'email':'queued','whatsapp':'queued'},result.text
    assert len(emails)==1 and emails[0]['table_name'] is None and emails[0]['seat_number'] is None
    assert whatsapp[0]['template']=='approved-link' and whatsapp[0]['var_keys']==['firstName','eventName','hubLink']
    await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf})
    denied=await ctx.client.post(f'/api/events/{eid}/gates/{gate}/scan',json={'qr_token':qr})
    assert not denied.json()['allowed'] and denied.json()['notifications']=={}
    await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf,'direction':'out'})
    assert len(emails)==len(whatsapp)==1
    async with _Session() as db:
        e=await db.get(Event,eid);e.setup_preferences={**e.setup_preferences,'session_checkin_notifications':{**e.setup_preferences['session_checkin_notifications'],'test_guest_ids':[]}};await db.commit()
    await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf})
    assert len(emails)==len(whatsapp)==1


@pytest.mark.asyncio
async def test_zone_binding_completes_only_matching_accepted_session(ctx):
    from app.models import ExperienceWorkflow, ExperienceStep, GuestExperienceProgress
    eid,gid,qr,conf,dinner,gate=await prep(ctx)
    async with _Session() as db:
        e=await db.get(Event,eid);e.experience_enabled=True
        w=ExperienceWorkflow(event_id=eid,status='published');db.add(w);await db.flush()
        step=ExperienceStep(workflow_id=w.id,key='conference',type='session_attendance',title='Conference',required=False,enabled=True);db.add(step);await db.flush();sid=step.id
        e.setup_preferences={**e.setup_preferences,'session_attendance_steps':{conf:sid}}
        await db.commit()
    base=f'/api/events/{eid}/session-access'
    # Denied access never completes attendance.
    r=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf});assert r.json()['denied']
    async with _Session() as db:
        assert not await db.scalar(select(GuestExperienceProgress).where(GuestExperienceProgress.guest_id==gid,GuestExperienceProgress.step_id==sid,GuestExperienceProgress.status=='completed'))
    template=(await ctx.client.post(f'/api/events/{eid}/certificate-templates',json={'name':'Conference attendance','design':{},'eligibility':{'minimum_sessions':1,'require_event_checkin':True,'required_session_ids':[sid]},'active':True})).json()
    before=(await ctx.client.get(f'/api/events/{eid}/certificate-candidates',params={'template_id':template['id']})).json()
    assert not next(row for row in before if row['guest_id']==gid)['eligible']
    await ctx.client.put(base+'/'+conf,json={'guest_ids':[gid],'decision':'allow'})
    r=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf});assert r.status_code==200,r.text;assert not r.json()['denied']
    after=(await ctx.client.get(f'/api/events/{eid}/certificate-candidates',params={'template_id':template['id']})).json()
    assert next(row for row in after if row['guest_id']==gid)['eligible']
    async with _Session() as db:
        p=await db.scalar(select(GuestExperienceProgress).where(GuestExperienceProgress.guest_id==gid,GuestExperienceProgress.step_id==sid));assert p.status=='completed';assert p.completed_by_source=='zone_scan';assert p.progress_metadata['zone_id']==conf
        finished=p.completed_at
    await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf,'direction':'out'})
    await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf})
    async with _Session() as db:
        p=await db.scalar(select(GuestExperienceProgress).where(GuestExperienceProgress.guest_id==gid,GuestExperienceProgress.step_id==sid));assert p.completed_at==finished


@pytest.mark.asyncio
async def test_bad_zone_binding_rolls_back_admission(ctx):
    eid,gid,qr,conf,dinner,gate=await prep(ctx)
    async with _Session() as db:
        e=await db.get(Event,eid);e.setup_preferences={**e.setup_preferences,'session_attendance_steps':{conf:'foreign-or-missing'}};await db.commit()
    await ctx.client.put(f'/api/events/{eid}/session-access/{conf}',json={'guest_ids':[gid],'decision':'allow'})
    r=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':conf});assert r.status_code==409,r.text
    async with _Session() as db:
        assert not (await db.scalars(select(ScanEvent).where(ScanEvent.event_id==eid,ScanEvent.zone_id==conf))).all()
