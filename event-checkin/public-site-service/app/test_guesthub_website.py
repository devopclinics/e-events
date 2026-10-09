import unittest
from sqlalchemy import text
from .test_website_editor import WebsiteEditorTests
from .config import settings

class GuestHubWebsiteTests(unittest.IsolatedAsyncioTestCase):
 asyncSetUp = WebsiteEditorTests.asyncSetUp
 asyncTearDown = WebsiteEditorTests.asyncTearDown
 put = WebsiteEditorTests.put
 get = WebsiteEditorTests.get
 post = WebsiteEditorTests.post
 event = '00000000-0000-4000-8000-000000000001'
 async def test_only_published_current_address_is_public(self):
  path='/site/event/'+self.event
  self.assertEqual((await self.c.get(path)).status_code,404)
  draft=await self.put(event=self.event)
  self.assertEqual((await self.c.get(path)).status_code,404)
  self.assertEqual((await self.post('publish',draft['revision'],self.event)).status_code,200)
  response=await self.c.get(path,headers={'X-Internal-Token':''})
  self.assertEqual(response.status_code,200)
  self.assertEqual(response.json(),{'url':'/site/demo-site'})
  self.assertEqual(response.headers['cache-control'],'no-store')
  current=await self.get(self.event)
  changed=await self.put({**self.body,'slug':'renamed-site','expected_revision':current['revision'],'confirm_slug_change':True},self.event)
  self.assertEqual((await self.c.get(path)).json(),{'url':'/site/renamed-site'})
  current=await self.get(self.event)
  self.assertEqual((await self.post('unpublish',current['revision'],self.event)).status_code,200)
  self.assertEqual((await self.c.get(path)).status_code,404)
 async def test_disabled_and_missing_release_are_hidden(self):
  draft=await self.put(event=self.event)
  await self.post('publish',draft['revision'],self.event)
  path='/site/event/'+self.event
  settings.enabled=False
  self.assertEqual((await self.c.get(path)).status_code,404)
  settings.enabled=True
  async with self.engine.begin() as conn:
   await conn.execute(text('UPDATE public_sites SET enabled=0'))
  self.assertEqual((await self.c.get(path)).status_code,404)
  async with self.engine.begin() as conn:
   await conn.execute(text("UPDATE public_sites SET enabled=1,published_release_id='missing'"))
  self.assertEqual((await self.c.get(path)).status_code,404)
 async def test_invalid_event_id_is_rejected(self):
  self.assertEqual((await self.c.get('/site/event/invalid')).status_code,422)
