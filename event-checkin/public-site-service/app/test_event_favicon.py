from copy import deepcopy
from .render import render_site


def test_event_logo_is_used_in_all_website_layouts():
    for family, extras in [("community", {}), ("modern-professional", {}), ("editorial", {"convention_editorial": True}), ("modern-professional", {"industry_editorial": True})]:
        content = {"event_name": "Example event", "logo_url": "https://festio.events/site-assets/event-logo.png?version=2&size=small", **extras}
        html = render_site(deepcopy(content), family)
        assert '<link rel="icon" href="https://festio.events/site-assets/event-logo.png?version=2&amp;size=small">' in html.split("</head>")[0]
        assert html.count('rel="icon"') == 1


def test_missing_or_unsafe_logo_does_not_create_a_favicon():
    for logo in [None, "", "javascript:alert(1)", 'data:image/svg+xml,<svg/>']:
        html = render_site({"event_name": "Example", "logo_url": logo}, "community")
        assert 'rel="icon"' not in html
