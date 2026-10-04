"""Organizer settings in a local, unauthenticated harness with synthetic APIs.

Set E2E_SETTINGS_URL to the harness URL mounting FestioMeRedesignPage inside
AuthProvider, ThemeProvider and BrowserRouter. No real guest records are changed.
"""
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('E2E_SETTINGS_URL', 'http://127.0.0.1:9185/.festiome-settings-preview.html?tab=settings')
ARTIFACTS = Path(os.environ.get('E2E_ARTIFACTS', '/tmp/festiome-settings-evidence'))
ARTIFACTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    for width in [1440, 390]:
        context = browser.new_context(service_workers='block', viewport={'width': width, 'height': 1000})
        context.add_init_script("localStorage.setItem('eq.currentEventId', 'test-event');localStorage.setItem('theme', 'light')")
        page = context.new_page()
        errors, writes = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        state = {'load_fail': True, 'save_fail': True, 'forbidden': False, 'ids': ['adult-a']}

        def api(route):
            path = route.request.url.split('/api', 1)[1].split('?')[0]
            if path.endswith('/festiome/access-policy'):
                if state['forbidden']:
                    route.fulfill(status=403, json={'detail': 'Admin access required'})
                    return
                if route.request.method == 'PUT':
                    payload = route.request.post_data_json
                    writes.append(payload)
                    if state['save_fail']:
                        state['save_fail'] = False
                        route.fulfill(status=503, json={'detail': 'Access save unavailable; please retry'})
                        return
                    state['ids'] = payload['adult_guest_ids']
                    route.fulfill(json={'mode': payload['mode'], 'adult_guest_ids': state['ids'], 'queued': 3})
                    return
                if state['load_fail']:
                    state['load_fail'] = False
                    route.fulfill(status=503, json={'detail': 'Access settings unavailable'})
                    return
                route.fulfill(json={'mode': 'approved_adults', 'adult_guest_ids': state['ids'], 'guests': [
                    {'id': 'adult-a', 'name': 'Already Approved Adult'},
                    {'id': 'muritala', 'name': 'Muritala Aminu'},
                    {'id': 'child', 'name': 'Unapproved Junior'},
                ]})
                return
            value = []
            if path == '/events':
                value = [{'id': 'test-event', 'name': 'Permission UI test', 'is_paid': True, 'festiome_addon_enabled': True}]
            elif path.endswith('/festiome/status'):
                value = {'configured': True, 'available': True, 'enabled': True}
            route.fulfill(json=value)

        page.route('**/api/**', api)
        page.goto(URL)
        panel = page.get_by_role('region', name='Guest chat access')
        expect(panel.get_by_role('alert')).to_have_text('Access settings unavailable')
        panel.get_by_role('button', name='Retry loading guest chat access').click()
        expect(panel.get_by_label('Who can join chat?')).to_have_value('approved_adults')
        expect(panel.get_by_label('Already Approved Adult', exact=True)).to_be_checked()
        expect(panel.get_by_label('Unapproved Junior', exact=True)).not_to_be_checked()
        panel.get_by_label('Find a guest to approve').fill('muritala')
        panel.get_by_label('Muritala Aminu', exact=True).check()
        panel.get_by_role('button', name='Save guest chat access', exact=True).click()
        expect(panel.get_by_role('alert')).to_have_text('Access save unavailable; please retry')
        expect(panel.get_by_label('Muritala Aminu', exact=True)).to_be_checked()
        panel.get_by_role('button', name='Save guest chat access', exact=True).click()
        expect(panel.get_by_role('status')).to_contain_text('Guest chat access saved')
        assert set(writes[-1]['adult_guest_ids']) == {'adult-a', 'muritala'}
        assert writes[-1]['mode'] == 'approved_adults'
        page.reload()
        expect(panel.get_by_label('Muritala Aminu', exact=True)).to_be_checked()
        expect(panel.get_by_label('Unapproved Junior', exact=True)).not_to_be_checked()
        page.screenshot(path=str(ARTIFACTS / f'adult-settings-{width}.png'), full_page=True)
        panel.get_by_label('Muritala Aminu', exact=True).uncheck()
        panel.get_by_role('button', name='Save guest chat access', exact=True).click()
        expect(panel.get_by_role('status')).to_contain_text('Guest chat access saved')
        assert writes[-1]['adult_guest_ids'] == ['adult-a']
        state['forbidden'] = True
        page.reload()
        expect(panel.get_by_role('alert')).to_have_text('Admin access required')
        expect(panel.get_by_role('button', name='Save guest chat access', exact=True)).to_have_count(0)
        assert not errors, errors
        context.close()
        print(f'PASS {width}: settings location, search, adult approval, preserving other approvals, junior exclusion, retry, persistence, revocation, admin-only errors')
    browser.close()
