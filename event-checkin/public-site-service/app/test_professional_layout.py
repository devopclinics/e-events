import unittest
from .render import render_site

class ProfessionalLayoutTests(unittest.TestCase):
    def content(self):
        return {'event_name':'PAMCON 2026','headline':'One connected experience','start_date':'2026-11-10','end_date':'2026-11-10','timezone':'Africa/Lagos','primary_action':{'label':'Register','url':'https://example.org/register'},'speakers':[{'name':'Sample speaker'}],'navigation':[{'label':'Speakers','url':'#speakers'}],'visible_sections':['stats','programme','tracks'],'stats':[{'value':'6','label':'Tracks'}]}

    def test_professional_mobile_navigation_keeps_existing_destinations(self):
        page=render_site(self.content(),'modern-professional',preview=True)
        self.assertIn('class="mobile-site-menu"',page)
        self.assertIn('<summary>Menu</summary>',page)
        self.assertGreaterEqual(page.count('href="#speakers"'),2)
        self.assertIn('Responsive layout for the classic professional',page)
        self.assertIn('Preview — visitors cannot see this draft',page)

    def test_single_day_is_not_rendered_as_duplicate_date_range(self):
        page=render_site(self.content(),'modern-professional')
        self.assertNotIn('November 10, 2026 – November 10, 2026',page)
        self.assertIn('November 10, 2026',page)
        content=self.content();content['end_date']='2026-11-12'
        self.assertIn('November 10, 2026 – November 12, 2026',render_site(content,'modern-professional'))

    def test_professional_styles_do_not_change_other_template_families(self):
        for family in ['community','atrium','clean-elegant','premium-convention']:
            page=render_site(self.content(),family)
            self.assertNotIn('Responsive layout for the classic professional',page)
            self.assertNotIn('class="mobile-site-menu"',page)
