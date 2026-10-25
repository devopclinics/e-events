import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base
from app.safety import csv_safe, order_view, peer_address, take_bucket
from app.main import refund_order
from app.schemas import RefundIn

@pytest.mark.parametrize('value', ['=HYPERLINK("bad")', '+123', '-1+2', '@SUM(A1)', '  =1'])
def test_csv_formula_cells_are_literal(value):
    assert csv_safe(value) == "'" + value

def test_order_projection_excludes_buyer_and_pass_credentials():
    row=SimpleNamespace(id='one',provider='paystack',total=0,access_token='secret',
        checkout_url='https://private',fulfillment_result={'qr_token':'secret'})
    result=order_view(row)
    assert result['payment_kind']=='free'
    assert result['provider_label']=='Free'
    assert not {'access_token','checkout_url','fulfillment_result','qr_token'} & result.keys()

def test_untrusted_peer_cannot_spoof_forwarded_address():
    request=Request({'type':'http','client':('203.0.113.10',1234),
        'headers':[(b'x-forwarded-for',b'1.2.3.4')]})
    assert peer_address(request)=='203.0.113.10'

def test_trusted_proxy_uses_nearest_untrusted_hop():
    request=Request({'type':'http','client':('192.168.3.10',1234),
        'headers':[(b'x-forwarded-for',b'1.2.3.4, 203.0.113.10')]})
    assert peer_address(request)=='203.0.113.10'

def test_database_rate_limit_survives_new_session():
    async def run():
        engine=create_async_engine('sqlite+aiosqlite://')
        async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
        sessions=async_sessionmaker(engine)
        async with sessions() as db:await take_bucket(db,'test','same',1,3600)
        async with sessions() as db:
            with pytest.raises(HTTPException) as exc:await take_bucket(db,'test','same',1,3600)
            assert exc.value.status_code==429
        async with sessions() as db:await take_bucket(db,'test','different',1,3600)
        await engine.dispose()
    asyncio.run(run())

def test_zero_value_refund_does_not_touch_database_or_provider():
    db=SimpleNamespace(scalar=AsyncMock())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(refund_order(db,SimpleNamespace(total=0),RefundIn()))
    assert exc.value.status_code==409
    db.scalar.assert_not_called()

def test_paginated_sales_totals_and_credentials_with_real_models():
    from datetime import datetime,timedelta
    from app.models import Order
    from app.auth import Identity
    from app.main import sales
    async def run():
        engine=create_async_engine('sqlite+aiosqlite://')
        async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
        sessions=async_sessionmaker(engine,expire_on_commit=False)
        async with sessions() as db:
            for i in range(3):
                db.add(Order(id=str(i),event_id='event',org_id='org',buyer_name='Buyer',buyer_email='buyer@example.invalid',
                    currency='NGN',subtotal=100,total=100,status='paid',provider='paystack',access_token='secret'+str(i),
                    checkout_url='https://private',fulfillment_result={'qr_token':'private'},
                    hold_expires_at=datetime.utcnow()+timedelta(minutes=10)))
            await db.commit()
        async with sessions() as db:
            result=await sales('event',Identity('admin','event','org','admin'),db,limit=1,offset=1)
            assert len(result['orders'])==1
            assert result['pagination']['total']==3
            assert result['summary']['gross']==300
            assert 'secret' not in str(result)
            assert 'qr_token' not in str(result)
            assert 'checkout_url' not in str(result)
        await engine.dispose()
    asyncio.run(run())

def test_go_live_fails_closed_and_rotated_credentials_invalidate_confirmations(monkeypatch):
    from app.readiness import checklist,provider_fingerprint
    from app.config import settings
    from app.models import EventConfig,PayoutAccount,OperationsSubscription
    monkeypatch.setattr(settings,'environment','production')
    monkeypatch.setattr(settings,'paystack_secret_key','sk_live_synthetic')
    async def run():
        engine=create_async_engine('sqlite+aiosqlite://')
        async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
        sessions=async_sessionmaker(engine,expire_on_commit=False)
        async with sessions() as db:
            cfg=EventConfig(event_id='event',org_id='org',provider='paystack',currency='NGN',provider_account_id='acct')
            db.add(cfg);await db.commit()
            result=await checklist(db,cfg)
            assert result['paid_checkout_blocked']
            cfg.setup_checks={'currency_confirmed':True,'currency':'NGN','webhook_confirmed':True,
                'webhook_provider':'paystack','webhook_fingerprint':provider_fingerprint('paystack'),
                'payout_confirmed_account_id':'acct','payout_fingerprint':provider_fingerprint('paystack'),
                'alert_confirmed':True}
            db.add(PayoutAccount(org_id='org',provider='paystack',provider_account_id='acct',business_name='Fixture',currency='NGN',
                account_name='Fixture',status='created',charges_enabled=True,payouts_enabled=True))
            db.add(OperationsSubscription(event_id='event',recipient='ops@example.invalid',enabled=True,include_alerts=True,next_run_at=__import__('datetime').datetime.utcnow()))
            await db.commit()
            assert (await checklist(db,cfg))['ready']
            settings.paystack_secret_key='sk_live_rotated'
            result=await checklist(db,cfg)
            assert not result['ready']
            assert not next(item for item in result['checks'] if item['id']=='webhook')['ready']
        await engine.dispose()
    asyncio.run(run())
