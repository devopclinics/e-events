import copy
import unittest
from pydantic import ValidationError
from .schemas import SiteContent
from .render import render_site
from .templates import TEMPLATE_IDS
from . import test_website_editor as editor_tests

class FeaturedTests(unittest.TestCase):
 def sample(self):
  return {'headline':'Example event','event_name':'Example','guesthub_url':'https://example.com/rsvp/event?recover=1','sessions':[{'title':f'Unique session {i:03d}','featured':i in [3,45,96],'description':f'Full notes {i}'} for i in range(250)]}
 def test_only_selected_programmes_in_every_template_and_no_data_loss(self):
  c=SiteContent(**self.sample()).model_dump(mode='json');original=copy.deepcopy(c)
  for family in [*TEMPLATE_IDS,'community','conference','celebration']:
   page=render_site(c,family)
   for i in range(250):
    self.assertEqual(f'Unique session {i:03d}' in page,i in [3,45,96],(family,i))
   self.assertIn('href="https://example.com/rsvp/event?recover=1&destination=programme"',page)
   self.assertIn('View full programme in GuestHub',page)
   self.assertEqual(c,original)
 def test_old_imports_do_not_become_featured_automatically(self):
  c=self.sample()
  for s in c['sessions']:s.pop('featured')
  for family in TEMPLATE_IDS:
   page=render_site(c,family);self.assertNotIn('Unique session',page);self.assertIn('Featured programmes will be announced soon.',page);self.assertIn('View full programme in GuestHub',page)
 def test_maximum_six_validated_and_legacy_oversized_snapshots_capped(self):
  c=self.sample()
  for s in c['sessions']:s['featured']=True
  with self.assertRaises(ValidationError):SiteContent(**c)
  for family in TEMPLATE_IDS:
   page=render_site(c,family);self.assertIn('Unique session 005',page);self.assertNotIn('Unique session 006',page)
 def test_missing_guesthub_has_registration_fallback_not_dead_button(self):
  c=self.sample();c.pop('guesthub_url');c['primary_action']={'label':'RSVP','url':'https://example.com/register'}
  page=render_site(c,'atrium');self.assertIn('Register to access GuestHub',page);self.assertNotIn('View full programme in GuestHub',page)
  c['primary_action']=None;page=render_site(c,'community');self.assertNotIn('Register to access GuestHub',page);self.assertIn('personal GuestHub link after registration',page)
 def test_disabled_programme_has_no_handoff(self):
  c=self.sample();c['visible_sections']=['stats']
  for family in TEMPLATE_IDS:self.assertNotIn('View full programme in GuestHub',render_site(c,family))

class FeaturedPublicationTests(unittest.IsolatedAsyncioTestCase):
 asyncSetUp=editor_tests.WebsiteEditorTests.asyncSetUp
 asyncTearDown=editor_tests.WebsiteEditorTests.asyncTearDown
 put=editor_tests.WebsiteEditorTests.put
 get=editor_tests.WebsiteEditorTests.get
 post=editor_tests.WebsiteEditorTests.post
 async def test_selection_saved_and_published_without_changing_full_programme(self):
  c=FeaturedTests().sample();body={**self.body,'content':c,'template_family':'atrium'}
  saved=await self.put(body);self.assertEqual(len(saved['content']['sessions']),250)
  self.assertEqual((await self.post('publish',saved['revision'])).status_code,200)
  before=(await self.c.get('/site/demo-site')).text;self.assertIn('Unique session 003',before);self.assertNotIn('Unique session 004',before)
  current=await self.get();c['sessions'][3]['featured']=False;c['sessions'][4]['featured']=True
  saved=await self.put({**body,'content':c,'expected_revision':current['revision']})
  self.assertEqual(before,(await self.c.get('/site/demo-site')).text)
  await self.post('publish',saved['revision']);after=(await self.c.get('/site/demo-site')).text
  self.assertNotIn('Unique session 003',after);self.assertIn('Unique session 004',after)
  reloaded=await self.get();self.assertEqual(len(reloaded['content']['sessions']),250);self.assertEqual(reloaded['content']['sessions'][249]['description'],'Full notes 249')
