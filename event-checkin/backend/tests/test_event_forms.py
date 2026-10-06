import pytest
from sqlalchemy import select
from conftest import _Session
from app.models import Event, Guest, EventFormSubmission, EventFormRevision, Zone
from app.services.event_forms import missing_requirements
from test_experience_guest_hub import _setup, TOKEN

async def setup(ctx):
    guest_id,_=await _setup(ctx,with_consent=False)
    ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.is_paid=True;event.plan_tier='tier300';event.guest_cap=300
        await db.commit()
    return guest_id, f"/api/events/{ctx.ids['event_a']}"

async def create(ctx,url,**changes):
    payload={'title':'Event consent','body':'Review and accept participation.','questions':[],**changes}
    r=await ctx.client.post(url+'/forms',json=payload);assert r.status_code==201,r.text
    return r.json()

async def publish(ctx,url,form):
    r=await ctx.client.post(url+f"/forms/{form['id']}/publish?version={form['version']}");assert r.status_code==200,r.text
    return r.json()

async def submit(ctx,url,form,guest,token=TOKEN,**changes):
    return await ctx.client.post(url+f"/forms/{form['id']}/submit?token={token}",json={'guest_id':guest,'revision_id':form['revision_id'],'signer_name':'Demo Adult','accepted':True,'answers':{},**changes})

@pytest.mark.asyncio
async def test_independent_forms_timing_idempotency_versions_and_receipts(ctx):
    guest,url=await setup(ctx)
    event_form=await create(ctx,url)
    sports=await create(ctx,url,title='Sports',timing='after_admission')
    assert (await ctx.client.get(url+f'/forms/me?token={TOKEN}')).json()['forms']==[]
    await publish(ctx,url,event_form);await publish(ctx,url,sports)
    listing=await ctx.client.get(url+f'/forms/me?token={TOKEN}')
    assert listing.headers['cache-control']=='no-store, private'
    assert len(listing.json()['forms'])==2
    r=await submit(ctx,url,event_form,guest);assert r.status_code==201,r.text
    receipt=r.json()['receipt_id']
    assert (await submit(ctx,url,event_form,guest)).json()['receipt_id']==receipt
    assert (await submit(ctx,url,sports,guest)).status_code==403
    old=await ctx.client.get(url+f'/form-receipts/{receipt}?token={TOKEN}')
    assert old.json()['form']['body']=='Review and accept participation.'
    revision=await ctx.client.put(url+f"/forms/{event_form['id']}",json={'title':'New terms','body':'Revised wording','expected_version':1})
    assert revision.status_code==200,revision.text
    # Draft changes never replace published wording.
    listing=(await ctx.client.get(url+f'/forms/me?token={TOKEN}')).json()['forms']
    assert next(f for f in listing if f['id']==event_form['id'])['status']=='complete'
    await publish(ctx,url,revision.json())
    assert (await submit(ctx,url,event_form,guest)).status_code==409
    listing=(await ctx.client.get(url+f'/forms/me?token={TOKEN}')).json()['forms']
    assert next(f for f in listing if f['id']==event_form['id'])['status']=='pending'
    assert (await ctx.client.get(url+f'/form-receipts/{receipt}?token={TOKEN}')).json()['form']['body']=='Review and accept participation.'
    assert len((await ctx.client.get(url+'/form-records?history=true')).json())==1
    await ctx.client.delete(url+f"/forms/{event_form['id']}")
    assert (await ctx.client.get(url+f'/form-receipts/{receipt}?token={TOKEN}')).status_code==200
    async with _Session() as db:
        rows=(await db.scalars(select(EventFormSubmission))).all();assert len(rows)==1

@pytest.mark.asyncio
async def test_pickup_is_not_consent_authority_and_revocation(ctx):
    parent,url=await setup(ctx)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.junior_guardian_handoff_enabled=True
        child=Guest(event_id=event.id,first_name='Child',last_name='Demo',invite_token='forms-child',rsvp_status='confirmed',rsvp_guest_type='child',rsvp_submitter_guest_id=parent)
        db.add(child);await db.flush();child_id=child.id
        event.guardian_authorizations={child.id:[{'guardian_guest_id':parent,'source':'admin'}]}
        await db.commit()
    form=await create(ctx,url,audience_kind='juniors',signer_policy='guardian');await publish(ctx,url,form)
    assert (await submit(ctx,url,form,child_id,guardian_attestation=True)).status_code==403
    assert (await submit(ctx,url,form,child_id,token='forms-child')).status_code==403
    permission={'guest_id':child_id,'signer_guest_id':parent,'relationship':'parent','verified':True}
    r=await ctx.client.put(url+'/consent-authorities',json=permission);assert r.status_code==200,r.text
    visible=(await ctx.client.get(url+f'/forms/me?token={TOKEN}')).json()['forms'];assert len(visible)==1 and visible[0]['on_behalf']
    assert (await submit(ctx,url,form,child_id)).status_code==422
    r=await submit(ctx,url,form,child_id,guardian_attestation=True);assert r.status_code==201,r.text
    receipt=(await ctx.client.get(url+f"/form-receipts/{r.json()['receipt_id']}?token={TOKEN}")).json()
    assert receipt['relationship']=='parent' and receipt['guest_name']=='Child Demo'
    await ctx.client.put(url+'/consent-authorities',json={**permission,'active':False})
    new=await create(ctx,url,audience_kind='juniors');await publish(ctx,url,new)
    assert (await submit(ctx,url,new,child_id,guardian_attestation=True)).status_code==403

@pytest.mark.asyncio
async def test_event_scope_answers_audience_and_zone_requirement(ctx):
    guest,url=await setup(ctx)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);row=await db.get(Guest,guest);row.rsvp_notes='Age group: Adults'
        zone=Zone(event_id=event.id,name='Sports',capacity=10);db.add(zone);await db.commit();zone_id=zone.id
    form=await create(ctx,url,zone_id=zone_id,conditions={'age_groups_include':['Adults']},questions=[{'key':'choice','label':'Choose an option','type':'select','required':True,'options':['Yes','No']}]);await publish(ctx,url,form)
    assert (await submit(ctx,url,form,guest,answers={})).status_code==422
    assert (await submit(ctx,url,form,guest,answers={'choice':'Invalid'})).status_code==422
    assert (await submit(ctx,url,form,guest,answers={'choice':'Yes'},accepted=False)).status_code==422
    async with _Session() as db:
        assert await missing_requirements(await db.get(Event,ctx.ids['event_a']),await db.get(Guest,guest),db,zone_id=zone_id)==['Event consent']
    r=await submit(ctx,url,form,guest,answers={'choice':'Yes'});assert r.status_code==201,r.text
    async with _Session() as db:
        assert await missing_requirements(await db.get(Event,ctx.ids['event_a']),await db.get(Guest,guest),db,zone_id=zone_id)==[]
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.get(url+'/form-records')).status_code in (403,404)
    assert (await ctx.client.post(url+'/forms',json={'title':'Bad','body':'Bad'})).status_code in (403,404)
    assert (await ctx.client.get(url+'/forms/me?token=invalid')).status_code==404

@pytest.mark.asyncio
async def test_concurrent_editor_stale_version_and_cross_event_links(ctx):
    _,url=await setup(ctx);form=await create(ctx,url)
    assert (await ctx.client.put(url+f"/forms/{form['id']}",json={'title':'Changed','body':'Changed','expected_version':0})).status_code==409
    assert (await ctx.client.post(url+'/forms',json={'title':'Bad','body':'Bad','zone_id':'not-this-event'})).status_code==422
    assert (await ctx.client.post(url+'/forms',json={'title':'Bad','body':'Bad','conditions':{'invented_rule':['x']}})).status_code==422

@pytest.mark.asyncio
async def test_real_zone_scanner_blocks_entry_until_signed_but_never_blocks_exit(ctx):
    guest,url=await setup(ctx)
    ctx.login(ctx.ids['superadmin'])
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.status='active';event.venue_access_enabled=True
        row=await db.get(Guest,guest);qr=row.qr_token
        await db.commit()
    zone_response=await ctx.client.post(url+'/zones',json={'name':'Sports','direction_mode':'both'})
    assert zone_response.status_code==201,zone_response.text
    zone_id=zone_response.json()['id']
    form=await create(ctx,url,zone_id=zone_id);await publish(ctx,url,form)
    scan=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':zone_id,'direction':'in'})
    assert scan.status_code==200,scan.text
    assert scan.json()['denied'] and 'Complete required forms' in scan.json()['deny_reason']
    assert (await submit(ctx,url,form,guest)).status_code==201
    scan=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':zone_id,'direction':'in'})
    assert scan.status_code==200 and not scan.json()['denied'],scan.text
    # A newly published requirement must not trap attendees inside a zone.
    another=await create(ctx,url,title='New requirement',zone_id=zone_id);await publish(ctx,url,another)
    scan=await ctx.client.post(f'/api/scan/{qr}/zone',json={'zone_id':zone_id,'direction':'out'})
    assert scan.status_code==200 and not scan.json()['denied'],scan.text

@pytest.mark.asyncio
async def test_session_completion_enforces_required_form(ctx):
    from app.models import ExperienceStep, ExperienceWorkflow
    from app.services.experience import complete_guest_step, ExperienceCompletionError
    guest,url=await setup(ctx)
    async with _Session() as db:
        workflow=await db.scalar(select(ExperienceWorkflow).where(ExperienceWorkflow.event_id==ctx.ids['event_a']))
        step=ExperienceStep(workflow_id=workflow.id,key='sports',title='Sports',type='session_attendance',enabled=True,conditions={})
        db.add(step);await db.commit();step_id=step.id
    form=await create(ctx,url,step_id=step_id);await publish(ctx,url,form)
    async with _Session() as db:
        with pytest.raises(ExperienceCompletionError,match='Complete required forms'):
            await complete_guest_step(db,event=await db.get(Event,ctx.ids['event_a']),guest=await db.get(Guest,guest),step=await db.get(ExperienceStep,step_id),source='staff')
    assert (await submit(ctx,url,form,guest)).status_code==201
    async with _Session() as db:
        _,new=await complete_guest_step(db,event=await db.get(Event,ctx.ids['event_a']),guest=await db.get(Guest,guest),step=await db.get(ExperienceStep,step_id),source='staff')
        assert new

@pytest.mark.asyncio
async def test_unconfirmed_guest_and_unrelated_receipt_access_are_rejected(ctx):
    guest,url=await setup(ctx);form=await create(ctx,url);await publish(ctx,url,form)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.rsvp_enabled=True
        row=await db.get(Guest,guest);row.admitted=False;row.rsvp_status='invited'
        outsider=Guest(event_id=event.id,first_name='Unrelated',last_name='Guest',invite_token='unrelated-token',rsvp_status='confirmed')
        db.add(outsider);await db.commit()
    assert (await submit(ctx,url,form,guest)).status_code==403
    async with _Session() as db:
        row=await db.get(Guest,guest);row.rsvp_status='confirmed';await db.commit()
    r=await submit(ctx,url,form,guest);assert r.status_code==201,r.text
    receipt=r.json()['receipt_id']
    assert (await ctx.client.get(url+f'/form-receipts/{receipt}?token=unrelated-token')).status_code==403

@pytest.mark.asyncio
async def test_existing_guest_deletion_handles_new_form_records(ctx):
    guest,url=await setup(ctx);form=await create(ctx,url);await publish(ctx,url,form)
    assert (await submit(ctx,url,form,guest)).status_code==201
    r=await ctx.client.delete(url+f'/guests/{guest}');assert r.status_code==204,r.text
    async with _Session() as db:
        assert not (await db.scalars(select(EventFormSubmission).where(EventFormSubmission.guest_id==guest))).all()
