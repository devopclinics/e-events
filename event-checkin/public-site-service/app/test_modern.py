import base64
import hashlib
import unittest
from .schemas import SiteContent
from .render import render_site
from .templates import MODERN_TEMPLATES
from .modern import JS, security_policy

class ModernTemplatesTests(unittest.TestCase):
 def sample(self):
  return SiteContent(event_name='Research & Community',headline='Learn together',start_date='2027-03-05',end_date='2027-03-07',timezone='Europe/London',sessions=[{'title':'A session','description':'Detailed description. '*100,'action_label':'Join quiz','action_url':'https://example.com/quiz','day':'Friday'}],tracks=[{'title':'Adults','description':'A track'}],faqs=[{'question':'Where?','answer':'Main hall'}],exhibitors=[{'name':'A partner','description':'Exhibitor information'}],highlights=['Opening reception'],feature_sections=[{'id':'gala','title':'Gala','summary':'Details','action':{'label':'Reserve','url':'https://example.com/gala'}}]).model_dump(mode='json')
 def test_all_designs_use_real_content_not_prototype_data(self):
  for family in MODERN_TEMPLATES:
   page=render_site(self.sample(),family)
   for value in ['Research &amp; Community','Detailed description. '*100,'Join quiz','Exhibitor information','Opening reception','Reserve','Main hall']: self.assertIn(value,page,family)
   for value in ['NCNMO','PLATFORM<br>2026','December 2026','Indianapolis','Preview only. Nothing']:self.assertNotIn(value,page,family)
 def test_empty_sections_and_disabled_services(self):
  content=self.sample();content.update(visible_sections=[],speakers=[],feature_sections=[])
  for family in MODERN_TEMPLATES:
   page=render_site(content,family)
   for value in ['id="programme"','id="tracks"','id="connect"','id="speakers"','id="gala"']:self.assertNotIn(value,page)
 def test_palette_choice_and_published_brand_precedence(self):
  content=self.sample();content.update(primary_color='#765432',accent_color='#123456')
  self.assertIn('--color:#155c46',render_site(content,'atrium'))
  content['use_template_style']=False
  self.assertIn('--color:#765432',render_site(content,'atrium'))
  content.update(use_template_style=True,use_event_branding=True)
  self.assertIn('--color:#765432',render_site(content,'atrium'))
 def test_only_fixed_script_hash_and_escaped_content(self):
  content=self.sample();content['sessions'][0]['description']='</script><script>alert("unsafe")</script>'
  page=render_site(content,'orbit')
  self.assertEqual(page.count('<script '),1);self.assertNotIn('<script>alert',page)
  self.assertIn('sha256-'+base64.b64encode(hashlib.sha256(JS.encode()).digest()).decode(),security_policy())
  self.assertNotIn("script-src 'unsafe-inline'",security_policy())
 def test_demo_source_notes_remain_in_details(self):
  content=self.sample();content['sessions'][0]['description']='DEMO DRAFT: Not approved. Source workbook.'
  page=render_site(content,'atlas');self.assertIn('Demo programme',page);self.assertIn('DEMO DRAFT: Not approved. Source workbook.',page);self.assertIn('<details class="session-details">',page)

 def test_unconfirmed_speakers_do_not_publish_names(self):
  content=self.sample();content.update(speakers_confirmed=False,speakers=[{'name':'Private draft name','bio':'Not confirmed'}])
  for family in MODERN_TEMPLATES:
   page=render_site(content,family);self.assertNotIn('Private draft name',page);self.assertIn('confirmed speaker lineup',page)
