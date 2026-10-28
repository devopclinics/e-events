import pytest
from sqlalchemy import select
from app.config import settings
from app.models import Guest, TicketType
from conftest import _Session


@pytest.mark.asyncio
async def test_ticketing_token_is_event_scoped(ctx, monkeypatch):
    monkeypatch.setattr(settings, "ticketing_internal_token", "x" * 40)
    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.post(f"/api/auth/ticketing-token?event_id={ctx.ids['event_a']}")
    assert response.status_code == 200
    assert response.json()["token"]


@pytest.mark.asyncio
async def test_paid_order_fulfillment_is_authenticated_and_idempotent(ctx, monkeypatch):
    monkeypatch.setattr(settings, "ticketing_internal_token", "ticketing-test-secret")
    event_id = ctx.ids["event_a"]
    async with _Session() as db:
        access = TicketType(event_id=event_id, name="VIP")
        db.add(access); await db.commit(); await db.refresh(access)
        access_id = access.id
    body = {"order_id": "order-123", "event_id": event_id, "buyer_email": "buyer@example.com",
            "attendees": [{"first_name": "Ada", "last_name": "Guest", "email": "ada@example.com",
                           "access_ticket_type_id": access_id, "product_name": "VIP Admission"}]}
    denied = await ctx.client.post("/api/internal/ticketing/fulfill", json=body)
    assert denied.status_code == 401
    first = await ctx.client.post("/api/internal/ticketing/fulfill", json=body,
                                  headers={"X-Internal-Token": "ticketing-test-secret"})
    assert first.status_code == 200
    assert first.json()["already_fulfilled"] is False
    assert first.json()["passes"][0]["qr_token"]
    again = await ctx.client.post("/api/internal/ticketing/fulfill", json=body,
                                  headers={"X-Internal-Token": "ticketing-test-secret"})
    assert again.status_code == 200
    assert again.json()["already_fulfilled"] is True
    async with _Session() as db:
        rows = (await db.execute(select(Guest).where(Guest.paid_ticket_order_id == "order-123"))).scalars().all()
        assert len(rows) == 1
        assert rows[0].rsvp_status == "confirmed"
        assert rows[0].ticket_type_id == access_id
        assert rows[0].rsvp_notes is None
    voided = await ctx.client.post(f"/api/internal/ticketing/void/{event_id}/order-123",
                                   headers={"X-Internal-Token": "ticketing-test-secret"})
    assert voided.status_code == 200
    assert voided.json()["voided"] == 1
    async with _Session() as db:
        row = await db.scalar(select(Guest).where(Guest.paid_ticket_order_id == "order-123"))
        assert row.rsvp_status == "declined"

@pytest.mark.asyncio
async def test_paid_invitation_transfer_and_rsvp_guard(ctx, monkeypatch):
    monkeypatch.setattr(settings, "ticketing_internal_token", "ticketing-test-secret")
    headers={"X-Internal-Token":"ticketing-test-secret"}
    event_id=ctx.ids["event_a"]
    body={"order_id":"invitation-order", "event_id":event_id,"buyer_email":"buyer@example.com",
          "delivery_settings":{"invitation_opening_enabled":True,"email_enabled":False},
          "attendees":[{"first_name":"Amina","last_name":"Idris","product_name":"Admission"}]}
    result=await ctx.client.post("/api/internal/ticketing/fulfill",json=body,headers=headers)
    assert result.status_code==200,result.text
    item=result.json()["passes"][0]
    assert '?ticket-opening=1#guest-hub' in item['invitation_url']
    token=item['invitation_url'].split('/r/')[1].split('?')[0]
    personal=await ctx.client.get('/api/invite/token/'+token)
    assert personal.status_code==200 and personal.json()['already_responded'] is True
    assert personal.json()['guest']['first_name']=='Amina'
    again=await ctx.client.post("/api/internal/ticketing/fulfill",json=body,headers=headers)
    assert again.json()['passes']==result.json()['passes']
    denied=await ctx.client.post('/api/invite/token/'+token+'/rsvp',json={'status':'declined'})
    assert denied.status_code==409
    transfer=await ctx.client.post('/api/internal/ticketing/transfer/'+event_id,json={
        'order_id':'invitation-order','guest_id':item['guest_id'],'recipient_name':'Zara Noor',
        'recipient_email':'zara@example.com'},headers=headers)
    assert transfer.status_code==200,transfer.text
    assert transfer.json()['qr_token']!=item['qr_token']
    assert transfer.json()['invitation_url']!=item['invitation_url']
    assert (await ctx.client.get('/api/invite/token/'+token)).status_code==404
    await ctx.client.post(f'/api/internal/ticketing/void/{event_id}/invitation-order',headers=headers)
    new_token=transfer.json()['invitation_url'].split('/r/')[1].split('?')[0]
    denied=await ctx.client.post('/api/invite/token/'+new_token+'/rsvp',json={'status':'confirmed'})
    assert denied.status_code==409
    # Older fulfilled orders used the notes marker before the stable linkage.
    async with _Session() as db:
        guest=await db.get(Guest,item['guest_id'])
        guest.paid_ticket_order_id=None;guest.rsvp_notes='Paid ticket order: invitation-order'
        await db.commit()
    denied=await ctx.client.post('/api/invite/token/'+new_token+'/rsvp',json={'status':'confirmed'})
    assert denied.status_code==409


def test_ticket_delivery_opt_in_preserves_qr_and_legacy_links(monkeypatch):
    from types import SimpleNamespace
    from fastapi import BackgroundTasks
    from app.routers.ticketing_internal import _queue_ticket_delivery
    event=SimpleNamespace(id='test-event',name='Gathering',checkin_base_url='https://example.com',event_date=None,timezone='UTC')
    guest=SimpleNamespace(id='test-guest',first_name='Amina',last_name='Idris',email='buyer@example.com',phone=None,qr_token='qr-token',invite_token='invite-token')
    for enabled in [False,True]:
        tasks=BackgroundTasks()
        _queue_ticket_delivery(tasks,event,'test-order','buyer@example.com',[guest],{'invitation_opening_enabled':enabled})
        content=tasks.tasks[0].args[2]
        assert 'cid:ticketqr0' in content
        assert ('/r/invite-token?ticket-opening=1#guest-hub' in content)==enabled
        assert ('Open your invitation' if enabled else 'Open mobile pass') in content

@pytest.mark.asyncio
async def test_closed_paid_event_rejects_unpaid_shared_rsvp(ctx):
    from app.models import Event
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.status='active';event.rsvp_enabled=True
        event.invite_mode='closed';event.rsvp_token='paid-shared-test'
        await db.commit()
    payload={'first_name':'Unpaid','last_name':'Guest','email':'unpaid@example.com'}
    for url in [f"/api/invite/{ctx.ids['event_a']}/rsvp",'/api/invite/link/paid-shared-test/rsvp']:
        response=await ctx.client.post(url,json=payload)
        assert response.status_code==403
