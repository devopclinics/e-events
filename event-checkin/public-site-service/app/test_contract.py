import unittest
from datetime import datetime, timedelta
from pydantic import ValidationError
from .render import render_site
from .schemas import SiteContent, SiteUpsert
from .templates import TEMPLATE_IDS


class PublicSiteContractTests(unittest.TestCase):
    def sample(self):
        return {"schema_version": 1, "event_name": "NCNMO <2026>", "headline": "Faith & family", "primary_color": "#0d5c55", "accent_color": "#d88945", "primary_action": {"label": "Register", "url": "https://festio.events/r/demo"}, "sessions": [{"title": "Opening", "time": "9:00 AM"}]}

    def test_all_template_families_are_distinct_and_escape_content(self):
        pages = [render_site(self.sample(), family) for family in TEMPLATE_IDS]
        self.assertEqual(10, len(set(pages)))
        for page in pages:
            self.assertIn("NCNMO &lt;2026&gt;", page)
            self.assertNotIn("NCNMO <2026>", page)

    def test_template_switching_preserves_all_event_content(self):
        content = self.sample()
        content.update({"venue": "City Hall", "speakers": [{"name": "Amina Bello"}], "tracks": [{"title": "Community"}], "festio_live_url": "https://festio.events/live/demo", "festiome_url": "https://festio.events/me/demo"})
        validated = SiteContent(**content).model_dump(mode="json")
        for template_id in TEMPLATE_IDS:
            page = render_site(validated, template_id)
            for expected in ("Faith &amp; family", "City Hall", "Amina Bello", "Community", "Festio Live", "FestioMe"):
                self.assertIn(expected, page, f"{template_id} lost {expected}")

    def test_legacy_template_ids_remain_valid(self):
        for family in ("community", "conference", "celebration"):
            site = SiteUpsert(org_id="o", slug=f"legacy-{family}", template_family=family, content=self.sample())
            self.assertIn("Faith &amp; family", render_site(site.content.model_dump(mode="json"), site.template_family))

    def test_every_new_template_id_is_accepted_by_site_contract(self):
        for template_id in TEMPLATE_IDS:
            site = SiteUpsert(org_id="o", slug=f"site-{template_id}", template_family=template_id, content=self.sample())
            self.assertEqual(template_id, site.template_family)

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
        for family in TEMPLATE_IDS:
            page = render_site(validated, family)
            for expected in ("Four-day programme", "Day 1", "Day 2", "Dr. Amina", "Gala Night", "Parking", "Are children included?", "Participate in live Q&amp;A, polls and activities."):
                self.assertIn(expected, page, f"missing {expected!r} in {family} render")
            self.assertNotIn("<script>", page)

    def test_single_day_event_date_does_not_leak_raw_iso_session_date(self):
        """A single-day event whose sessions carry ISO dates (from
        Experience import) must not show the raw ISO string next to the
        pretty start date, e.g. 'November 10, 2026 – 2026-11-10'."""
        content = self.sample()
        content.update({
            "start_date": "November 10, 2026",
            "sessions": [
                {"day": "Event Day", "date": "2026-11-10", "time": "9:00 AM", "title": "Opening"},
                {"day": "Event Day", "date": "2026-11-10", "time": "10:00 AM", "title": "Keynote"},
            ],
        })
        validated = SiteContent(**content).model_dump(mode="json")
        page = render_site(validated, "community")
        self.assertIn("November 10, 2026", page)
        self.assertNotIn("2026-11-10", page)

    def test_multi_day_event_date_range_is_fully_formatted(self):
        content = self.sample()
        content.update({
            "start_date": "November 10, 2026",
            "sessions": [
                {"day": "Day 1", "date": "2026-11-10", "time": "9:00 AM", "title": "Opening"},
                {"day": "Day 2", "date": "2026-11-12", "time": "9:00 AM", "title": "Closing"},
            ],
        })
        validated = SiteContent(**content).model_dump(mode="json")
        page = render_site(validated, "community")
        # The hero date line itself must be fully human-formatted — the raw
        # ISO session date is still expected to appear separately in the
        # per-day schedule tabs, which is unrelated to this date-label bug.
        self.assertIn("▣ November 10–12, 2026", page)

    def test_unconfirmed_speakers_show_a_pending_panel_not_repeated_placeholders(self):
        content = self.sample()
        content.update({
            "speakers_confirmed": False,
            "tracks": [{"title": "Business Growth"}, {"title": "Event Technology"}],
            "speakers": [{"name": "Demo Speaker", "title": "Sample Industry Expert"}] * 4,
        })
        validated = SiteContent(**content).model_dump(mode="json")
        page = render_site(validated, "community")
        self.assertIn("Speaker lineup to be announced.", page)
        self.assertIn("Business Growth", page)
        self.assertEqual(page.count("Demo Speaker"), 0)

    def test_exhibitors_section_renders_only_when_opted_in(self):
        content = self.sample()
        content.update({
            "exhibitors": [{"name": "Demo Décor Co.", "category": "Decoration & styling", "description": "Sample listing."}],
        })
        validated = SiteContent(**content).model_dump(mode="json")
        page_without = render_site(validated, "community")
        self.assertNotIn("Demo Décor", page_without)
        content["visible_sections"] = ["stats", "programme", "tracks", "connect", "exhibitors"]
        validated = SiteContent(**content).model_dump(mode="json")
        page_with = render_site(validated, "community")
        self.assertIn("Demo Décor", page_with)
        self.assertIn("Decoration &amp; styling", page_with)

    def test_feature_section_without_image_fills_visual_half_from_its_own_facts(self):
        content = self.sample()
        content.update({
            "feature_sections": [{
                "id": "partnership", "title": "Built for the people who build unforgettable events.",
                "facts": [{"label": "Registration & guest management", "value": "Before"}, {"label": "Check-in & FestioMe", "value": "During"}],
            }],
        })
        validated = SiteContent(**content).model_dump(mode="json")
        page = render_site(validated, "community")
        self.assertIn("feature-tiles", page)
        self.assertIn("Registration &amp; guest management", page)

    def test_countdown_shows_days_to_go_matching_rsvp_page_wording(self):
        content = self.sample()
        content["start_date"] = (datetime.now() + timedelta(days=10)).strftime("%B %d, %Y")
        validated = SiteContent(**content).model_dump(mode="json")
        for family in ("community", "modern-professional"):
            page = render_site(validated, family)
            self.assertIn("10 days to go", page)

    def test_countdown_says_tomorrow_on_the_day_before(self):
        content = self.sample()
        content["start_date"] = (datetime.now() + timedelta(days=1)).strftime("%B %d, %Y")
        validated = SiteContent(**content).model_dump(mode="json")
        page = render_site(validated, "community")
        self.assertIn("Tomorrow!", page)
        self.assertNotIn("1 days to go", page)

    def test_countdown_is_hidden_once_the_event_has_started(self):
        content = self.sample()
        content["start_date"] = datetime.now().strftime("%B %d, %Y")
        validated = SiteContent(**content).model_dump(mode="json")
        page = render_site(validated, "community")
        self.assertNotIn('<span class="countdown-chip">', page)

    def test_contact_links_avoid_cloudflare_email_protection(self):
        content = self.sample()
        content["contact_email"] = "events@festio.events"
        content["navigation"] = [{"id": "contact", "label": "Contact", "destination_type": "contact", "url": "mailto:events@festio.events", "enabled": True}]
        validated = SiteContent(**content).model_dump(mode="json")
        for family in ("community", "modern-professional"):
            page = render_site(validated, family)
            self.assertIn("mailto:events%40festio.events", page)
            self.assertNotIn("events@festio.events", page)

    def test_venue_heading_address_and_button_share_event_setup_map(self):
        content = self.sample()
        content.update({"venue": "Convention Center", "venue_address": "100 Main Street", "venue_url": "https://maps.example/venue"})
        validated = SiteContent(**content).model_dump(mode="json")
        for family in ("community", "modern-professional"):
            page = render_site(validated, family)
            self.assertIn('class="venue-heading-link" href="https://maps.example/venue"', page)
            self.assertIn("Convention Center", page)
            self.assertIn("100 Main Street", page)
            self.assertIn("Open directions", page)

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
