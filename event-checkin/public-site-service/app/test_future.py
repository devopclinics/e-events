import copy
import unittest
from .schemas import SiteContent, SiteUpsert
from .render import render_site
from .templates import canonical_template
from . import test_website_editor as editor

FAMILIES = ('noor-future', 'mosaic-future', 'orbit-future')

class FutureTemplatesTests(unittest.TestCase):
    def content(self):
        return SiteContent(event_name='Learning & Community',headline='A brighter future.',headline_highlight='future.',start_date='2027-03-09T10:00:00-06:00',timezone='America/Chicago',speakers_confirmed=False,primary_action={'label':'Join us','url':'https://example.com/register'},sessions=[{'title':'Public session','featured':True},{'title':'Private session','featured':False}]).model_dump(mode='json')

    def test_registered_without_replacing_existing_templates(self):
        for family in FAMILIES + ('orbit','mosaic'):
            self.assertEqual(canonical_template(family),family)
            SiteUpsert(org_id='test',slug='test-site',template_family=family,content=self.content())

    def test_dynamic_art_content_and_existing_functionality(self):
        c=self.content();before=copy.deepcopy(c)
        for family in FAMILIES:
            page=render_site(c,family)
            for text in ('Learning &amp; Community','<em>future.</em>','Public session','https://example.com/register','confirmed speaker lineup'):
                self.assertIn(text,page,family)
            for text in ('Private session','MUMINEEN','DECEMBER ’26','__FUTURE_'):
                self.assertNotIn(text,page,family)
            self.assertEqual(c,before)
        mosaic=render_site(c,'mosaic-future')
        self.assertIn('9<small>MARCH 2027</small>',mosaic)

    def test_template_artwork_overrides_saved_hero_reversibly(self):
        c=self.content();c.update(use_template_artwork=True,feature_image_url='https://example.com/old-book.png')
        for family in FAMILIES:
            page=render_site(c,family)
            self.assertIn('class="future-art',page)
            self.assertNotIn('class="uploaded-hero"',page)
            self.assertEqual(c['feature_image_url'],'https://example.com/old-book.png')
            custom=render_site({**c,'use_template_artwork':False},family)
            self.assertIn('class="uploaded-hero"',custom)
        self.assertIn('class="uploaded-hero"',render_site(c,'mosaic'))

    def test_missing_date_and_escaping_do_not_invent_facts(self):
        c=SiteContent(event_name='<img src=x onerror=alert(1)>',headline='Hello').model_dump(mode='json')
        for family in FAMILIES:
            page=render_site(c,family)
            self.assertNotIn('<img src=x',page)
            self.assertNotIn('Mumineen Academy',page)
        self.assertIn('DATE TO FOLLOW',render_site(c,'mosaic-future'))

class FuturePublicationTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=editor.WebsiteEditorTests.asyncSetUp
    asyncTearDown=editor.WebsiteEditorTests.asyncTearDown
    put=editor.WebsiteEditorTests.put
    get=editor.WebsiteEditorTests.get
    post=editor.WebsiteEditorTests.post

    async def test_each_template_can_save_preview_publish_and_reload(self):
        await self.put()
        for family in FAMILIES:
            current=await self.get()
            saved=await self.put({**self.body,'template_family':family,'expected_revision':current['revision'],'content':FutureTemplatesTests().content()})
            self.assertEqual((await self.get())['template_family'],family)
            preview=await self.post('preview',saved['revision'])
            self.assertEqual(preview.status_code,200)
            publish=await self.post('publish',saved['revision'])
            self.assertEqual(publish.status_code,200)
            page=await self.c.get('/site/demo-site')
            self.assertEqual(page.status_code,200)
            self.assertIn('data-template="'+family+'"',page.text)
