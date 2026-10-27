import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from sqlalchemy import select,func
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app import main
from app.database import Base
from app.models import EventConfig,TicketProduct,Order,OrderItem
from app.schemas import OrderIn

@pytest.mark.parametrize('case',['missing_name','named_pair','quantity_limit','disabled_sales','preview_only'])
def test_named_multiple_ticket_checkout(tmp_path,monkeypatch,case):
    monkeypatch.setattr(main.settings,'environment','staging')
    checkout=AsyncMock(return_value=('synthetic-reference','https://example.com/checkout'))
    monkeypatch.setattr(main,'provider',lambda name:SimpleNamespace(create_checkout=checkout))
    async def run():
        engine=create_async_engine('sqlite+aiosqlite:///'+str(tmp_path/'tickets.db'))
        async with engine.begin() as conn:await conn.run_sync(Base.metadata.create_all)
        factory=async_sessionmaker(engine,expire_on_commit=False)
        async with factory() as db:
            db.add(EventConfig(event_id='event',org_id='org',enabled=case not in ('disabled_sales','preview_only'),currency='USD',provider='stripe',fees_paid_by='buyer',delivery_settings={'require_attendee_names':True,'hide_availability':True,'public_checkout_preview':case in ('preview_only','named_pair')}))
            db.add(TicketProduct(id='general',event_id='event',name='General Admission',price=5000,currency='USD',capacity=200,min_per_order=1,max_per_order=10));await db.commit()
            qty=11 if case=='quantity_limit' else 2
            attendees=[{'first_name':'Guest '+str(i),'last_name':''} for i in range(qty)]
            if case=='missing_name':attendees[1]['first_name']='   '
            body=OrderIn(buyer_name='Buyer Name',buyer_email='buyer@example.com',lines=[{'product_id':'general','quantity':qty,'attendees':attendees}])
            if case=='preview_only':
                expiry=AsyncMock();monkeypatch.setattr(main,'expire_abandoned_orders',expiry)
                catalog=await main.public_tickets('event',db);expiry.assert_not_awaited();assert catalog['preview_mode'] is True and catalog['enabled'] is True
            if case=='named_pair':
                catalog=await main.public_tickets('event',db);assert catalog['preview_mode'] is False and catalog['require_attendee_names'] and not catalog['show_availability'] and catalog['fee']['paid_by']=='buyer'
                result=await main.create_order('event',body,db)
                order=await db.get(Order,result['order_id']);assert order.subtotal==10000
                item=await db.scalar(select(OrderItem).where(OrderItem.order_id==order.id));assert len(item.attendee_data)==2 and item.attendee_data[0]['first_name']=='Guest 0' and item.attendee_data[1]['first_name']=='Guest 1'
                assert order.status=='pending';checkout.assert_awaited_once()
                fee=10000*catalog['fee']['bps']//10000;assert order.platform_fee==fee and order.total==10000+fee
                assert checkout.await_args.kwargs['amount']==order.total
            else:
                with pytest.raises(HTTPException) as error:await main.create_order('event',body,db)
                assert error.value.status_code=={'missing_name':400,'quantity_limit':409,'disabled_sales':404,'preview_only':404}[case]
                assert await db.scalar(select(func.count(Order.id)))==0;checkout.assert_not_awaited()
        await engine.dispose()
    asyncio.run(run())
