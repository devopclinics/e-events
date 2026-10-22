"""Optional native locking check, restricted to a disposable localhost database."""
import asyncio,os,uuid
from datetime import datetime,timedelta
import pytest
from fastapi import Response
from sqlalchemy import select,func
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.database import Base
from app.models import Organization,Event,Guest,SharedGuestSheet,GuestSheetSession,GuestSheetBatch
from app.routers.guest_sheets import save_rows,Batch,Row,pin_hash,digest

URL=os.environ.get('GUEST_SHEET_TEST_POSTGRES_URL','')
pytestmark=pytest.mark.skipif(not URL,reason='Disposable PostgreSQL fixture not configured')

@pytest.mark.asyncio
async def test_shared_batch_native_locking_and_replay():
    parsed=make_url(URL)
    assert parsed.host in ('localhost','127.0.0.1') and parsed.database.startswith('guest_sheet_fixture')
    engine=create_async_engine(URL);sessions=async_sessionmaker(engine,expire_on_commit=False)
    try:
        async with engine.begin() as conn:await conn.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            org=Organization(name='Fixture',slug=str(uuid.uuid4()));db.add(org);await db.flush()
            event=Event(org_id=org.id,name='Fixture',couples_name='Fixture',event_date=datetime.utcnow(),checkin_base_url='http://localhost',status='active');db.add(event);await db.flush()
            db.add(SharedGuestSheet(event_id=event.id,token='native-fixture',pin_hash=pin_hash('123456')));await db.flush()
            db.add(GuestSheetSession(token_hash=digest('session'),event_id=event.id,version=1,expires_at=datetime.utcnow()+timedelta(hours=1)));await db.commit();eid=event.id
        body=Batch(request_key=str(uuid.uuid4()),rows=[Row(first_name='Fixture',last_name='Guest')])
        async def write():
            async with sessions() as db:return await save_rows('native-fixture',body,Response(),'session',db)
        results=await asyncio.wait_for(asyncio.gather(write(),write()),timeout=20)
        assert sum(bool(r.get('already_saved')) for r in results)==1
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id==eid))==1
            assert await db.scalar(select(func.count()).select_from(GuestSheetBatch).where(GuestSheetBatch.event_id==eid))==1
    finally:await engine.dispose()
