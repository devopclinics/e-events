"""Opt-in real PostgreSQL checks. Only a disposable localhost fixture is accepted.

GUEST_SERVICE_TEST_POSTGRES_URL must name a guest_service_fixture* database.
No production credentials, application lifespan or providers are used.
"""
import asyncio
import os
from datetime import datetime
import pytest
from fastapi import HTTPException
from sqlalchemy import select, func, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.database import Base
from app.models import Organization, User, Event, Guest, MenuCategory, MealService, GuestMealService
from app.routers.menu import fulfill_category
from app.db_migrate import auto_patch

URL = os.environ.get('GUEST_SERVICE_TEST_POSTGRES_URL','')
pytestmark = pytest.mark.skipif(not URL, reason='Disposable localhost PostgreSQL fixture not configured')


@pytest.mark.asyncio
async def test_native_locking_idempotency_capacity_and_additive_migration():
    parsed=make_url(URL)
    assert parsed.host in ('localhost','127.0.0.1') and parsed.database.startswith('guest_service_fixture')
    engine=create_async_engine(URL)
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            # Simulate an existing installation: new boolean must add safely as false.
            await conn.execute(text('ALTER TABLE event_users DROP COLUMN IF EXISTS guest_service_scoped'))
        patches=await auto_patch(engine)
        scope_patches=[p for p in patches if 'event_users ADD COLUMN' in p and 'guest_service_scoped' in p]
        assert len(scope_patches)==1 and 'FALSE' in scope_patches[0].upper()
        async with engine.begin() as conn:
            await conn.execute(text(scope_patches[0]))
        assert not [p for p in await auto_patch(engine) if 'guest_service_scoped' in p]
        async with sessions() as db:
            org=Organization(name='Fixture',slug='guest-service-native');actor=User(name='Fixture host',email='fixture@invalid.test',role='official')
            db.add_all([org,actor]);await db.flush()
            event=Event(org_id=org.id,name='Fixture',couples_name='Fixture',event_date=datetime.utcnow(),checkin_base_url='http://localhost',status='active',is_paid=True,menu_enabled=True)
            db.add(event);await db.flush()
            category=MenuCategory(event_id=event.id,name='Dinner');db.add(category);await db.flush()
            service=MealService(event_id=event.id,category_id=category.id,name='Dinner',status='open',capacity=1)
            guests=[Guest(event_id=event.id,first_name=f'Guest {i}',last_name='Fixture',admitted=True,rsvp_status='confirmed') for i in range(3)]
            db.add_all([service,*guests]);await db.commit()
            ids=[g.id for g in guests];actor_id=actor.id;event_id=event.id;category_id=category.id;service_id=service.id
        async def serve(guest_id):
            async with sessions() as db:
                actor=await db.get(User,actor_id);service=await db.get(MealService,service_id)
                try:
                    return await fulfill_category(event_id,category_id,guest_id,None,db,actor,service=service,enforce_service_limits=True)
                except HTTPException as exc:
                    await db.rollback();return {'denied':exc.status_code}
        results=await asyncio.wait_for(asyncio.gather(serve(ids[0]),serve(ids[0])),timeout=15)
        assert sum(bool(x.get('already_served')) for x in results)==1
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(GuestMealService))==1
            await db.execute(GuestMealService.__table__.delete())
            # Canonical legacy compatibility flag is unrelated to occurrence capacity.
            for gid in ids:
                guest=await db.get(Guest,gid);guest.meal_served=False
            await db.commit()
        results=await asyncio.wait_for(asyncio.gather(serve(ids[1]),serve(ids[2])),timeout=15)
        assert sum(x.get('denied')==409 for x in results)==1
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(GuestMealService).where(GuestMealService.fulfillment_status=='served'))==1
    finally:
        await engine.dispose()
