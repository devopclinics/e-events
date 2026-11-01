from datetime import datetime
import pytest
from sqlalchemy import select
from app.models import Event, Guest
from app.routers import guests as routes
from conftest import _Session


async def prepare(ctx, monkeypatch, mode='open', reachable=True):
    ctx.login(ctx.ids['superadmin'])
    async def no_send(*args, **kwargs):
        return True
    monkeypatch.setattr(routes, 'send_invite_email', no_send)
    monkeypatch.setattr(routes, 'send_manual_invite_email', no_send)
    monkeypatch.setattr(routes, 'send_simple_email', no_send)
    monkeypatch.setattr(routes, 'channels_for_flow', lambda *a, **k: ['email'] if reachable else [])
    monkeypatch.setattr(routes, 'recipient_allowed', lambda *a, **k: True)
    async with _Session() as db:
        event = await db.get(Event, ctx.ids['event_a'])
        event.invite_mode=mode;event.rsvp_enabled=True;event.guest_hub_layout="app"
        guest=await db.scalar(select(Guest).where(Guest.event_id==event.id))
        guest.rsvp_status='invited';guest.qr_generated_at=datetime.utcnow()
        result=dict(event_id=event.id,guest_id=guest.id,qr_token=guest.qr_token)
        await db.commit()
    return result


@pytest.mark.asyncio
@pytest.mark.parametrize('action',['send-batch','send-invites','resend-invite','resend-email'])
async def test_sending_entry_pass_confirms_registration_without_checkin(ctx,monkeypatch,action):
    g=await prepare(ctx,monkeypatch)
    party=f"/api/invite/token/{g['qr_token']}/app-party"
    before=await ctx.client.get(party)
    assert before.status_code==200 and before.json()['members'][0]['qr_token'] is None
    root=f"/api/events/{g['event_id']}/guests"
    if action=='send-batch':response=await ctx.client.post(root+'/send-batch',json={'guest_ids':[g['guest_id']],'force':True})
    elif action=='send-invites':response=await ctx.client.post(root+'/send-invites')
    elif action=='resend-email':response=await ctx.client.post(root+f"/{g['guest_id']}/resend-email",json={'kind':'invitation'})
    else:response=await ctx.client.post(root+f"/{g['guest_id']}/resend-invite")
    assert response.status_code==200,response.text
    async with _Session() as db:
        guest=await db.get(Guest,g['guest_id'])
        assert guest.rsvp_status=='confirmed' and guest.invite_status=='sent'
        assert not guest.admitted and guest.admitted_at is None
        assert guest.rsvp_responded_at is None and guest.qr_token==g['qr_token']
    after=await ctx.client.get(party)
    assert after.json()['members'][0]['qr_token']==g['qr_token']


@pytest.mark.asyncio
@pytest.mark.parametrize('mode,reachable',[('closed',True),('open',False)])
async def test_rsvp_invitation_and_unreachable_pass_do_not_confirm(ctx,monkeypatch,mode,reachable):
    g=await prepare(ctx,monkeypatch,mode,reachable)
    response=await ctx.client.post(f"/api/events/{g['event_id']}/guests/send-batch",json={'guest_ids':[g['guest_id']]})
    assert response.status_code==200,response.text
    async with _Session() as db:
        guest=await db.get(Guest,g['guest_id'])
        assert guest.rsvp_status=='invited' and not guest.admitted
        assert guest.invite_status==('sent' if reachable else 'failed')
