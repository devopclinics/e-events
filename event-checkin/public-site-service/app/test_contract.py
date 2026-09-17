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
            {"id": "rsvp", "label": "RSVP", "destination_type": "rsvp", "url": "https://festio.events/rsvp/demo", "enabled": True},
            {"id": "live", "label": "Festio Live", "destination_type": "festio_live", "url": "https://festio.events/l/LIVE26", "enabled": True},
            {"id": "community", "label": "FestioMe", "destination_type": "festiome", "url": "https://community.example/event", "enabled": True},
            {"id": "junior", "label": "Junior", "destination_type": "custom", "url": "", "enabled": False},
        ]
        validated = SiteContent(**content).model_dump(mode="json")
        page = render_site(validated, "community")
        self.assertIn('href="#programme"', page)
        self.assertIn('href="https://festio.events/speakers/demo"', page)
        self.assertIn('href="https://festio.events/rsvp/demo"', page)
        self.assertIn('href="https://festio.events/l/LIVE26"', page)
        self.assertIn('href="https://community.example/event"', page)
        self.assertNotIn('>Junior</a>', page)
        self.assertNotIn('<a>Speakers</a>', page)

    def test_rich_event_modules_render_as_reusable_sections(self):
        content = self.sample()
        content.update({
            "programme_title": "Four-day programme",
            "programme_summary": "Choose your day and track.",
            "sessions": [
                {"day": "Day 1", "date": "2026-12-24", "time": "9:00 AM", "title": "Opening", "track": "Community", "venue": "Main Hall", "audience": "All guests", "speaker": "Dr. Amina"},
                {"day": "Day 2", "date": "2026-12-25", "time": "10:00 AM", "title": "Junior workshop", "track": "Junior", "venue": "Room A", "audience": "Ages 8–12"},
            ],
            "speakers": [{"name": "Dr. Amina", "title": "Educator", "organization": "NCNMO", "bio": "Community educator", "photo_url": ""}],
            "tracks": [{"title": "Community", "description": "Talks and panels", "color": "#2f5aa8"}, {"title": "Junior", "description": "Kids programme"}],
            "registration_facts": [{"label": "Deadline", "value": "December 1"}],
            "venue_facts": [{"label": "Parking", "value": "North entrance"}],
            "feature_sections": [{"id": "gala", "kicker": "Special event", "title": "Gala Night", "summary": "An evening celebration", "image_url": "", "facts": [{"label": "Dress", "value": "Formal"}]}],
            "faqs": [{"question": "Are children included?", "answer": "Register every child attending."}],
            "festio_live_url": "https://festio.events/l/LIVE26",
            "festiome_url": "https://community.example/event",
        })
        validated = SiteContent(**content).model_dump(mode="json")
        for family in ("community", "conference", "celebration"):
            page = render_site(validated, family)
            for expected in ("Four-day programme", "Day 1", "Day 2", "Dr. Amina", "Gala Night", "Parking", "Are children included?", "Participate in live Q&amp;A, polls and activities."):
                self.assertIn(expected, page, f"missing {expected!r} in {family} render")
            self.assertNotIn("<script>", page)

    def test_unsafe_navigation_destination_is_rejected(self):
        content = self.sample()
        content["navigation"] = [{"id": "bad", "label": "Bad", "destination_type": "custom", "url": "javascript:alert(1)"}]
        with self.assertRaises(ValidationError):
            SiteContent(**content)

    def test_javascript_links_are_rejected_by_schema(self):
        bad = self.sample(); bad["primary_action"]["url"] = "javascript:alert(1)"
        with self.assertRaises(ValidationError):
            SiteContent(**bad)

    def test_blank_action_url_collapses_to_no_button_instead_of_failing(self):
        """A real event with RSVP not yet enabled sends primary_action with a
        blank url (label kept, url ''). That must publish, not 422 — see
        the live 'must be an http(s)... destination' bug on Al-Azeemah."""
        content = self.sample()
        content["primary_action"] = {"label": "Register / RSVP →", "url": ""}
        content["secondary_action"] = {"label": "View your pass", "url": ""}
        content["feature_sections"] = [{"id": "gala", "title": "Gala Night", "action": {"label": "Learn more", "url": ""}}]
        validated = SiteContent(**content)
        self.assertIsNone(validated.primary_action)
        self.assertIsNone(validated.secondary_action)
        self.assertIsNone(validated.feature_sections[0].action)
        page = render_site(validated.model_dump(mode="json"), "community")
        self.assertNotIn('class="nav-cta"', page)

    def test_day_and_track_filtering_is_pure_css_no_script(self):
        """Public pages ship a strict CSP with no script-src (Plan §14 — no
        custom JS on untrusted public content). Day/track filtering must
        work via radio inputs + CSS sibling selectors, never <script>."""
        content = self.sample()
        content["tracks"] = [
            {"title": "Community", "description": "Talks", "color": "#2f5aa8"},
            {"title": "Junior", "description": "Kids programme", "color": "#3d8b4c"},
        ]
        content["sessions"] = [
            {"day": "Day 1", "date": "2026-12-24", "time": "9:00 AM", "title": "Opening", "track": "Community"},
            {"day": "Day 2", "date": "2026-12-25", "time": "10:00 AM", "title": "Kids workshop", "track": "Junior"},
        ]
        validated = SiteContent(**content).model_dump(mode="json")
        page = render_site(validated, "community")
        self.assertNotIn("<script", page)
        self.assertIn('type="radio" name="day-filter" id="day-day-1" class="filter-radio" checked', page)
        self.assertIn('type="radio" name="track-filter" id="track-community"', page)
        self.assertIn('for="day-day-1" class="day-tab"', page)
        self.assertIn('for="track-junior" class="track-pill"', page)
        self.assertIn('#day-day-1:checked ~ .sessions .session:not([data-day="Day 1"])', page)
        self.assertIn('#track-community:checked ~ .sessions .session:not([data-track="Community"])', page)
        self.assertIn('class="site-container nav-inner"', page)
        self.assertIn('class="site-container hero-inner"', page)
        self.assertIn('class="session-time"><time>9:00 AM</time>', page)
        self.assertIn('href="#programme">Explore Programme</a>', page)
        self.assertLess(page.index('id="programme"'), page.index('id="tracks"'))


if __name__ == "__main__":
    unittest.main()
