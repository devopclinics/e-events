import copy
import unittest
from .schemas import SiteContent
from .render import render_site
from .templates import MODERN_TEMPLATES
from . import test_website_editor as editor

class PremiumTests(unittest.TestCase):
    def sample(self):
        return SiteContent(event_name='A real event', headline='A place to belong.', headline_highlight='belong.', intro_title='Discover the community', intro_summary='A real invitation.', closing_title='Come together', venue='Actual venue', venue_image_url='https://example.com/venue.jpg', venue_image_alt='Venue exterior', venue_summary='Plan your arrival.', image_fit='contain', image_position='top', primary_action={'label':'Register','url':'https://example.com/rsvp'}, guesthub_url='https://example.com/recover', sessions=[{'title':'Original classroom planning title','display_title':'Learn together','display_summary':'Short introduction','featured':True,'description':'DEMO DRAFT: Complete source notes','track':'Learning','image_alt':'Learning activity','image_url':'https://example.com/learning.jpg'}, {'title':'Gala','featured':True,'track':'Community'}]).model_dump(mode='json')
    def test_story_and_display_fields_preserve_source_for_every_template(self):
        c=self.sample();original=copy.deepcopy(c)
        for family in MODERN_TEMPLATES:
            page=render_site(c,family)
            for text in ['Learn together','Short introduction','Original classroom planning title','DEMO DRAFT: Complete source notes','Discover the community','Come together','Plan your arrival.','Venue exterior','https://example.com/recover','https://example.com/rsvp']:
                self.assertIn(text,page,family)
            self.assertIn('<em>belong.</em>',page)
            self.assertIn('--hero-fit:contain;--hero-position:top',page)
            self.assertEqual(c,original)
    def test_custom_fonts_and_palette_reach_every_modern_template(self):
        c=self.sample();c.update(use_template_style=False,font_pairing='elegant-serif',accent_color='#112233')
        for family in MODERN_TEMPLATES:
            page=render_site(c,family)
            self.assertIn('--heading-font:Georgia,serif',page)
            self.assertIn('--accent-ink:#ffffff',page)
    def test_empty_story_media_actions_never_invent_content(self):
        c=SiteContent(event_name='Sparse event',headline='Welcome').model_dump(mode='json')
        for family in MODERN_TEMPLATES:
            page=render_site(c,family)
            for markup in ['<section class="event-intro"','<img class="venue-photo"','<section class="registration-close"','class="btn header-action"']:
                self.assertNotIn(markup,page)
            self.assertNotIn('Indianapolis',page)
    def test_new_fields_are_escaped(self):
        c=self.sample();bad='<script>alert(1)</script>'
        c.update(headline=bad,headline_highlight=bad,intro_summary=bad,venue_summary=bad,closing_title=bad)
        c['sessions'][0].update(display_title=bad,display_summary=bad,image_alt='" onerror="alert(1)')
        for family in MODERN_TEMPLATES:
            page=render_site(c,family);self.assertNotIn(bad,page);self.assertNotIn('alt="" onerror=',page)
            self.assertIn('&lt;script&gt;',page)
    def test_filters_are_progressive_and_featured_only(self):
        c=self.sample();c['sessions'].append({'title':'Private nonfeatured session','featured':False,'track':'Hidden'})
        for family in MODERN_TEMPLATES:
            page=render_site(c,family)
            self.assertIn('data-highlight-controls hidden',page)
            self.assertIn('data-count="2"',page)
            self.assertNotIn('Private nonfeatured session',page)
            self.assertNotIn('>Hidden</button>',page)

class PremiumPublicationTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=editor.WebsiteEditorTests.asyncSetUp
    asyncTearDown=editor.WebsiteEditorTests.asyncTearDown
    put=editor.WebsiteEditorTests.put
    get=editor.WebsiteEditorTests.get
    post=editor.WebsiteEditorTests.post
    async def test_save_reload_publish_retains_story_and_original_sessions(self):
        c=PremiumTests().sample()
        saved=await self.put({**self.body,'template_family':'premium-convention','content':c})
        self.assertEqual(saved['content'],(await self.get())['content'])
        self.assertEqual((await self.post('publish',saved['revision'])).status_code,200)
        page=(await self.c.get('/site/demo-site')).text
        for text in ['Learn together','Original classroom planning title','Short introduction','Venue exterior','Come together']:
            self.assertIn(text,page)
        self.assertEqual((await self.get())['content']['sessions'][0]['description'],'DEMO DRAFT: Complete source notes')
