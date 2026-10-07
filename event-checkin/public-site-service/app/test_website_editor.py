"""Isolated HTTP regressions; no production data or outbound providers."""
import unittest
from datetime import datetime, timezone
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool
from .main import app, get_db
from .database import Base
from .config import settings
from .community import countdown_markup

class WebsiteEditorTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.engine=create_async_engine('sqlite+aiosqlite://',poolclass=StaticPool)
  async with self.engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
  sessions=async_sessionmaker(self.engine,expire_on_commit=False)
  async def db():
   async with sessions() as session: yield session
  app.dependency_overrides[get_db]=db
  self.old=(settings.internal_service_token,settings.enabled);settings.internal_service_token='isolated';settings.enabled=True
  self.c=AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'X-Internal-Token':'isolated'})
  self.body={'org_id':'test','slug':'demo-site','expected_revision':'new','template_family':'modern-professional','content':{'event_name':'Test event','headline':'Original','sessions':[],'timezone':'America/Indiana/Indianapolis'}}
 async def asyncTearDown(self):
  await self.c.aclose();app.dependency_overrides.clear();settings.internal_service_token,settings.enabled=self.old;await self.engine.dispose()
 async def put(self,body=None,event='a'):
  r=await self.c.put('/internal/sites/'+event,json=body or self.body);self.assertEqual(r.status_code,200,r.text);return r.json()
 async def get(self,event='a'): return (await self.c.get('/internal/sites/'+event)).json()
 async def post(self,action,rev,event='a'): return await self.c.post('/internal/sites/'+event+'/'+action,json={'expected_revision':rev})
 async def test_stale_save_and_missing_revision(self):
  a=await self.put();body={**self.body,'expected_revision':a['revision'],'content':{**self.body['content'],'headline':'Newer'}}
  b=await self.put(body);self.assertNotEqual(a['revision'],b['revision'])
  self.assertEqual((await self.c.put('/internal/sites/a',json=body)).status_code,409)
  body.pop('expected_revision');self.assertEqual((await self.c.put('/internal/sites/a',json=body)).status_code,428)
  self.assertEqual((await self.get())['content']['headline'],'Newer')
 async def test_publish_preview_unpublish_revision(self):
  a=await self.put()
  for action in ['publish','preview','unpublish']:self.assertEqual((await self.post(action,'old')).status_code,409)
  self.assertEqual((await self.post('publish',a['revision'])).status_code,200)
  self.assertEqual((await self.post('publish',a['revision'])).status_code,409)
  latest=await self.get();self.assertEqual((await self.post('preview',latest['revision'])).status_code,200)
  self.assertEqual((await self.post('unpublish',latest['revision'])).status_code,200)
  self.assertEqual((await self.c.get('/site/demo-site')).status_code,404)
 async def test_restore_draft_preserves_live_then_explicit_revert(self):
  a=await self.put();r1=(await self.post('publish',a['revision'])).json();a=await self.get()
  a=await self.put({**self.body,'expected_revision':a['revision'],'content':{**self.body['content'],'headline':'Second'}})
  r2=(await self.post('publish',a['revision'])).json();a=await self.get()
  r=await self.post('restore/'+r1['release_id'],a['revision']);self.assertEqual(r.status_code,200,r.text);a=r.json()
  self.assertEqual(a['content']['headline'],'Original');self.assertEqual(a['published_release_id'],r2['release_id']);self.assertIn('Second',(await self.c.get('/site/demo-site')).text)
  self.assertEqual((await self.post('rollback/'+r1['release_id'],'old')).status_code,409)
  self.assertEqual((await self.post('rollback/'+r1['release_id'],a['revision'])).status_code,200)
  self.assertIn('Original',(await self.c.get('/site/demo-site')).text)
 async def test_slug_redirect_reservation_and_confirmation(self):
  a=await self.put();await self.post('publish',a['revision']);a=await self.get();body={**self.body,'slug':'new-address','expected_revision':a['revision']}
  self.assertEqual((await self.c.put('/internal/sites/a',json=body)).status_code,409)
  await self.put({**body,'confirm_slug_change':True});r=await self.c.get('/site/demo-site');self.assertEqual(r.status_code,308);self.assertEqual(r.headers['location'],'/site/new-address')
  self.assertEqual((await self.c.put('/internal/sites/b',json=self.body)).status_code,409)
 async def test_render_full_programme_without_mutations(self):
  body={**self.body,'content':{**self.body['content'],'sessions':[{'title':f'Session {i}','day':str(i//80)} for i in range(350)],'faqs':[{'question':'Where?','answer':'North entrance'}],'guesthub_url':'https://example.com/rsvp/demo?recover=1'}}
  r=await self.c.post('/internal/sites/a/render-preview',json=body);self.assertEqual(r.status_code,200,r.text)
  for text in ['Session 349','North entrance','Recover my GuestHub']:self.assertIn(text,r.json()['html'])
  self.assertEqual((await self.c.get('/internal/sites/a')).status_code,404)
 async def test_restore_cross_site_forbidden(self):
  a=await self.put();release=(await self.post('publish',a['revision'])).json();b=await self.put({**self.body,'slug':'other-site'},'b')
  self.assertEqual((await self.post('restore/'+release['release_id'],b['revision'],'b')).status_code,404)

class DateTests(unittest.TestCase):
 def test_midnight_in_event_timezone(self):
  c={'start_date':'2026-12-24T09:00:00-05:00','timezone':'America/Indiana/Indianapolis'}
  self.assertIn('Tomorrow',countdown_markup(c,datetime(2026,12,24,1,tzinfo=timezone.utc)))
  self.assertEqual(countdown_markup(c,datetime(2026,12,24,18,tzinfo=timezone.utc)),'')
 def test_legacy_dates_and_dst(self):
  for date in ['12/24/2026','2026-12-24','December 24, 2026']:
   self.assertIn('Tomorrow',countdown_markup({'start_date':date,'timezone':'America/Chicago'},datetime(2026,12,23,18,tzinfo=timezone.utc)))
  self.assertIn('Tomorrow',countdown_markup({'start_date':'2026-11-01T09:00:00-05:00','timezone':'America/Chicago'},datetime(2026,11,1,3,tzinfo=timezone.utc)))
