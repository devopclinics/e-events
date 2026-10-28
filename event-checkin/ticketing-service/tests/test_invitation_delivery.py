import asyncio
from datetime import datetime,timedelta
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app import main
from app.database import Base
from app.models import Order

def test_order_exposes_invitation_beside_direct_qr_and_card(tmp_path):
    async def run():
        engine=create_async_engine('sqlite+aiosqlite:///'+str(tmp_path/'orders.db'))
        async with engine.begin() as conn:await conn.run_sync(Base.metadata.create_all)
        factory=async_sessionmaker(engine,expire_on_commit=False)
        async with factory() as db:
            db.add(Order(id='order',event_id='event',org_id='org',status='fulfilled',currency='USD',subtotal=5000,total=5000,provider='stripe',buyer_name='Buyer',buyer_email='buyer@example.com',access_token='secret',hold_expires_at=datetime.utcnow()+timedelta(hours=1),fulfillment_result={'passes':[{'guest_id':'guest','name':'Amina','qr_token':'qr-test','invitation_url':'https://example.com/r/private?ticket-opening=1#guest-hub'},{'guest_id':'legacy','name':'Legacy','qr_token':'legacy-test'}]}))
            await db.commit()
            result=await main.public_order('order','secret',db)
            assert result['passes'][0]['invitation_url'].endswith('?ticket-opening=1#guest-hub')
            assert '/scan/qr-test' in result['passes'][0]['pass_url']
            assert result['passes'][0]['card_url'].endswith('/card.jpg')
            assert result['passes'][1]['invitation_url'] is None
            assert 'access_token' not in result
        await engine.dispose()
    asyncio.run(run())
