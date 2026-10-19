"""Free checkout classification uses real persisted orders, never a provider."""
import asyncio
from unittest.mock import AsyncMock
import pytest
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app import main
from app.database import Base
from app.models import EventConfig,TicketProduct,Order
from app.schemas import OrderIn


@pytest.mark.parametrize("environment,provider,expected",[("staging","stripe",True),("staging","paystack",True),("production","fake",True),("production","stripe",False),("production","paystack",False)])
def test_free_order_provenance_round_trip(tmp_path,monkeypatch,environment,provider,expected):
    monkeypatch.setattr(main.settings,"environment",environment)
    fulfill=AsyncMock(return_value=True);monkeypatch.setattr(main,"fulfill",fulfill)
    async def execute():
        engine=create_async_engine("sqlite+aiosqlite:///"+str(tmp_path/"orders.db"))
        async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
        factory=async_sessionmaker(engine,expire_on_commit=False)
        async with factory() as db:
            db.add(EventConfig(event_id="event",org_id="org",enabled=True,provider=provider,currency="USD"))
            db.add(TicketProduct(id="product",event_id="event",name="Free",price=0,currency="USD",capacity=10));await db.commit()
            result=await main.create_order("event",OrderIn(buyer_name="Synthetic",buyer_email="synthetic@example.com",lines=[{"product_id":"product","quantity":1,"attendees":[{"first_name":"Synthetic","last_name":"Guest"}]}]),db)
        async with factory() as reader:assert (await reader.get(Order,result["order_id"])).is_test is expected
        await engine.dispose()
    asyncio.run(execute());fulfill.assert_awaited_once()
