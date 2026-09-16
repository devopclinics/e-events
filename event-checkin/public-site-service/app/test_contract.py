import unittest
from pydantic import ValidationError
from .render import render_site
from .schemas import SiteContent, SiteUpsert


class PublicSiteContractTests(unittest.TestCase):
    def sample(self):
        return {"schema_version": 1, "event_name": "NCNMO <2026>", "headline": "Faith & family", "primary_color": "#0d5c55", "accent_color": "#d88945", "primary_action": {"label": "Register", "url": "https://festio.events/r/demo"}, "sessions": [{"title": "Opening", "time": "9:00 AM"}]}

    def test_all_template_families_are_distinct_and_escape_content(self):
        pages = [render_site(self.sample(), family) for family in ("community", "conference", "celebration")]
        self.assertEqual(3, len(set(pages)))
        for page in pages:
            self.assertIn("NCNMO &lt;2026&gt;", page)
            self.assertNotIn("NCNMO <2026>", page)

    def test_slug_and_colors_are_validated(self):
        with self.assertRaises(ValidationError):
            SiteUpsert(org_id="o", slug="Bad Slug", content=self.sample())
        bad = self.sample(); bad["primary_color"] = "red"
        with self.assertRaises(ValidationError):
            SiteContent(**bad)

    def test_javascript_links_are_rejected_by_schema(self):
        bad = self.sample(); bad["primary_action"]["url"] = "javascript:alert(1)"
        with self.assertRaises(ValidationError):
            SiteContent(**bad)


if __name__ == "__main__":
    unittest.main()
