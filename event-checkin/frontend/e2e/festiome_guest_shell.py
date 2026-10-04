"""Guest UI regression checks with synthetic data; never writes to real events.
Run: E2E_BASE_URL=http://127.0.0.1:9185 python3 frontend/e2e/festiome_guest_shell.py
"""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('E2E_BASE_URL', 'http://127.0.0.1:9185')
ARTIFACTS = Path(os.environ.get('E2E_ARTIFACTS', '/tmp/festiome-ui-evidence'))
ARTIFACTS.mkdir(exist_ok=True)

def exercise(browser, width, height):
    context = browser.new_context(service_workers='block',viewport={'width': width, 'height': height})
    page = context.new_page()
    errors, sent, exchanges, account_tokens, reactions = [], [], [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    channels = [dict(id='general', name='General', kind='discussion', unread_count=3), dict(id='announcements', name='Announcements', kind='announcement', unread_count=1)]
    members = [dict(id='me',display_name='Aminu Muritala',is_me=True,role='member',bio='Community member'),dict(id='aisha',display_name='Aisha Bello',role='member',bio='Looking forward to the convention',interest_tags=['community'])]
    messages = [dict(id='welcome',author_name='Aisha Bello',author_member_id='aisha',body='Looking forward to meeting everyone!',created_at='2026-10-02T15:24:00Z',reactions=[])]
    messages += [dict(id='second',author_name='Aminu Muritala',author_member_id='me',body='See you at the convention!',created_at='2026-10-02T15:25:00Z',reactions=[]),
                 dict(id='third',author_name='Aisha Bello',author_member_id='aisha',body='Bringing my family too.',created_at='2026-10-02T15:26:00Z',reactions=[])]
    expired_once = [False]
    created_meetups = []
    def api(route):
        req = route.request
        path = req.url.split('/api',1)[1].split('?')[0]
        value = []
        if path.endswith('/festiome/guest-token'):
            exchanges.append(req.post_data_json)
            value = dict(token='synthetic-guest-token', expires_at='2099-01-01T00:00:00Z')
        elif path == '/auth/festiome-token':
            account_tokens.append(path)
            value = dict(token='forbidden-organizer-token')
        elif path == '/festiome/v1/groups':
            value = [dict(id='event-group', name='NCNMO Platform 2026', external_event_ref='event-test', member_count=22, viewer_role='member', rules_accepted=True, description='Faith, family, learning and community.')]
        elif path.endswith('/channels'):
            value = channels
        elif path.endswith('/members'):
            value = members
        elif '/reactions' in path:
            from urllib.parse import unquote
            message = next(m for m in messages if m['id'] == path.split('/messages/')[1].split('/')[0])
            if req.method == 'POST':
                emoji = req.post_data_json['emoji']
                message['reactions'].append(dict(emoji=emoji,count=1,reacted_by_me=True))
            else:
                emoji = unquote(path.rsplit('/',1)[1])
                message['reactions'] = [r for r in message['reactions'] if r['emoji'] != emoji]
            reactions.append((req.method,emoji))
            value = message
        elif path.endswith('/messages'):
            if req.method == 'POST':
                sent.append(req.post_data_json)
                value = dict(id='sent',author_name='Aminu Muritala',author_member_id='me',body=req.post_data_json['body'],created_at='2026-10-02T16:00:00Z',reactions=[])
                messages.append(value)
            else:
                value = dict(items=list(reversed(messages)) if 'general' in path or 'dm' in path else [], next_cursor=None)
        elif path.endswith('/dms'):
            value = dict(id='dm-aisha',name='Aisha Bello',is_dm=True,kind='discussion')
            if not any(c['id']==value['id'] for c in channels): channels.append(value)
        elif path.endswith('/guest-hub'):
            value = dict(event=dict(id='event-test',name='NCNMO Platform 2026'),guest=dict(name='Aminu Muritala'),capabilities={})
        elif path.endswith('/public-theme'):
            value = dict(hub_style='forest-editorial')
        elif path.endswith('/experience/me'):
            value = dict(program=dict(days=[]))
        elif path.endswith('/notification-preferences'):
            value = dict(in_app=True,email=False,push=False,digest='daily',muted=False)
        elif path.endswith('/profile'):
            members[0].update(req.post_data_json)
            value = members[0]
        elif path.endswith('/meetups'):
            if req.method == 'POST':
                value = dict(id='meetup-test',status='scheduled',creator_name='Aminu Muritala',attendee_count=1,my_status='going',**req.post_data_json)
                created_meetups.append(value)
                route.fulfill(json=value)
                return
            if not expired_once[0]:
                expired_once[0]=True
                route.fulfill(status=401,json={'detail':'expired guest session'})
                return
            value=created_meetups
        elif path.endswith('/realtime-ticket'):
            route.fulfill(status=503,json={'detail':'Polling fixture'})
            return
        route.fulfill(json=value)
    page.route('**/api/**', api)
    page.goto(BASE + '/festiome/guest?event=event-test&pass=synthetic-pass')
    expect(page.locator('.fm-event-header h1')).to_have_text('NCNMO Platform 2026')
    expect(page.locator('.fm-chat-navigation')).to_be_visible()
    if width < 700:
        expect(page.locator('.fm-chat-list')).to_be_visible()
        expect(page.locator('.fm-chat-thread')).not_to_be_visible()
        page.locator('.fm-chat-list').get_by_role('button',name=re.compile('General')).click()
    expect(page.get_by_placeholder('Write a message…')).to_be_visible()
    composer = page.get_by_placeholder('Write a message…')
    expect(page.locator('.fm-chat-thread').get_by_text('Looking forward to meeting everyone!',exact=True)).to_be_visible()
    composer.fill('Hello from the UI regression test')
    composer.evaluate('e => e.setSelectionRange(5,5)')
    page.get_by_role('button',name='Add emoji',exact=True).click()
    picker = page.get_by_role('dialog',name='Choose an emoji',exact=True)
    expect(picker).to_be_visible()
    picker.get_by_label('Search emojis').fill('green heart')
    picker.get_by_role('button',name='green heart',exact=True).click()
    expect(composer).to_have_value('Hello💚 from the UI regression test')
    page.get_by_role('button',name='Add emoji',exact=True).click()
    page.keyboard.press('Escape')
    expect(picker).not_to_be_visible()
    page.locator('.fm-chat-thread form').get_by_role('button',name='Send',exact=True).click()
    expect(page.locator('.fm-chat-thread').get_by_text('Hello💚 from the UI regression test',exact=True)).to_be_visible()
    assert sent[-1]['body'] == 'Hello💚 from the UI regression test'
    aisha = page.locator('.fm-message[data-author-id="aisha"]')
    mine = page.locator('.fm-message[data-author-id="me"]')
    color = lambda element: element.evaluate('e => getComputedStyle(e).getPropertyValue("--fm-author-color")')
    assert color(aisha.first) == color(aisha.last)
    assert color(aisha.first) != color(mine.first)
    aisha.first.get_by_role('button',name="Add reaction to Aisha Bello's message",exact=True).click()
    reaction_picker = page.get_by_role('dialog',name='React to message',exact=True)
    reaction_picker.get_by_role('button',name='Faces',exact=True).click()
    assert reaction_picker.locator('.fm-emoji-grid button').count() > 80
    box = reaction_picker.bounding_box()
    assert box['x'] >= 0 and box['x'] + box['width'] <= width and box['y'] >= 0 and box['y'] + box['height'] <= height
    page.screenshot(path=str(ARTIFACTS/f'emojis-{width}.png'))
    reaction_picker.get_by_label('Search emojis').fill('mosque')
    reaction_picker.get_by_role('button',name='mosque',exact=True).click()
    expect(page.locator('.fm-message').filter(has_text='Looking forward to meeting everyone!').get_by_role('button',name='🕌 1',exact=True)).to_be_visible()
    page.locator('.fm-message').filter(has_text='Looking forward to meeting everyone!').get_by_role('button',name='🕌 1',exact=True).click()
    expect(page.locator('.fm-message').filter(has_text='Looking forward to meeting everyone!').get_by_role('button',name='🕌 1',exact=True)).not_to_be_visible()
    assert reactions == [('POST','🕌'),('DELETE','🕌')]
    shell_box = page.locator('.fm-chat-shell').bounding_box()
    assert shell_box['width'] <= 1340 if width < 1500 else shell_box['width'] <= 1460
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Page overflows horizontally'
    page.screenshot(path=str(ARTIFACTS/f'chats-{width}.png'))
    page.locator('.fm-tools-menu summary').click()
    page.locator('.fm-tools-menu').get_by_role('button',name='Search',exact=True).click()
    expect(page.locator('.fm-side-panel')).to_be_visible()
    page.locator('.fm-side-panel').get_by_role('button',name='Close search panel',exact=True).click()
    thread_form = page.locator('.fm-chat-thread form')
    thread_form.get_by_role('button',name='+',exact=True).click()
    expect(thread_form.get_by_role('button',name='📎 Attach files',exact=True)).to_be_visible()
    thread_form.get_by_role('button',name='📊 Poll',exact=True).click()
    expect(page.get_by_role('dialog',name='Create a poll')).to_be_visible()
    page.get_by_role('dialog').get_by_role('button',name='×',exact=True).click()
    thread_form.get_by_role('button',name='+',exact=True).click()
    page.locator('.fm-message').filter(has_text='Looking forward to meeting everyone!').get_by_role('button',name='Reply',exact=True).click()
    expect(thread_form.get_by_text('Replying to Aisha Bello',exact=True)).to_be_visible()
    thread_form.get_by_role('button',name='×',exact=True).click()
    page.get_by_role('button',name='Notification settings',exact=True).click()
    expect(page.get_by_role('dialog',name='FestioMe notifications')).to_be_visible()
    page.get_by_role('dialog').get_by_role('button',name='Save preferences',exact=True).click()
    expect(page.get_by_role('dialog')).not_to_be_visible()
    if page.locator('.fm-notice').count(): page.locator('.fm-notice').click()
    for tab in ['People','Meetups','Profile']:
        page.locator('.fm-chat-navigation').get_by_role('button',name=re.compile(tab)).click()
        expect(page.locator('.fm-secondary-view')).to_be_visible()
        expect(page.locator('.fm-chat-thread')).not_to_be_visible()
        expect(page.locator('.fm-event-header h1')).to_have_text('NCNMO Platform 2026')
        assert page.locator('.fm-secondary-view .festiome-unified-home').evaluate('e => getComputedStyle(e).backgroundColor') == 'rgb(255, 255, 255)'
        if tab=='People':
            assert page.get_by_role('heading',name='People',exact=True).evaluate('e => getComputedStyle(e).color') == 'rgb(16, 38, 65)'
            assert page.locator('.fm-guest-people-grid article').evaluate('e => getComputedStyle(e).backgroundColor') == 'rgb(250, 252, 254)'
        if tab=='Meetups':
            page.get_by_role('button',name='Create meetup',exact=True).click()
            page.get_by_placeholder('Meetup title').fill('Convention introductions')
            page.get_by_placeholder('Location',exact=True).fill('Welcome lounge')
            page.locator('.fm-guest-meetup-form').get_by_label('Start time',exact=True).fill('2026-12-24T13:00')
            page.locator('.fm-guest-meetup-form').get_by_role('button',name='Create meetup',exact=True).click()
            expect(page.get_by_role('heading',name='Convention introductions')).to_be_visible()
        if tab=='Profile':
            page.get_by_role('button',name='Edit profile',exact=True).click()
            expect(page.get_by_role('dialog',name='Edit profile')).to_be_visible()
            page.get_by_placeholder('A line about you').fill('Profile edit regression')
            page.get_by_role('dialog').get_by_role('button',name='Save',exact=True).click()
            expect(page.get_by_role('dialog')).not_to_be_visible()
        page.screenshot(path=str(ARTIFACTS/f'{tab.lower()}-{width}.png'))
    page.locator('.fm-chat-navigation').get_by_role('button',name=re.compile('Chats')).click()
    expect(page.locator('.fm-secondary-view')).not_to_be_visible()
    if width < 700:
        expect(page.locator('.fm-chat-list')).to_be_visible()
    page.locator('.fm-chat-list').get_by_role('button',name=re.compile('Announcements')).click()
    expect(page.get_by_placeholder('Write a message…')).not_to_be_visible()
    expect(page.get_by_text('Organizer announcements. You can read updates and react to posts here.')).to_be_visible()
    page.locator('.fm-chat-navigation').get_by_role('button',name=re.compile('People')).click()
    page.locator('.fm-guest-people-grid').get_by_role('button',name='Message',exact=True).click()
    expect(page.locator('.fm-conversation-heading')).to_contain_text('Aisha Bello')
    expect(page.get_by_placeholder('Write a message…')).to_be_visible()
    expect(page.locator('.fm-chat-shell')).not_to_contain_text('session is still loading')
    assert len(exchanges) >= 2, 'Expired guest session was not refreshed'
    menu = page.locator('.fm-mobile-more' if width < 700 else '.fm-extra-nav')
    for label in ['Browse groups','Session discussions','Messages','Event updates']:
        menu.locator('summary').click()
        menu.get_by_role('button',name=label,exact=True).click()
        expect(page.locator('.fm-secondary-view')).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    assert not account_tokens, 'Guest route requested organizer authentication'
    assert not errors, errors
    expect(page.locator('.fm-notice')).not_to_contain_text('Open FestioMe from your GuestHub link')
    context.close()
    print(f'PASS {width}x{height}: theme, navigation, composer, posting, profile, announcements, DM, guest renewal')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True,args=['--no-sandbox'])
    for size in [(1680,1050),(1440,1000),(1024,900),(390,844)]: exercise(browser,*size)
    context=browser.new_context(service_workers='block')
    page=context.new_page()
    seen=[]
    page.route('**/api/auth/festiome-token',lambda route: (seen.append(route.request.url),route.fulfill(status=500,json={})))
    page.goto(BASE+'/festiome/guest')
    expect(page.get_by_text("Open FestioMe from your guest's GuestHub link to join the correct event community.",exact=True)).to_be_visible()
    assert not seen
    print('PASS direct guest URL: explicit entry guidance; no organizer fallback')
    browser.close()
