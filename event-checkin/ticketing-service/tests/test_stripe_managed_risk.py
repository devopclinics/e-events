import asyncio
import copy
import json
from datetime import datetime,timedelta
from urllib.parse import parse_qs
from unittest.mock import AsyncMock
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select,func
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker

from app import main
from app.auth import Identity
from app.database import Base
from app.models import EventConfig,PayoutAccount,TicketProduct,Order,PaymentEvent,LedgerEntry
from app.providers import StripeProvider
from app.schemas import StripeAccountIn,OrderIn,RefundIn
from app.stripe_connect import refresh_managed_account

ACCOUNT='acct_organizer'
ACTIVE={'id':ACCOUNT,'defaults':{'responsibilities':{'losses_collector':'stripe','fees_collector':'stripe'}},'configuration':{'merchant':{'capabilities':{'card_payments':{'status':'active'},'stripe_balance':{'payouts':{'status':'active'}}}}}}
IDENT=Identity('admin','event','org','admin')


def transport(monkeypatch,handler):
    real=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kw:real(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(main.settings,'stripe_secret_key','sk_test_synthetic')
    monkeypatch.setattr(main.settings,'stripe_connect_webhook_secret','synthetic_connect_secret')
    monkeypatch.setattr(main.settings,'environment','staging')


async def fixture_db(tmp_path):
    engine=create_async_engine('sqlite+aiosqlite:///'+str(tmp_path/'managed.db'))
    async with engine.begin() as conn:await conn.run_sync(Base.metadata.create_all)
    return engine,async_sessionmaker(engine,expire_on_commit=False)


def test_create_resume_refresh_and_failed_link_preserves_account(tmp_path,monkeypatch):
    calls=[];fail_link=True
    def handler(req):
        calls.append(req)
        assert req.headers['Stripe-Version']=='2026-09-30.endive'
        if req.url.path=='/v2/core/accounts':
            body=json.loads(req.content);assert 'type' not in body and body['dashboard']=='full'
            assert body['defaults']['responsibilities']=={'fees_collector':'stripe','losses_collector':'stripe'}
            assert body['configuration']['merchant']['capabilities']['card_payments']['requested']
            assert req.headers['Idempotency-Key'].startswith('festio-managed-org-')
            return httpx.Response(200,json=ACTIVE)
        if req.url.path=='/v2/core/account_links':
            body=json.loads(req.content);assert body['use_case']['account_onboarding']['configurations']==['merchant']
            return httpx.Response(400,json={'error':{'message':'Complete your profile'}}) if fail_link else httpx.Response(200,json={'url':'https://connect.stripe.test/onboard'})
        if req.url.path=='/v2/core/accounts/'+ACCOUNT:return httpx.Response(200,json=ACTIVE)
        raise AssertionError(req.url)
    transport(monkeypatch,handler)
    async def run():
        nonlocal fail_link
        engine,factory=await fixture_db(tmp_path)
        async with factory() as db:
            body=StripeAccountIn(business_name='Academy',email='owner@example.com',country='US')
            with pytest.raises(HTTPException):await main.create_stripe_account('event',body,IDENT,db)
            row=await db.scalar(select(PayoutAccount));assert row.details['charge_type']=='direct' and row.status=='onboarding'
            fail_link=False
            resumed=await main.resume_stripe_onboarding('event',row.id,IDENT,db);assert resumed['onboarding_url'].startswith('https://connect.')
            result=await main.create_stripe_account('event',body,IDENT,db);assert result['risk_management']=='stripe'
            assert await db.scalar(select(func.count(PayoutAccount.id)))==1
            await refresh_managed_account(row);assert row.charges_enabled and row.payouts_enabled and row.status=='verified'
        await engine.dispose()
    asyncio.run(run())


@pytest.mark.parametrize('direct',[False,True])
def test_provider_charge_and_refund_scope(monkeypatch,direct):
    calls=[]
    def handler(req):
        calls.append(req);body=parse_qs(req.content.decode())
        if req.url.path.endswith('/sessions'):
            assert bool(req.headers.get('Stripe-Account')) is direct
            assert ('payment_intent_data[transfer_data][destination]' in body) is not direct
            assert body['payment_intent_data[application_fee_amount]']==['250']
            assert req.headers['Idempotency-Key']=='festio-checkout-order'
            return httpx.Response(200,json={'id':'cs_scope','url':'https://checkout.stripe.test'})
        assert req.url.path=='/v1/refunds'
        assert bool(req.headers.get('Stripe-Account')) is direct
        assert ('reverse_transfer' in body) is not direct
        assert body['refund_application_fee']==['true']
        assert req.headers['Idempotency-Key']=='refund-synthetic'
        return httpx.Response(200,json={'id':'re_scope','status':'succeeded'})
    transport(monkeypatch,handler)
    async def run():
        p=StripeProvider();await p.create_checkout(order_id='order',access_token='synthetic',email='buyer@example.com',amount=5250,currency='USD',account_id=ACCOUNT,fee=250,direct=direct)
        await p.refund(reference='pi_scope',amount=1000,idempotency_key='refund-synthetic',account_id=ACCOUNT if direct else None)
    asyncio.run(run());assert len(calls)==2


def test_direct_checkout_and_webhook_account_environment_paid_guards(tmp_path,monkeypatch):
    calls=[]
    def handler(req):
        calls.append(req)
        if req.url.path=='/v2/core/accounts/'+ACCOUNT:return httpx.Response(200,json=ACTIVE)
        assert req.url.path=='/v1/checkout/sessions' and req.headers['Stripe-Account']==ACCOUNT
        return httpx.Response(200,json={'id':'cs_direct','url':'https://checkout.stripe.test'})
    transport(monkeypatch,handler);fulfill=AsyncMock(return_value=True);monkeypatch.setattr(main,'fulfill',fulfill)
    async def run():
        engine,factory=await fixture_db(tmp_path)
        async with factory() as db:
            db.add(EventConfig(event_id='event',org_id='org',enabled=True,currency='USD',provider='stripe',provider_account_id=ACCOUNT,fee_bps=500,fees_paid_by='buyer'))
            db.add(PayoutAccount(id='payout',org_id='org',provider='stripe',provider_account_id=ACCOUNT,business_name='Academy',currency='USD',status='verified',charges_enabled=True,payouts_enabled=True,details={'charge_type':'direct'}))
            db.add(TicketProduct(id='general',event_id='event',name='General',price=5000,currency='USD',capacity=200));await db.commit()
            result=await main.create_order('event',OrderIn(buyer_name='Buyer',buyer_email='buyer@example.com',lines=[{'product_id':'general','quantity':1,'attendees':[{'first_name':'Guest','last_name':'One'}]}]),db)
            order=await db.get(Order,result['order_id']);assert order.stripe_account_id==ACCOUNT
            event={'id':'evt_wrong','type':'checkout.session.completed','account':'acct_wrong','livemode':False,'data':{'object':{'id':'cs_direct','payment_intent':'pi_direct','amount_total':order.total,'currency':'usd','payment_status':'paid'}}}
            await main.process_stripe_event(event,db);await db.refresh(order);assert order.status=='pending';fulfill.assert_not_awaited()
            event['account']=ACCOUNT;event['id']='evt_unpaid';event['data']['object']['payment_status']='unpaid'
            await main.process_stripe_event(event,db);await db.refresh(order);assert order.status=='pending'
            event['id']='evt_wrong_mode';event['livemode']=True;event['data']['object']['payment_status']='paid';await main.process_stripe_event(event,db);await db.refresh(order);assert order.status=='pending'
            event['id']='evt_paid';event['livemode']=False;await main.process_stripe_event(event,db);await db.refresh(order);assert order.status=='paid';fulfill.assert_awaited_once()
            await main.process_stripe_event(event,db);assert await db.scalar(select(func.count(LedgerEntry.id)).where(LedgerEntry.kind=='payment'))==1
            # A later payout change must not change this order's refund routing.
            await db.refresh(order)
            cfg=await db.get(EventConfig,'event');cfg.provider_account_id='acct_changed';await db.commit();assert order.stripe_account_id==ACCOUNT
            refund=AsyncMock(return_value={'id':'re_direct','status':'pending'})
            monkeypatch.setattr(main,'provider',lambda name:SimpleNamespace(refund=refund))
            await main.refund_order(db,order,RefundIn(amount=1000,reason='requested_by_customer'))
            assert refund.await_args.kwargs['account_id']==ACCOUNT
            assert refund.await_args.kwargs['reference']=='pi_direct'
            await main.update_refund_from_webhook(db,'stripe','re_direct','pi_direct',True,stripe_account_id='acct_wrong')
            assert await db.scalar(select(func.count(LedgerEntry.id)).where(LedgerEntry.kind=='refund'))==0
        await engine.dispose()
    asyncio.run(run())


@pytest.mark.parametrize('reason',['wrong_risk','disabled_capability','provider_error'])
def test_refresh_fails_closed(monkeypatch,reason):
    data=copy.deepcopy(ACTIVE)
    if reason=='wrong_risk':data['defaults']['responsibilities']['losses_collector']='application'
    if reason=='disabled_capability':data['configuration']['merchant']['capabilities']['card_payments']['status']='pending'
    transport(monkeypatch,lambda req:httpx.Response(503) if reason=='provider_error' else httpx.Response(200,json=data))
    row=PayoutAccount(provider='stripe',provider_account_id=ACCOUNT,charges_enabled=True,payouts_enabled=True,status='verified',details={'charge_type':'direct'})
    asyncio.run(refresh_managed_account(row));assert not row.charges_enabled and row.status!='verified'


def test_connect_signature_is_separate_from_platform_signature(monkeypatch):
    import hashlib,hmac,time
    from starlette.requests import Request
    monkeypatch.setattr(main.settings,'stripe_connect_webhook_secret','connect_synthetic')
    monkeypatch.setattr(main.settings,'stripe_webhook_secret','platform_synthetic')
    monkeypatch.setattr(main.settings,'environment','staging')
    async def invoke(key,account):
        body=json.dumps({'id':'evt_signature','type':'ping','account':account,'livemode':False}).encode();stamp=str(int(time.time()))
        digest=hmac.new(key.encode(),stamp.encode()+b'.'+body,hashlib.sha256).hexdigest()
        async def receive():return {'type':'http.request','body':body,'more_body':False}
        request=Request({'type':'http','method':'POST','path':'/','headers':[(b'stripe-signature',f't={stamp},v1={digest}'.encode())]},receive)
        return await main.stripe_connect_webhook(request,AsyncMock())
    async def run():
        with pytest.raises(HTTPException) as error:await invoke('platform_synthetic',ACCOUNT)
        assert error.value.status_code==400
        with pytest.raises(HTTPException) as error:await invoke('connect_synthetic',None)
        assert error.value.status_code==400
        assert await invoke('connect_synthetic',ACCOUNT)=={'received':True}
    asyncio.run(run())


def test_external_refunds_scope_idempotency_and_inventory(tmp_path,monkeypatch):
    from app.models import OrderItem,PaymentRefund
    calls=[]
    def handler(req):
        assert '/internal/ticketing/void/' in req.url.path
        calls.append(req);return httpx.Response(200,json={'ok':True})
    transport(monkeypatch,handler)
    async def run():
        engine,factory=await fixture_db(tmp_path)
        async with factory() as db:
            order=Order(id='order',event_id='event',org_id='org',buyer_name='Buyer',buyer_email='buyer@example.com',currency='USD',subtotal=5000,total=5000,provider='stripe',stripe_account_id=ACCOUNT,payment_reference='pi_external',status='fulfilled',hold_expires_at=datetime.utcnow()+timedelta(minutes=10))
            db.add(order);db.add(TicketProduct(id='product',event_id='event',name='Ticket',price=5000,currency='USD',capacity=10,sold=1));db.add(OrderItem(id='item',order_id='order',product_id='product',product_name='Ticket',quantity=1,unit_price=5000,attendee_data=[]));await db.commit()
            obj={'id':'re_external','payment_intent':'pi_external','currency':'usd','amount':5000,'status':'succeeded'}
            await main.direct_refund_event(db,'acct_wrong',obj);assert await db.scalar(select(func.count(PaymentRefund.id)))==0
            await main.direct_refund_event(db,ACCOUNT,obj);await db.refresh(order);assert order.status=='refunded'
            assert (await db.get(TicketProduct,'product')).sold==0
            await main.direct_refund_event(db,ACCOUNT,obj);assert await db.scalar(select(func.count(LedgerEntry.id)).where(LedgerEntry.kind=='refund'))==1
            assert len(calls)==1
        await engine.dispose()
    asyncio.run(run())
