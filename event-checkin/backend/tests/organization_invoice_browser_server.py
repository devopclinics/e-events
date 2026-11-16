"""Isolated SQLite + real invoice routes for browser creation/issue regression checks."""
import os
os.environ['DATABASE_URL']='postgresql+asyncpg://localhost/offline_invoice_browser'
os.environ['DASHBOARD_RO_DB_PASSWORD']='offline-test-placeholder'
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.database import Base,get_db
from app.auth import get_current_user
from app.models import Organization,User,Membership
from app.routers.organization_invoices import router
from app.services.import_invoice_archive import import_archive

engine=create_async_engine('sqlite+aiosqlite:////tmp/festio-organization-invoice-browser.sqlite')
Session=async_sessionmaker(engine,expire_on_commit=False)
app=FastAPI();app.include_router(router,prefix='/api/organization-invoices')
actor=None
async def db():
    async with Session() as s:yield s
async def user():return actor
app.dependency_overrides[get_db]=db;app.dependency_overrides[get_current_user]=user
@app.on_event('startup')
async def setup():
    global actor
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all);await c.run_sync(Base.metadata.create_all)
    async with Session() as s:
        a=Organization(id='invoice-browser-a',name='Invoice Test Organization A',slug='invoice-browser-a',currency='NGN');b=Organization(id='invoice-browser-b',name='Invoice Test Organization B',slug='invoice-browser-b',currency='USD');actor=User(id='invoice-browser-user',name='Invoice tester',email='invoice@example.test',role='admin');s.add_all([a,b,actor]);await s.flush();s.add_all([Membership(org_id=a.id,user_id=actor.id,role='owner'),Membership(org_id=b.id,user_id=actor.id,role='admin')]);await s.commit();await import_archive(s,a,actor)
