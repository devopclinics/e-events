import pytest
from sqlalchemy import select
from app.models import Event, Organization, Guest
from conftest import _Session

@pytest.mark.asyncio
@pytest.mark.parametrize('state', ['draft', 'cancelled', 'suspended', 'blocked', 'active'])
async def test_public_and_personal_routes_enforce_publication(ctx, state):
    eid=ctx.ids['event_a']
    async with _Session() as db:
        event=await db.get(Event,eid)
        event.status='active' if state!='draft' else 'draft'
        event.rsvp_token='policy-review-token'
        event.invite_message='PRIVATE ATTACKER CONTENT'
        event.cancelled=state=='cancelled'
        if state=='blocked': event.setup_preferences={'abuse_review':{'status':'blocked'}}
        if state=='suspended': (await db.get(Organization,event.org_id)).is_active=False
        guest=await db.scalar(select(Guest).where(Guest.event_id==eid))
        guest.invite_token='policy-personal-token'
        await db.commit()
    for path in [f'/api/invite/{eid}','/api/invite/link/policy-review-token','/api/invite/token/policy-personal-token']:
        res=await ctx.client.get(path)
        assert res.status_code==(200 if state=='active' else 404 if state=='draft' else 410),res.text
        if state!='active':assert 'PRIVATE ATTACKER CONTENT' not in res.text
    if state!='active':
        res=await ctx.client.post(f'/api/invite/{eid}/recover',json={'email':'g@a.com'})
        assert res.status_code in [404,410],res.text

@pytest.mark.asyncio
async def test_queued_send_does_not_call_provider_for_blocked_event(ctx,monkeypatch):
    from services import credit_ledger
    from app.models import MessageCreditLedger
    eid=ctx.ids['event_a']
    async with _Session() as db:
        e=await db.get(Event,eid);e.setup_preferences={'abuse_review':{'status':'blocked'}}
        row=MessageCreditLedger(event_id=eid,org_id=e.org_id,action='reserve',status='reserved')
        db.add(row);await db.commit(); lid=row.id
    monkeypatch.setattr(credit_ledger,'AsyncSessionLocal',_Session)
    calls=[]
    async def provider(**kwargs): calls.append('provider')
    async def refund(*args,**kwargs): calls.append(kwargs['reason'])
    monkeypatch.setattr(credit_ledger,'refund_ledger_by_id',refund)
    await credit_ledger.send_with_credit_ledger(lid,provider)
    assert calls==['event_communications_blocked']

@pytest.mark.asyncio
async def test_direct_email_is_stopped_before_provider_for_suspended_tenant(ctx,monkeypatch):
    from services import email_service
    from app import database
    from email.mime.multipart import MIMEMultipart
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a'])
        (await db.get(Organization,e.org_id)).is_active=False
        await db.commit()
    monkeypatch.setattr(database,'AsyncSessionLocal',_Session)
    recorded=[]
    async def record(*args,**kwargs):recorded.append(kwargs['status'])
    monkeypatch.setattr(email_service,'_record_email_delivery',record)
    async def forbidden(*args,**kwargs):pytest.fail('Provider or billing must not run')
    monkeypatch.setattr(email_service,'_charge_email_credit',forbidden)
    monkeypatch.setattr(email_service,'_send_via_resend',forbidden)
    msg=MIMEMultipart();msg['To']='guest@example.test';msg['X-Festio-Event-Id']=ctx.ids['event_a']
    assert await email_service._send(msg) is False
    assert recorded==['blocked_event_safety']

@pytest.mark.parametrize('value,blocked',[
    ('https://ndkskxkd.com/402004',True),
    ('https://a.ndkskxkd.com/another',True),
    ('https://NDKSKXKD.COM',True),
    ('https://notndkskxkd.com',False),
    ('https://ndkskxkd.com.example.org',False),
    ('Vinted networking event: no external verification',False),
])
def test_confirmed_indicator_is_scoped_to_destination_host(value,blocked):
    from app.services.public_event_policy import invitation_content_blocked
    assert invitation_content_blocked(value)==blocked

@pytest.mark.asyncio
async def test_saving_known_phishing_destination_is_rejected(ctx):
    ctx.login(ctx.ids['user_a'])
    res=await ctx.client.put(f"/api/events/{ctx.ids['event_a']}/invite-settings",json={'invite_message':'https://ndkskxkd.com/402004'})
    assert res.status_code==422,res.text
    async with _Session() as db:
        assert 'ndkskxkd' not in ((await db.get(Event,ctx.ids['event_a'])).invite_message or '')

@pytest.mark.asyncio
async def test_abuse_blocks_pass_and_qr_image(ctx):
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);e.setup_preferences={'abuse_review':{'status':'blocked'}}
        g=await db.scalar(select(Guest).where(Guest.event_id==e.id));qr=g.qr_token
        await db.commit()
    for endpoint in ['ticket','qr.png']:
        res=await ctx.client.get(f'/api/scan/{qr}/{endpoint}')
        assert res.status_code==410,res.text


def test_quick_invite_edit_and_studio_input_reject_confirmed_destination():
    from app.routers.quick_invites import InviteDraft
    from pydantic import ValidationError
    from datetime import datetime,timezone
    import uuid
    with pytest.raises(ValidationError,match='blocked destination'):
        InviteDraft(name='Test',event_date=datetime.now(timezone.utc),timezone='UTC',message='https://ndkskxkd.com/402004',request_id=uuid.uuid4())
