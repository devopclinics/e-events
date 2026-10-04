"""Exercise production UI code against the disposable real HTTP API fixture.

FestioMe requests use the actual service and SQLite persistence. Only GuestHub
content and unavailable realtime transport are fixtures. No live guest writes.
Run the fixture first, then E2E_BASE_URL=http://127.0.0.1:4000 python3 this_file.py.
"""
import json, os, re, time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('E2E_BASE_URL', 'http://127.0.0.1:4000')
API = os.environ.get('E2E_API_URL', 'http://127.0.0.1:9186')
FIXTURE = Path(os.environ.get('E2E_FIXTURE_DIR', '/tmp/festiome-real-api-20261004-v2'))
DATA = json.loads((FIXTURE/'context.json').read_text())
ARTIFACTS = Path(os.environ.get('E2E_ARTIFACTS', '/tmp/festiome-actions-evidence'))
ARTIFACTS.mkdir(parents=True, exist_ok=True)

def open_guest(browser, person, width):
    context = browser.new_context(service_workers='block', viewport={'width':width,'height':950}, timezone_id='America/Chicago')
    context.add_init_script('sessionStorage.setItem("festiomeGuestSession", '+json.dumps(json.dumps(dict(
        token=DATA['guests'][person], expiresAt=int(time.time()*1000)+86400000,
        kind='guest',eventId=DATA['event_id'],passToken='isolated-pass-'+person)))+');')
    page = context.new_page()
    errors, writes = [], []
    page.on('pageerror',lambda error: errors.append(str(error)))
    fail_meetups = [False]
    def route_request(route):
        request = route.request
        parsed = urlsplit(request.url)
        if '/api/festiome/v1/' in parsed.path:
            path = parsed.path.split('/api/festiome',1)[1]
            if path.endswith('/realtime-ticket'):
                route.fulfill(status=503,json={'detail':'Isolated test uses polling'}); return
            if fail_meetups[0] and path.endswith('/meetups') and request.method=='GET':
                fail_meetups[0]=False
                route.fulfill(status=503,json={'detail':'Validation outage: please retry'}); return
            if request.method not in ('GET','HEAD'): writes.append((request.method,path,request.post_data))
            response=route.fetch(url=API+path+('?' + parsed.query if parsed.query else ''))
            route.fulfill(response=response); return
        if parsed.path.endswith('/guest-hub'):
            route.fulfill(json=dict(event=dict(id=DATA['event_id'],name='FestioMe UI Validation'),guest=dict(name=person.title()),capabilities={},
                announcements=[dict(id='validation-update',title='Validation event update',body='The welcome lounge is open.',created_at='2026-10-04T12:00:00Z')],
                direct_messages=[dict(id='host-message',sender_type='organizer',body='Ask the host from GuestHub.',created_at='2026-10-04T12:00:00Z')])); return
        if parsed.path.endswith('/experience/me'):
            route.fulfill(json=dict(program=dict(days=[dict(segments=[])]))); return
        if parsed.path.endswith('/public-theme'):
            route.fulfill(json=dict(hub_style='forest-editorial')); return
        if '/api/auth/festiome-token' in parsed.path:
            errors.append('Guest requested organizer authentication')
        route.fulfill(json={})
    page.route('**/api/**',route_request)
    page.goto(BASE+'/festiome/guest')
    expect(page.locator('.fm-event-header h1')).to_have_text('FestioMe UI Validation')
    return context,page,errors,writes,fail_meetups

def nav(page, label):
    page.locator('.fm-chat-navigation').get_by_role('button',name=re.compile(r'^.*'+re.escape(label)+r'$')).click()

def group_card(page,name): return page.locator('.fm-group-list article').filter(has=page.get_by_role('heading',name=name,exact=True))
def meetup_card(page,name): return page.locator('.fm-guest-meetup-list article').filter(has=page.get_by_role('heading',name=name,exact=True))

def primary(page):
    nav(page,'Groups')
    group_card(page,'FestioMe UI Validation').get_by_role('button',name='Open group',exact=True).click()
    nav(page,'Chats')
    page.locator('.fm-chat-list').get_by_role('button',name=re.compile('General')).click()
    expect(page.locator('.fm-conversation-heading')).to_contain_text('General')

def menu(page, label):
    summary=page.locator('.fm-tools-menu summary')
    summary.click()
    page.locator('.fm-tools-menu').get_by_role('button',name=label,exact=True).click()

def more(page,label,width):
    region=page.locator('.fm-mobile-more' if width<700 else '.fm-extra-nav')
    region.locator('summary').click()
    region.get_by_role('button',name=label,exact=True).click()

def api_get(page,path,person='alice'):
    result=page.request.get(API+path,headers={'Authorization':'Bearer '+DATA['guests'][person]})
    assert result.ok, result.text()
    return result.json()

def exercise(browser,width):
    context,page,errors,writes,fail_meetups=open_guest(browser,'alice',width)
    suffix=f'{width}-{int(time.time())}'
    name='Validation group '+suffix
    title='Welcome meetup '+suffix
    primary(page)
    menu(page,'← Chats')
    expect(page.locator('.fm-chat-list')).to_be_visible()
    page.get_by_role('button',name='Start a conversation',exact=True).click()
    dialog=page.get_by_role('dialog',name='Start a conversation')
    dialog.get_by_role('button',name='Meetups · Plan a gathering',exact=True).click()
    expect(page.get_by_role('heading',name='Meetups',exact=True)).to_be_visible()
    primary(page)
    if width<700:
        expect(page.get_by_placeholder('Write a message…')).to_be_visible()
    # Every secondary menu opens useful, readable content and performs an action.
    menu(page,'Search')
    panel=page.get_by_role('complementary',name='search panel')
    panel.get_by_placeholder('Search FestioMe').fill('Welcome')
    panel.get_by_role('button',name='Search messages',exact=True).click()
    panel.get_by_role('button').filter(has_text='Welcome to our validation community').click()
    expect(page.locator('.fm-chat-thread').get_by_text('Welcome to our validation community',exact=True)).to_be_visible()
    menu(page,'🏆 Leaderboard')
    panel=page.get_by_role('complementary',name='leaderboard panel')
    expect(panel.get_by_text('Bob',exact=True)).to_be_visible()
    assert panel.get_by_text('Bob',exact=True).evaluate('e=>getComputedStyle(e).color')!='rgb(255, 255, 255)'
    panel.get_by_role('button',name='Close leaderboard panel').click()
    menu(page,'🤝 Suggested')
    panel=page.get_by_role('complementary',name='matches panel')
    expect(panel.get_by_text('community',exact=True)).to_be_visible()
    panel.get_by_role('button',name='Message',exact=True).click()
    expect(page.locator('.fm-conversation-heading')).to_contain_text('Bob')
    primary(page)
    menu(page,'People')
    panel=page.get_by_role('complementary',name='people panel')
    expect(panel.get_by_text('Charlie',exact=True)).to_be_visible()
    panel.get_by_role('button',name='Close people panel').click()
    menu(page,'FestioMe settings')
    dialog=page.get_by_role('dialog',name='FestioMe notifications')
    expect(dialog.get_by_role('button',name='Save preferences')).to_be_enabled()
    dialog.get_by_label('In-app notifications',exact=True).set_checked(False)
    dialog.get_by_role('button',name='Save preferences').click()
    expect(dialog).not_to_be_visible()
    prefs=api_get(page,'/v1/notification-preferences?group_id='+DATA['group_id'])
    assert prefs['in_app'] is False
    menu(page,'Discover')
    panel=page.get_by_role('complementary',name='discover panel')
    card=panel.locator('div.rounded-xl').filter(has_text='Public networking')
    expect(card).to_be_visible()
    if card.get_by_role('button',name='Join',exact=True).count():
        card.get_by_role('button',name='Join',exact=True).click()
    else: card.get_by_role('button',name='Open',exact=True).click()
    expect(panel).not_to_be_visible()
    assert any(g['name']=='Public networking' for g in api_get(page,'/v1/groups'))
    primary(page)
    more(page,'Session discussions',width)
    expect(page.get_by_role('heading',name='Session Discussions',exact=True)).to_be_visible()
    page.get_by_role('button',name='Open discussion',exact=True).click()
    expect(page.locator('.fm-conversation-heading')).to_contain_text('Session Discussions')
    more(page,'Messages',width)
    expect(page.get_by_text('Ask the host from GuestHub.',exact=True)).to_be_visible()
    page.locator('.fm-secondary-view').get_by_role('button').filter(has_text='FestioMe direct message').first.click()
    expect(page.locator('.fm-conversation-heading')).to_contain_text('Bob')
    more(page,'Event updates',width)
    expect(page.get_by_role('heading',name='Validation event update',exact=True)).to_be_visible()
    more(page,'Browse groups',width)
    page.get_by_role('button',name='New group',exact=True).click()
    dialog=page.get_by_role('dialog',name='Create an invite-only group')
    dialog.get_by_label('Group name',exact=True).fill(name)
    dialog.get_by_label('Description (optional)',exact=True).fill('Disposable browser validation group')
    dialog.get_by_label('Bob',exact=True).check()
    dialog.get_by_role('button',name='Create group',exact=True).click()
    expect(dialog).not_to_be_visible()
    expect(page.get_by_placeholder('Write a message…')).to_be_visible()
    groups=api_get(page,'/v1/groups')
    created=next(g for g in groups if g['name']==name)
    assert created['viewer_role']=='owner' and created['visibility']=='unlisted' and created['member_count']==2
    assert any(g['id']==created['id'] for g in api_get(page,'/v1/groups','bob'))
    assert not any(g['id']==created['id'] for g in api_get(page,'/v1/groups','charlie'))
    page.reload()
    nav(page,'Groups')
    expect(group_card(page,name)).to_be_visible()
    group_card(page,name).get_by_role('button',name='View meetups',exact=True).click()
    expect(page.get_by_role('heading',name='Meetups',exact=True)).to_be_visible()
    page.get_by_role('button',name='Create meetup',exact=True).click()
    form=page.locator('.fm-guest-meetup-form')
    form.get_by_label('Meetup title',exact=True).fill(title)
    form.get_by_label('Location',exact=True).fill('Welcome lounge')
    form.get_by_label('Start time',exact=True).fill('2099-12-24T13:00')
    form.get_by_label('End time (optional)',exact=True).fill('2099-12-24T14:00')
    form.get_by_label('Capacity (optional)',exact=True).fill('2')
    form.get_by_label('Description',exact=True).fill('A real persisted meetup in an isolated test database.')
    form.get_by_role('button',name='Create meetup',exact=True).click()
    card=meetup_card(page,title)
    expect(card).to_be_visible()
    saved=next(m for m in api_get(page,f"/v1/groups/{created['id']}/meetups?include_past=true") if m['title']==title)
    assert saved['starts_at'].startswith('2099-12-24T19:00:00') and saved['starts_at'].endswith(('Z','+00:00'))
    card.get_by_role('button',name='Edit meetup',exact=True).click()
    expect(form.get_by_label('Start time',exact=True)).to_have_value('2099-12-24T13:00')
    form.get_by_label('Location',exact=True).fill('Main lobby')
    form.get_by_role('button',name='Save meetup',exact=True).click()
    expect(card).to_contain_text('Main lobby')
    page.reload(); nav(page,'Groups')
    group_card(page,name).get_by_role('button',name='View meetups',exact=True).click()
    expect(meetup_card(page,title)).to_contain_text('Main lobby')
    # A second guest opens the group and changes a persistent RSVP from the UI.
    bob_context,bob,bob_errors,_,_=open_guest(browser,'bob',width)
    nav(bob,'Groups')
    group_card(bob,name).get_by_role('button',name='View meetups',exact=True).click()
    bob_card=meetup_card(bob,title)
    expect(bob_card).to_be_visible()
    expect(bob_card.get_by_role('button',name='Edit meetup',exact=True)).not_to_be_visible()
    for status,label in [('going','Going'),('interested','Interested'),('declined',"Can't go"),('going','Going')]:
        bob_card.get_by_role('button',name=re.compile('^'+re.escape(label))).click()
        expect(bob_card.get_by_role('button',name=re.compile('^'+re.escape(label)))).to_have_attribute('aria-pressed','true')
        assert api_get(bob,f"/v1/groups/{created['id']}/meetups?include_past=true",'bob')[0]['my_status']==status
    bob.reload();nav(bob,'Groups');group_card(bob,name).get_by_role('button',name='View meetups',exact=True).click()
    expect(meetup_card(bob,title).get_by_role('button',name='Going ✓',exact=True)).to_have_attribute('aria-pressed','true')
    # Inject one transport outage to prove the view retries rather than claiming no meetups.
    fail_meetups[0]=True
    page.get_by_role('button',name='Refresh meetups',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('temporarily unavailable')
    page.get_by_role('button',name='Try again',exact=True).click()
    expect(page.get_by_role('alert')).not_to_be_visible()
    page.screenshot(path=str(ARTIFACTS/f'meetups-{width}.png'))
    meetup_card(page,title).get_by_role('button',name='Cancel meetup',exact=True).click()
    page.get_by_role('button',name='Confirm cancellation',exact=True).click()
    page.get_by_role('button',name='Past & cancelled',exact=True).click()
    expect(meetup_card(page,title)).to_contain_text('Cancelled')
    assert api_get(page,f"/v1/groups/{created['id']}/meetups?include_past=true")[0]['status']=='cancelled'
    nav(page,'Groups'); page.screenshot(path=str(ARTIFACTS/f'groups-{width}.png'))
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow'
    assert not errors+bob_errors,errors+bob_errors
    assert any('/group-chats' in p for _,p,_ in writes)
    assert any('/meetups' in p for _,p,_ in writes)
    primary(page)
    page.locator('.fm-tools-menu summary').click()
    page.locator('.fm-tools-menu').get_by_role('link',name='FestioHub',exact=True).click()
    expect(page).to_have_url(BASE+'/r/isolated-pass-alice#guest-hub')
    bob_context.close();context.close()
    print(f'PASS {width}: real group creation, invite privacy, reloads, discovery join, menus, search, DM, settings, session discussion, event updates, meetup create/edit/RSVP/cancel/retry/timezone',flush=True)

if __name__=='__main__':
    with sync_playwright() as runner:
        browser=runner.chromium.launch(headless=True,args=['--no-sandbox'])
        for width in (1440,390): exercise(browser,width)
        browser.close()
