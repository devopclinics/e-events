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

    def test_community_track_image_and_venue_are_linked_safely(self):
        content = self.sample()
        content["venue"] = "Convention Center"
        content["venue_url"] = "https://maps.google.com/?q=Convention+Center"
        content["tracks"] = [{"title": "Junior Platform", "description": "Learn and play", "icon": "✦", "image_url": "https://cdn.example.com/junior.webp"}]
        validated = SiteContent(**content).model_dump(mode="json")
        page = render_site(validated, "community")
        self.assertIn('class="venue-link"', page)
        self.assertIn('href="https://maps.google.com/?q=Convention+Center"', page)
        self.assertIn('src="https://cdn.example.com/junior.webp"', page)
        self.assertIn("Junior Platform", page)

    def test_navigation_renders_only_enabled_valid_destinations(self):
        content = self.sample()
        content["contact_email"] = "events@example.com"
        content["navigation"] = [
            {"id": "programme", "label": "Programme", "destination_type": "section", "url": "#programme", "enabled": True},
            {"id": "speakers", "label": "Speakers", "destination_type": "speakers", "url": "https://festio.events/speakers/demo", "enabled": True},
            {"id": "junior", "label": "Junior", "destination_type": "custom", "url": "", "enabled": False},
        ]
        validated = SiteContent(**content).model_dump(mode="json")
        page = render_site(validated, "community")
        self.assertIn('href="#programme"', page)
        self.assertIn('href="https://festio.events/speakers/demo"', page)
        self.assertNotIn('>Junior</a>', page)
        self.assertNotIn('<a>Speakers</a>', page)

    def test_unsafe_navigation_destination_is_rejected(self):
        content = self.sample()
        content["navigation"] = [{"id": "bad", "label": "Bad", "destination_type": "custom", "url": "javascript:alert(1)"}]
        with self.assertRaises(ValidationError):
            SiteContent(**content)

    def test_javascript_links_are_rejected_by_schema(self):
        bad = self.sample(); bad["primary_action"]["url"] = "javascript:alert(1)"
        with self.assertRaises(ValidationError):
            SiteContent(**bad)


if __name__ == "__main__":
    unittest.main()
