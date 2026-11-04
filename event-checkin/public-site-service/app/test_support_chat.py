import unittest
from unittest.mock import AsyncMock
from types import SimpleNamespace
from .support_chat import profile,embed
class SupportChatTests(unittest.TestCase):
 def test_only_published_projection_fields(self):
  p=profile('one',{'event_name':'Event one','start_date':'2026-11-11T10:00:00+01:00','timezone':'Africa/Lagos','end_date':'2026-11-11T15:00:00+01:00','venue':'Public Hall','private_note':'Never share','guest_name':'Private guest','primary_action':{'label':'Register','url':'https://example.com/register'},'sessions':[{'title':'Welcome','time':'10 AM'}]})
  self.assertIn('10:00 AM',p['answers']['time']);self.assertNotIn('03:00 PM',p['answers']['time']);self.assertNotIn('Private',str(p));self.assertIn('Register',p['answers']['registration'])
 def test_no_personal_pass_link_or_script(self):
  self.assertFalse(profile('one',{'primary_action':{'url':'https://festio.events/r/private'}})['answers']['registration'])
  html=embed('<body>Public</body>','test-event');self.assertIn('/support-chat?site=test-event',html);self.assertIn('Chat with Festio',html);self.assertNotIn('<script',html)
class PublishedReleaseTests(unittest.IsolatedAsyncioTestCase):
 async def test_current_release_only_and_unpublished_404(self):
  from .main import support_facts
  from .config import settings
  from fastapi import HTTPException
  previous=settings.enabled;settings.enabled=True
  try:
   site=SimpleNamespace(id='one',published_release_id='release-one',draft={'event_name':'Secret draft'})
   db=SimpleNamespace(scalar=AsyncMock(return_value=site),get=AsyncMock(return_value=SimpleNamespace(snapshot={'content':{'event_name':'Published event','venue':'Published Hall'}})))
   result=await support_facts('one',db);self.assertIn(b'Published Hall',result.body);self.assertNotIn(b'Secret draft',result.body);db.get.assert_awaited_once()
   db.scalar=AsyncMock(return_value=None)
   with self.assertRaises(HTTPException) as e:await support_facts('missing',db)
   self.assertEqual(e.exception.status_code,404)
  finally:settings.enabled=previous
