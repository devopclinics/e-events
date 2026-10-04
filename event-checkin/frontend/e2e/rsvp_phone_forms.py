"""Phone submission regression checks. All API calls are intercepted; no real registrations.
E2E_BASE_URL=http://127.0.0.1:9185 python3 frontend/e2e/rsvp_phone_forms.py
"""
import os, re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('E2E_BASE_URL', 'http://127.0.0.1:9185')
OUT = Path(os.environ.get('E2E_ARTIFACTS', '/tmp/rsvp-phone-ui-evidence'))
OUT.mkdir(parents=True, exist_ok=True)


def exercise(browser, name, zone, primary, expected_primary, extra=None, expected_extra=None,
             personal=False, error=False, width=1250, role='Parent/Guardian', other_role='', dark=False):
    context = browser.new_context(viewport=dict(width=width, height=950), service_workers='block')
    page = context.new_page()
    errors, payloads, unexpected_writes = [], [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    event = dict(id='phone-event', name='NCNMO Platform 2026' if 'Indiana' in zone else 'Phone Test Convention',
                 timezone=zone, event_date='2026-12-24T18:00:00', venue_name='Convention Hotel',
                 rsvp_enabled=True, experience_enabled=False, rsvp_token='phone-link', guest_hub_layout='complete',
                 rsvp_collect_phone=True, rsvp_phone_required=False, rsvp_collect_email=True,
                 rsvp_email_required=False, rsvp_multi_invitee_enabled=True, rsvp_multi_invitee_limit=2,
                 rsvp_invitee_email_required=False, rsvp_invitee_phone_required=False,
                 questions=[], invite_mode='open')
    if role == 'Child':
        event.update(rsvp_invitee_email_required=True, rsvp_invitee_phone_required=True,
                     rsvp_invitee_contact_exempt_types=['Child'])

    def api(route):
        request = route.request
        path = urlparse(request.url).path
        if request.method == 'POST' and path in ('/api/invite/link/phone-link/rsvp', '/api/invite/token/personal-phone-link/rsvp'):
            payloads.append(request.post_data_json)
            route.fulfill(json=dict(rsvp_status='confirmed', first_name='Aminu', qr_token='synthetic-pass'))
            return
        if request.method != 'GET':
            unexpected_writes.append(path)
            route.abort()
            return
        data = {}
        if path == '/api/invite/link/phone-link': data = event
        elif path == '/api/invite/token/personal-phone-link':
            data = dict(event=event, guest=dict(first_name='Aminu', last_name='Muritala', rsvp_status='invited', phone=''),
                        already_responded=False, deadline_passed=False)
        elif path.endswith('/public-theme'): data = dict(wording={}, hub_layout={})
        elif '/ticketing/' in path: data = dict(enabled=False, tickets=[])
        route.fulfill(json=data)
    page.route('**/api/**', api)
    page.goto(BASE + ('/r/personal-phone-link' if personal else '/rsvp/phone-link'))
    if dark: page.evaluate("document.documentElement.classList.add('dark')")
    page.get_by_role('button', name='Register / RSVP Now →').first.click()
    phone_hint = 'Nigerian numbers use +234' if zone == 'Africa/Lagos' else 'U.S. and Canadian numbers use +1' if 'Indiana' in zone else 'Include + and the country code'
    if personal:
        phone = page.locator('.complete-registration-stage input[type="tel"]')
        expect(phone).to_be_visible()
        expect(page.get_by_text(phone_hint, exact=False)).to_be_visible()
        phone.fill(primary)
        page.screenshot(path=str(OUT/f'{name}.png'), full_page=True)
        page.get_by_role('button', name='Confirm My RSVP', exact=True).click()
    else:
        page.get_by_role('button', name=re.compile("Yes, I'll be there")).click()
        details = page.locator('[data-registration-step="details"]')
        details.get_by_placeholder('Jane', exact=True).fill('Aminu')
        details.get_by_placeholder('Smith', exact=True).fill('Muritala')
        details.locator('input[type="email"]').fill('synthetic@example.org')
        details.locator('input[type="tel"]').fill(primary)
        expect(details.get_by_text(phone_hint, exact=False)).to_be_visible()
        page.screenshot(path=str(OUT/f'{name}.png'), full_page=True)
        page.get_by_role('button', name='Continue to Family / Guests →').click()
        guests = page.locator('[data-registration-step="guests"]')
        if extra is not None:
            guests.get_by_placeholder('Invitee first name').fill('Aisha')
            guests.get_by_placeholder('Invitee last name').fill('Muritala')
            selector = guests.get_by_label('Relationship / role', exact=True)
            custom = guests.get_by_label('Please specify relationship / role', exact=True)
            expect(custom).not_to_be_visible()
            selector.select_option('Other')
            custom.fill('Old custom role')
            selector.select_option(role if role != 'Other' else 'Parent/Guardian')
            expect(custom).not_to_be_visible()
            if role == 'Other':
                selector.select_option('Other')
                expect(custom).to_have_value('')
                page.get_by_role('button', name='Review registration →').click()
                expect(guests).to_be_visible()
                custom.fill(other_role)
            guests.locator('input[type="tel"]').fill(extra)
            if dark:
                assert selector.evaluate('e => getComputedStyle(e).backgroundColor') == 'rgb(255, 255, 255)'
            assert guests.get_by_text('Guest type', exact=True).count() == 0
            expect(guests.get_by_text(phone_hint, exact=False)).to_be_visible()
        page.get_by_role('button', name='Review registration →').click()
        page.get_by_role('button', name='Confirm Registration →').click()
    if error:
        expect(page.get_by_text('Enter a 10-digit U.S. or Canadian phone number, or include + and the country code.', exact=True)).to_be_visible()
        assert not payloads, payloads
    else:
        expect(page.get_by_role('heading', name='You’re Registered!')).to_be_visible()
        assert len(payloads) == 1, payloads
        assert payloads[0].get('phone') == expected_primary, payloads[0]
        if extra is not None:
            assert len(payloads[0]['invitees']) == 1
            assert payloads[0]['invitees'][0].get('phone') == expected_extra, payloads[0]
            assert payloads[0]['invitees'][0]['guest_type'] == role
            assert payloads[0]['invitees'][0]['relationship'] == (other_role if role == 'Other' else role)
        elif not personal:
            assert payloads[0]['invitees'] == [], 'Untouched invitee must remain optional'
    assert not errors, errors
    assert not unexpected_writes, unexpected_writes
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'
    print(f'PASS {name}: correct guidance and submission payload, no real API writes', flush=True)
    context.close()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    us = 'America/Indiana/Indianapolis'
    exercise(browser, 'ncnmo-primary-and-guest', us, '(317) 555-0123', '+13175550123', '2345550123', '+12345550123')
    exercise(browser, 'ncnmo-mobile-international-guest', us, '1 317 555 0123', '+13175550123', '+234 8012345678', '+2348012345678', width=390)
    exercise(browser, 'ncnmo-personal-invite', us, '3175550123', '+13175550123', personal=True)
    exercise(browser, 'ncnmo-personal-international', us, '+44 7700 900123', '+447700900123', personal=True, width=390)
    exercise(browser, 'nigeria-retains-local-default', 'Africa/Lagos', '08012345678', '+2348012345678', '+1 3175550123', '+13175550123')
    exercise(browser, 'blank-optional-phones', us, '', None, '', None)
    exercise(browser, 'unknown-location-explicit-code', 'Europe/Paris', '+33 612345678', '+33612345678')
    exercise(browser, 'reject-extra-digit', us, '31755501230', None, error=True)
    exercise(browser, 'other-relationship', us, '', None, '', None, role='Other', other_role='Aunt', width=390, dark=True)
    exercise(browser, 'child-contact-exemption', us, '', None, '', None, role='Child')
    browser.close()
