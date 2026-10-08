"""Regression coverage for the comprehensive organizer UX audit."""
import json
from datetime import datetime
import pytest
from sqlalchemy import select, func
from conftest import _Session
from app.models import (Event, Guest, GuestProfileAudit, EventConsentAuthority,
    Organization, ExperienceWorkflow, GuestExperienceProgress, MenuCategory, MenuItem, GuestMenuChoice)
from app.config import settings
from app.services.festiome_outbox import guest_is_festiome_eligible
from app.services.credit_balance import available_credits

@pytest.mark.asyncio
async def test_import_preview_mapping_rolls_back_and_repeat_import_deduplicates(ctx):
    ctx.login(ctx.ids['user_a']); eid=ctx.ids['event_a']
    async with _Session() as db:
        before=await db.scalar(select(func.count()).select_from(Guest))
    file={'file':('guests.csv',b'Given,Family,Contact,Category,Unused\nAudit,Junior,audit@example.test,Child,ignore\n','text/csv')}
    mapping=json.dumps({'Given':'first_name','Family':'last_name','Contact':'email','Category':'rsvp_guest_type'})
    url=f'/api/events/{eid}/guests/upload'
    preview=await ctx.client.post(url+'?preview=true',files=file,data={'mapping':mapping})
    assert preview.status_code==200,preview.text
    assert preview.json()['result']['added']==1
    assert preview.json()['ignored']==['Unused']
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(Guest))==before
    result=await ctx.client.post(url,files=file,data={'mapping':mapping})
    assert result.status_code==200,result.text
    assert result.json()['added']==1
    repeat=await ctx.client.post(url,files=file,data={'mapping':mapping})
    assert repeat.status_code==200 and repeat.json()['added']==0
    async with _Session() as db:
        guest=await db.scalar(select(Guest).where(Guest.email=='audit@example.test'))
        assert guest.is_junior and guest.rsvp_guest_type=='Child'
    duplicate=await ctx.client.post(url+'?preview=true',files=file,data={'mapping':json.dumps({'Given':'first_name','Family':'first_name'})})
    assert duplicate.status_code==422

@pytest.mark.asyncio
async def test_role_correction_revokes_signing_authority_and_adult_chat_eligibility(ctx):
    ctx.login(ctx.ids['user_a']); eid=ctx.ids['event_a']
    async with _Session() as db:
        event=await db.get(Event,eid); event.is_paid=True;event.experience_enabled=True
        signer=await db.scalar(select(Guest).where(Guest.event_id==eid)); signer.rsvp_status='confirmed'
        child=Guest(event_id=eid,first_name='Other',last_name='Junior',is_junior=True)
        db.add(child);await db.flush()
        authority=EventConsentAuthority(event_id=eid,guest_id=child.id,signer_guest_id=signer.id,relationship='parent',active=True)
        db.add(authority);event.junior_guardian_handoff_enabled=True;event.guardian_authorizations={child.id:[{'guardian_guest_id':signer.id,'source':'admin'}]};event.festiome_access_policy={'mode':'approved_adults','adult_guest_ids':[signer.id]}
        await db.commit(); sid,cid,aid=signer.id,child.id,authority.id
    update=await ctx.client.patch(f'/api/events/{eid}/guests/{sid}',json={'rsvp_guest_type':'Youth participant','is_junior':True})
    assert update.status_code==200,update.text
    async with _Session() as db:
        signer=await db.get(Guest,sid); event=await db.get(Event,eid)
        assert not (await db.get(EventConsentAuthority,aid)).active
        assert not guest_is_festiome_eligible(signer,event)
        from app.routers.access import verify_guardian_handoff, usable_guardian_candidates
        child=await db.get(Guest,cid)
        assert await usable_guardian_candidates(event,child,db)==[]
        guardian,_,denial=await verify_guardian_handoff(event,child,signer.qr_token,db)
        assert guardian is None and denial
        log=await db.scalar(select(GuestProfileAudit).where(GuestProfileAudit.guest_id==sid))
        assert log.before['is_junior'] is False and log.after['is_junior'] is True
    grant=await ctx.client.put(f'/api/events/{eid}/consent-authorities',json={'guest_id':cid,'signer_guest_id':sid,'relationship':'parent','verified':True,'active':True})
    assert grant.status_code==422,grant.text

@pytest.mark.asyncio
async def test_draft_public_registration_is_blocked_without_creating_guest(ctx):
    eid=ctx.ids['event_a']
    async with _Session() as db:
        event=await db.get(Event,eid);event.status='draft';event.rsvp_enabled=True;event.invite_mode='open';event.rsvp_token='audit-draft'
        await db.commit();before=await db.scalar(select(func.count()).select_from(Guest))
    result=await ctx.client.post('/api/invite/link/audit-draft/rsvp',json={'first_name':'Demo','last_name':'Draft','email':'draft@example.com'})
    assert result.status_code==409,result.text
    async with _Session() as db:
        assert await db.scalar(select(func.count()).select_from(Guest))==before

@pytest.mark.asyncio
async def test_before_arrival_meal_selection_requires_confirmation_and_preserves_served_lock(ctx):
    eid=ctx.ids['event_a']
    async with _Session() as db:
        event=await db.get(Event,eid);event.is_paid=True;event.menu_enabled=True;event.status='active'
        guest=await db.scalar(select(Guest).where(Guest.event_id==eid));guest.admitted=False;guest.rsvp_status='confirmed';guest.meal_served=False
        category=MenuCategory(event_id=eid,name='Dinner',selection_type='single');db.add(category);await db.flush()
        item=MenuItem(event_id=eid,category_id=category.id,name='Organizer meal');db.add(item);await db.commit()
        gid,token,catid,itemid=guest.id,guest.qr_token,category.id,item.id
    url=f'/api/scan/{token}/menu';body={'single':{catid:itemid}}
    assert (await ctx.client.post(url,json=body)).status_code==400
    async with _Session() as db:
        event=await db.get(Event,eid);event.menu_selection_timing='before_arrival';await db.commit()
    allowed=await ctx.client.post(url,json=body)
    assert allowed.status_code==200,allowed.text
    async with _Session() as db:
        guest=await db.get(Guest,gid);guest.rsvp_status='pending';await db.commit()
    assert (await ctx.client.post(url,json=body)).status_code==400
    async with _Session() as db:
        guest=await db.get(Guest,gid);guest.rsvp_status='confirmed';guest.meal_served=True;await db.commit()
    assert (await ctx.client.post(url,json=body)).status_code in (400,403,409)

@pytest.mark.asyncio
async def test_wallet_balance_is_shared_across_events_without_overwriting_legacy_ledger(ctx,monkeypatch):
    monkeypatch.setattr(settings,'organization_entitlements_v2',True)
    async with _Session() as db:
        first=await db.get(Event,ctx.ids['event_a']);first.message_credits=0
        org=await db.get(Organization,first.org_id);org.message_credit_units=30099
        second=Event(org_id=org.id,name='Audit second event',couples_name='Demo',event_date=datetime(2026,12,24),checkin_base_url='http://test',message_credits=7)
        db.add(second);await db.flush()
        assert await available_credits(db,first)==3009.9
        assert await available_credits(db,second)==3009.9
        org.message_credit_units-=3
        assert await available_credits(db,first)==3009.6
        assert await available_credits(db,second)==3009.6
        assert (first.message_credits,second.message_credits)==(0,7)

@pytest.mark.asyncio
async def test_workflow_replacement_is_explicit_and_keeps_previous_history(ctx):
    eid=ctx.ids['event_a'];ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        event=await db.get(Event,eid);event.is_paid=True;event.plan_tier='tier300';event.paid_channels=True
        await db.commit()
    base=f'/api/events/{eid}/experience/workflows'
    async def create(name):
        result=await ctx.client.post(base,json={'name':name,'steps':[{'key':'arrival','type':'check_in','title':'Arrival'}]})
        assert result.status_code==201,result.text
        return result.json()['id']
    old=await create('Original');new=await create('Revised')
    assert (await ctx.client.post(f'{base}/{old}/publish')).status_code==200
    async with _Session() as db:
        before=list((await db.scalars(select(GuestExperienceProgress.id).where(GuestExperienceProgress.workflow_id==old))).all())
    assert (await ctx.client.post(f'{base}/{new}/publish?replace_workflow_id=stale')).status_code==409
    async with _Session() as db: assert (await db.get(ExperienceWorkflow,old)).status=='published'
    replacement=await ctx.client.post(f'{base}/{new}/publish?replace_workflow_id={old}')
    assert replacement.status_code==200,replacement.text
    async with _Session() as db:
        assert (await db.get(ExperienceWorkflow,old)).status=='archived'
        assert (await db.get(ExperienceWorkflow,new)).status=='published'
        assert list((await db.scalars(select(GuestExperienceProgress.id).where(GuestExperienceProgress.workflow_id==old))).all())==before

@pytest.mark.asyncio
async def test_invitation_preflight_does_not_send_or_mutate_guest(ctx):
    eid=ctx.ids['event_a'];ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        guest=await db.scalar(select(Guest).where(Guest.event_id==eid));gid=guest.id;before=(guest.invite_status,guest.invite_sent_at)
    result=await ctx.client.post(f'/api/events/{eid}/guests/send-preview',json={'guest_ids':[gid],'force':True})
    assert result.status_code==200,result.text
    assert result.json()['recipients']==1
    assert result.json()['estimated_credits']>=0
    async with _Session() as db:
        guest=await db.get(Guest,gid);assert (guest.invite_status,guest.invite_sent_at)==before

@pytest.mark.asyncio
async def test_custom_child_category_and_explicit_junior_survive_rsvp(ctx):
    eid=ctx.ids['event_a']
    async with _Session() as db:
        event=await db.get(Event,eid);event.status='active';event.is_paid=True;event.guest_cap=10
        event.rsvp_enabled=True;event.invite_mode='open';event.rsvp_token='audit-child';event.rsvp_require_approval=True
        event.rsvp_multi_invitee_enabled=True;event.rsvp_multi_invitee_limit=3
        event.rsvp_invitee_type_options=['Youth participant','Spouse'];event.rsvp_invitee_contact_exempt_types=['Youth participant']
        await db.commit()
    response=await ctx.client.post('/api/invite/link/audit-child/rsvp',json={'first_name':'Demo','last_name':'Parent','email':'parent@example.com','phone':'+14155550123','invitees':[{'full_name':'Demo Youth','guest_type':'Youth participant','is_junior':True}]})
    assert response.status_code==201,response.text
    async with _Session() as db:
        child=await db.scalar(select(Guest).where(Guest.event_id==eid,Guest.first_name=='Demo',Guest.last_name=='Youth'))
        assert child.is_junior and child.rsvp_guest_type=='Youth participant'

@pytest.mark.asyncio
async def test_new_chat_community_starts_with_explicit_adult_approval(ctx):
    from app.main import app
    from app.services.festiome_client import get_festiome_client
    from test_festiome_integration import FakeFestioMeClient
    app.dependency_overrides[get_festiome_client]=lambda:FakeFestioMeClient()
    eid=ctx.ids['event_a'];ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        event=await db.get(Event,eid);event.is_paid=True;event.festiome_addon_enabled=True;event.festiome_id=None;event.festiome_access_policy=None
        await db.commit()
    response=await ctx.client.post(f'/api/events/{eid}/festiome/enable')
    assert response.status_code==200,response.text
    async with _Session() as db:
        event=await db.get(Event,eid)
        assert event.festiome_access_policy=={'mode':'approved_adults','adult_guest_ids':[]}
        event.festiome_access_policy={'mode':'all_eligible'};await db.commit()
    assert (await ctx.client.post(f'/api/events/{eid}/festiome/enable')).status_code==200
    async with _Session() as db:assert (await db.get(Event,eid)).festiome_access_policy=={'mode':'all_eligible'}

@pytest.mark.asyncio
@pytest.mark.parametrize('currency',['USD','NGN'])
async def test_topup_and_catalog_share_prices_in_each_currency(ctx,currency):
    ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        org=await db.get(Organization,ctx.ids['org_a']);org.currency=currency;await db.commit()
    response=await ctx.client.get(f"/api/billing/tiers/{ctx.ids['event_a']}")
    assert response.status_code==200,response.text
    body=response.json();catalog=body['catalog']['addons']['message_credits']
    assert body['currency']==currency
    assert [(p['credits'],p['amount']) for p in body['packs']]==[(p['credits'],p['amount']) for p in catalog]

@pytest.mark.asyncio
async def test_content_session_picker_hides_archived_workflows_without_deleting_them(ctx):
    from app.models import ExperienceStep
    ctx.login(ctx.ids['user_a']); eid=ctx.ids['event_a']
    async with _Session() as db:
        for version,state in enumerate(('draft','published','archived'), start=1):
            workflow=ExperienceWorkflow(event_id=eid,name='Audit '+state,status=state,version=version)
            db.add(workflow);await db.flush()
            db.add(ExperienceStep(workflow_id=workflow.id,key='audit-'+state,type='session_attendance',title='Audit '+state,enabled=True,sort_order=0))
        await db.commit()
    response=await ctx.client.get(f'/api/events/{eid}/live-content/sessions')
    assert response.status_code==200,response.text
    titles={r['title'] for r in response.json()}
    assert {'Audit draft','Audit published'} <= titles
    assert 'Audit archived' not in titles
    async with _Session() as db:
        assert await db.scalar(select(ExperienceWorkflow).where(ExperienceWorkflow.event_id==eid,ExperienceWorkflow.name=='Audit archived')) is not None

@pytest.mark.asyncio
async def test_delivery_counts_distinguish_repeat_messages_and_failed_statuses(ctx):
    from app.models import EmailDeliveryEvent, MessageCreditLedger
    from app.message_delivery_report import email_delivery_report, channel_delivery_report
    eid=ctx.ids['event_a']
    async with _Session() as db:
        for msg,status in [('first','sent'),('first','delivered'),('second','sent'),('third','bounced')]:
            db.add(EmailDeliveryEvent(event_id=eid,provider='resend',provider_email_id=msg,recipient='repeat@example.test',event_type='email.'+status,status=status))
        db.add(MessageCreditLedger(org_id=ctx.ids['org_a'],event_id=eid,channel='sms',action='spend',status='undelivered',credits=1,delta=-1,balance_after=9))
        await db.commit()
        email=await email_delivery_report(db,eid)
        assert email['messages']==3 and email['recipients']==1
        assert email['delivered']==1 and email['failed']==1 and email['sent_unconfirmed']==1
        sms=(await channel_delivery_report(db,eid))['sms']
        assert sms['sent']==1 and sms['delivered']==0 and sms['failed']==1
