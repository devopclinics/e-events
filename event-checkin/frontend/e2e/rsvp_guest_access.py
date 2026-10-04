"""RSVP/GuestHub browser-state regression checks with synthetic APIs only.
Run: E2E_BASE_URL=http://127.0.0.1:9185 python3 frontend/e2e/rsvp_guest_access.py
Edge coverage uses its user agent in Chromium, not a native Edge binary.
"""
import json, os, re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('E2E_BASE_URL', 'http://127.0.0.1:9185')
OUT = Path(os.environ.get('E2E_ARTIFACTS', '/tmp/rsvp-access-ui-evidence'))
OUT.mkdir(parents=True, exist_ok=True)
KEY = 'eqr_rsvp:synthetic-event-link'
RECORD = dict(rsvp_status='confirmed', first_name='Aminu', qr_token='synthetic-pass')
EVENT = dict(id='synthetic-event', name='Convention 2026', event_date='2026-11-26T18:00:00',
    timezone='America/Chicago', venue_name='Convention Hotel', venue_address='123 Convention Road',
    description='Connect with members, families and invited guests.', organization_name='Convention Team',
    rsvp_enabled=True, rsvp_token='synthetic-event-link', rsvp_collect_email=True, rsvp_collect_phone=True,
    guest_hub_layout='complete', guest_hub_v2=True, experience_enabled=True, engagement_enabled=True,
    festiome_addon_enabled=True, festiome_enabled=True, registry_enabled=True, registry_token='synthetic-registry',
    live_program_enabled=True, invite_mode='open')
HUB = dict(event=EVENT, guest=dict(name='Aminu Muritala', rsvp_status='confirmed', qr_token='synthetic-pass', admitted=False),
    party=[dict(id='primary', name='Aminu Muritala', relationship='You'), dict(id='child', name='Aisha Muritala', relationship='Child')],
    capabilities=dict(festiome=True, direct_host_messages=True), announcements=[], direct_messages=[], chat_messages=[])


def exercise(browser, variant, width, user_agent=None):
    context = browser.new_context(viewport=dict(width=width, height=960), service_workers='block',
                                  **(dict(user_agent=user_agent) if user_agent else {}))
    page = context.new_page()
    errors, writes, held = [], [], []
    mode = ['valid']
    hold = [False]
    resource_unauthorized = [False]
    page.on('pageerror', lambda err: errors.append(str(err)))

    def intercept(route):
        request = route.request
        path = urlparse(request.url).path
        if request.method == 'POST' and path.endswith('/live/guest-token'):
            route.fulfill(json=dict(token='synthetic-live-session'))
            return
        if request.method != 'GET':
            writes.append(path)
            route.abort()
            return
        status, data = 200, {}
        if path.endswith('/invite/link/synthetic-event-link'):
            data = EVENT
        elif path.endswith('/invite/token/synthetic-personal-link'):
            data = dict(event=EVENT, guest=dict(first_name='Aminu', rsvp_status='confirmed', qr_token='synthetic-pass'), already_responded=True)
        elif path.endswith('/public-theme'):
            data = dict(wording=dict(hotelBookingUrl='https://example.org/hotel'), hub_layout={})
        elif path.endswith('/guest-hub'):
            if hold[0]:
                held.append(route)
                return
            if mode[0] == 'valid': data = HUB
            elif mode[0] == 'invalid': status, data = 404, dict(detail='Guest access not found')
            elif mode[0] == 'pending': status, data = 403, dict(detail='FestioHub is available after your RSVP is accepted.')
            elif mode[0] == 'non-json':
                route.fulfill(status=502, content_type='text/html', body='<h1>Bad Gateway</h1>')
                return
            else: status, data = 503, dict(detail='Service unavailable')
        elif path.endswith('/experience/me'):
            data = dict(steps=[], program=dict(enabled=True, days=[]))
        elif path.endswith('/experience/me/feedback'): data = []
        elif '/guest-content/' in path:
            if resource_unauthorized[0]: status, data = 401, dict(detail='Guest access not found')
            else: data = dict(materials=[], certificates=[])
        elif path.endswith('/push/config'): data = dict(enabled=False)
        elif 'rsvp-questions' in path: data = []
        elif '/ticketing/' in path: data = dict(enabled=False, ticket_types=[])
        elif '/qr.png' in path:
            route.fulfill(content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="black"/></svg>')
            return
        route.fulfill(status=status, json=data)
    page.route('**/api/**', intercept)

    def remember():
        page.evaluate('(record) => localStorage.setItem("eqr_rsvp:synthetic-event-link", JSON.stringify(record))', RECORD)

    def saved_record():
        return page.evaluate('JSON.parse(localStorage.getItem("eqr_rsvp:synthetic-event-link"))')

    def consistent():
        assert page.locator('.fh-complete-layout').count() == 0, 'Legacy fallback appears'
        assert page.get_by_text('Registration in progress', exact=True).count() == 0, 'Invented registration state'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'

    page.goto(BASE + '/rsvp/synthetic-event-link')
    expect(page.get_by_role('heading', name='Everything You Need to Know')).to_be_visible()
    assert page.locator('.flow-access-state').count() == 0
    remember()
    hold[0] = True
    page.reload(wait_until='domcontentloaded')
    expect(page.get_by_role('heading', name='Opening your GuestHub…')).to_be_visible()
    consistent()
    page.screenshot(path=str(OUT / f'{variant}-loading.png'))
    hold[0] = False
    assert held, 'Expected delayed GuestHub request'
    for route in held: route.fulfill(json=HUB)
    held.clear()
    expect(page.get_by_role('heading', name='Welcome, Aminu!')).to_be_visible()
    expect(page.get_by_role('heading', name='My Party (2)')).to_be_visible()
    for feature in ('FestioMe', 'Communications', 'Book your hotel', 'Festio Live'):
        expect(page.locator('.flow-tool-grid').get_by_role('button', name=re.compile(feature))).to_be_visible()
    consistent()
    page.screenshot(path=str(OUT / f'{variant}-registered.png'), full_page=True)
    page.locator('.flow-help-link').focus()
    page.locator('.flow-help-link').press('Enter')
    expect(page.get_by_placeholder('Ask the host a question...')).to_be_visible()
    page.get_by_role('button', name='← Back to GuestHub home').click()
    page.get_by_role('button', name=re.compile('Help & FAQ')).click()
    expect(page.get_by_placeholder('Ask the host a question...')).to_be_visible()
    page.get_by_role('button', name='← Back to GuestHub home').click()
    consistent()
    page.get_by_role('button', name=re.compile('View My Pass')).click()
    expect(page.get_by_role('img', name='Your QR pass code')).to_be_visible()
    page.get_by_role('button', name='Open GuestHub →').click()
    expect(page.get_by_role('heading', name='My Party (2)')).to_be_visible()

    # The Help shortcut cannot enable organizer messaging when the event disables it.
    HUB['capabilities']['direct_host_messages'] = False
    EVENT['host_email'] = 'organizer@example.org'
    page.reload()
    expect(page.locator('.flow-help-link')).to_be_visible()
    page.locator('.flow-help-link').click()
    expect(page.get_by_text("Message Host isn't enabled for this event.", exact=True)).to_be_visible()
    assert page.get_by_placeholder('Ask the host a question...').count() == 0
    expect(page.get_by_role('link', name='Email the event organizer →')).to_have_attribute('href', 'mailto:organizer@example.org')
    HUB['capabilities']['direct_host_messages'] = True
    EVENT.pop('host_email')

    mode[0] = 'invalid'
    page.reload()
    expect(page.get_by_role('heading', name='Open your personal GuestHub link')).to_be_visible()
    consistent()
    assert saved_record() == RECORD, 'Saved registration must not be silently erased'
    page.screenshot(path=str(OUT / f'{variant}-invalid.png'), full_page=True)
    page.get_by_role('button', name='View event details').click()
    expect(page.get_by_role('heading', name='Everything You Need to Know')).to_be_visible()
    page.get_by_role('button', name='Already registered? Open My GuestHub →').click()
    expect(page.get_by_role('heading', name='Open your personal GuestHub link')).to_be_visible()
    mode[0] = 'valid'
    page.get_by_role('button', name='Try again').click()
    expect(page.get_by_role('heading', name='Welcome, Aminu!')).to_be_visible()

    for error_mode in ('unavailable', 'non-json', 'pending'):
        mode[0] = error_mode
        page.reload()
        title = 'Your registration needs confirmation' if error_mode == 'pending' else 'Your GuestHub could not load'
        expect(page.get_by_role('heading', name=title)).to_be_visible()
        consistent()
        assert saved_record() == RECORD
        mode[0] = 'valid'
        page.get_by_role('button', name='Try again').click()
        expect(page.get_by_role('heading', name='Welcome, Aminu!')).to_be_visible()

    # Optional resources must never bounce an expired guest pass to admin login.
    resource_unauthorized[0] = True
    page.goto(BASE + '/r/synthetic-personal-link#guest-hub')
    expect(page.get_by_role('heading', name='Welcome, Aminu!')).to_be_visible()
    page.wait_for_timeout(300)
    assert '/login' not in page.url
    consistent()
    assert not errors, errors
    assert not writes, writes
    print(f'{variant}: visitor, delayed load, party/pass/features, invalid access, retry, event details, outage, non-JSON, pending, personal link and resource 401 passed', flush=True)
    context.close()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    exercise(browser, 'chrome-desktop', 1250)
    exercise(browser, 'edge-user-agent', 1250, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0')
    exercise(browser, 'chrome-mobile', 390, 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36')
    browser.close()
