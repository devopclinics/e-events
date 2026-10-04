"""Guest entry failures and recovery; synthetic policy changes, no real writes."""
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:4000")
ARTIFACTS = Path(os.environ.get("E2E_ARTIFACTS", "/tmp/festiome-access-evidence"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
REASON = ("This event's FestioMe community is limited to approved adults. "
          "Your pass is valid, but the organizer has not approved it for chat access. "
          "Return to GuestHub to contact the organizer.")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    for width in [1440, 390]:
        context = browser.new_context(service_workers="block", viewport={"width": width, "height": 900})
        page = context.new_page()
        state = {"approved": False, "exchanges": 0, "account_requests": 0}
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def api(route):
            path = route.request.url.split("/api", 1)[1].split("?")[0]
            if path.endswith("/festiome/guest-token"):
                state["exchanges"] += 1
                assert route.request.post_data_json == {"pass_token": "synthetic-restricted-pass"}
                if not state["approved"]:
                    route.fulfill(status=403, json={"detail": REASON})
                else:
                    route.fulfill(json={"token": "approved-test-token", "expires_at": "2099-01-01T00:00:00Z"})
                return
            if path == "/auth/festiome-token":
                state["account_requests"] += 1
                route.fulfill(status=500, json={})
                return
            value = []
            if path == "/festiome/v1/groups":
                value = [{"id": "community", "name": "Approved community", "external_event_ref": "test-event", "viewer_role": "member", "member_count": 1}]
            elif path.endswith("/channels"):
                value = [{"id": "general", "name": "General", "kind": "discussion"}]
            elif path.endswith("/guest-hub"):
                value = {"event": {"name": "Approved community"}, "guest": {}, "capabilities": {}}
            elif path.endswith("/messages"):
                value = {"items": [], "next_cursor": None}
            elif path.endswith("/realtime-ticket"):
                route.fulfill(status=503, json={"detail": "Polling fixture"})
                return
            elif path.endswith("/public-theme"):
                value = {"hub_style": "forest-editorial"}
            route.fulfill(json=value)

        page.route("**/api/**", api)
        page.route("**/r/synthetic-restricted-pass", lambda route: route.fulfill(body="<h1>GuestHub return</h1>", content_type="text/html"))
        url = BASE + "/festiome/guest?event=test-event&pass=synthetic-restricted-pass"
        page.goto(url)
        expect(page.get_by_role("heading", name="FestioMe access needs approval")).to_be_visible()
        expect(page.get_by_text(REASON, exact=True)).to_be_visible()
        page.screenshot(path=str(ARTIFACTS / f"approval-{width}.png"))
        page.get_by_role("button", name="Check access again", exact=True).click()
        expect(page.get_by_role("heading", name="FestioMe access needs approval")).to_be_visible()
        assert state["exchanges"] == 2
        page.get_by_role("button", name="← Back to GuestHub", exact=True).click()
        expect(page).to_have_url(BASE + "/r/synthetic-restricted-pass#guest-hub")
        page.goto(url)
        expect(page.get_by_role("heading", name="FestioMe access needs approval")).to_be_visible()
        state["approved"] = True
        page.get_by_role("button", name="Check access again", exact=True).click()
        expect(page.locator(".fm-event-header h1")).to_have_text("Approved community")
        expect(page.get_by_role("heading", name="FestioMe access needs approval")).to_have_count(0)
        assert state["account_requests"] == 0
        assert not errors, errors
        context.close()
        print(f"PASS {width}: approval explanation, retry, GuestHub return, recovery; no organizer fallback")
    browser.close()
