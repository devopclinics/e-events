"""Real bundled GuestHub integration, with all APIs isolated from live services."""
import copy, json, threading, time, os, tempfile
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
OUT=Path(os.environ.get('FESTIO_APP_ARTIFACTS') or tempfile.mkdtemp(prefix='festio-app-browser-'))
OUT.mkdir(parents=True,exist_ok=True)
BUILD=Path(os.environ.get('FESTIO_APP_BUILD') or Path(__file__).resolve().parents[1]/'dist')
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(BUILD),**kwargs)
    def do_GET(self):
        if not (BUILD/self.path.split('?')[0].lstrip('/')).is_file(): self.path='/index.html'
        super().do_GET()
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}'
now=datetime.now(timezone.utc)
iso=lambda d:d.isoformat()
event=dict(id='event-demo',name='NCNMO Platform 2026',guest_hub_layout='app',organization_name='NCNMO',event_date=iso(now-timedelta(hours=1)),event_end_date=iso(now+timedelta(days=4)),timezone='America/Indiana/Indianapolis',venue_name='The Westin Indianapolis',venue_address='Indianapolis, Indiana',status='active',experience_enabled=True,live_program_enabled=True,rsvp_enabled=True,rsvp_token='public-demo',engagement_enabled=True,festiome_enabled=True,festiome_addon_enabled=True,junior_guardian_handoff_enabled=False)
parent=dict(id='parent',name='Amina Idris',first_name='Amina',last_name='Idris',qr_token='demo-parent-qr',rsvp_status='confirmed',admitted=True,checked_out=False,table_name='Family table 7',seat_number='12')
child=dict(id='child',name='Sara Idris',qr_token='demo-child-qr',rsvp_status='confirmed',admitted=True,is_junior=True,status='In Junior room',status_at=iso(now),relationship='Child')
hub=dict(guest=parent,party=[parent,{k:v for k,v in child.items() if k!='qr_token'}],capabilities=dict(direct_host_messages=True,guest_chat=False,festiome=True),announcements=[dict(id='a1',title='Welcome to Platform',body='Your arrival guide and event updates are here.',created_at=iso(now))],direct_messages=[],chat_messages=[])
session=dict(step_id='session1',title='Faith, family & community',starts_at=iso(now+timedelta(minutes=42)),ends_at=iso(now+timedelta(minutes=102)),room='Main ballroom',speaker='Demo presenter',age_groups=['All attendees'],description='A conversation for the whole family.')
journey=dict(experience_enabled=True,steps=[],next_steps=[],total_count=0,completed_count=0,consent=dict(required=False,signed=False,form=None),menu_enabled=True,menu_selectable=True,menu_has_choices=False,program=dict(enabled=True,days=[dict(date=now.date().isoformat(),label='Today',segments=[session])],current_segments=[],next_segments=[session]))
feedback=dict(forms=[dict(step_id='feedback1',title='Convention feedback',submitted=False,can_edit=True,questions=[dict(id='q1',type='text',label='What worked well?',required=True)])])
state=dict(event=event,hub=hub,journey=journey,feedback=feedback,hub_status=200,preview=False)
menu_categories=[dict(id='breakfast',name='Breakfast',day_label='Day 1',selection_type='single',is_required=True,items=[dict(id='eggs',name='Eggs',description='Contains eggs'),dict(id='oats',name='Oats')]),dict(id='sides',name='Sides',day_label='Day 1',selection_type='multi',is_required=True,min_selections=1,max_selections=2,items=[dict(id='fruit',name='Fruit'),dict(id='toast',name='Toast'),dict(id='salad',name='Salad')]),dict(id='dinner',name='Dinner combination',day_label='Day 2',selection_type='combo',is_required=True,items=[],combinations=[dict(id='rice-set',name='Rice and vegetables',items=[dict(menu_item_id='rice',name='Rice',quantity=1),dict(menu_item_id='vegetables',name='Vegetables',quantity=2)],description='Vegetarian')])]
state['meal_tickets']={token:dict(status='admitted',guest=dict(id=id,meal_served=False),event=dict(menu_enabled=True,status='active'),menu_locked=False,menu_categories=copy.deepcopy(menu_categories),guest_choices={}) for token,id in [('demo-parent-qr','parent'),('demo-child-qr','child')]}
errors=[];posts=[];unexpected=[];checks=[]
def check(name,value=True):
    assert value,name
    checks.append(name)
def intercept(route):
    u=urlparse(route.request.url); p=u.path
    if not route.request.url.startswith(BASE): return route.abort()
    if not p.startswith('/api/') and not p.endswith('service-worker.js') and not p.endswith('guesthub-sw.js'): return route.continue_()
    if p.endswith('.js'):return route.fulfill(status=404,body='')
    data={}; status=200
    if route.request.method=='POST':
        posts.append(dict(path=p,body=route.request.post_data_json))
        if p.endswith('/menu'):
            if state.get('meal_failure'):return route.fulfill(status=400,content_type='application/json',body=json.dumps({'detail':'Your meal has been served — selection is locked'}))
            token=p.split('/')[-2];state['meal_tickets'][token]['guest_choices']=route.request.post_data_json
        if '/forms/' in p and p.endswith('/submit'):
            if state.get('form_failure'): return route.fulfill(status=503,content_type='application/json',body=json.dumps({'detail':'Not submitted. Please reconnect and try again.'}))
            state['forms'][0]['status']='complete';state['forms'][0]['receipt_id']='receipt1';state['forms'][0]['can_submit']=False
            return route.fulfill(content_type='application/json',body=json.dumps({'receipt_id':'receipt1','status':'complete'}))
        if '/consent/sign' in p: state['journey']['consent']['signed']=True
        elif '/messages/direct' in p:state['hub']['direct_messages'].append(dict(id='m1',sender_type='guest',body=route.request.post_data_json['body']))
        elif '/feedback' in p:state['feedback']['forms'][0]['submitted']=True
        data={'ok':True}
    elif p.endswith('/ticket') and state.get('meal_load_failure'):status=503;data=dict(detail='Temporarily unavailable')
    elif p.endswith('/ticket') and p.startswith('/api/scan/'):data=state['meal_tickets'].get(p.split('/')[-2],dict(status='invalid'))
    elif p.endswith('/consent'):data=dict(required=False)
    elif '/form-receipts/' in p:data=dict(id='receipt1',form=state['forms'][0],guest_name='Sara Idris',signer_name='Amina Idris',relationship='parent',answers={'contact':'555-0100'},signature_text='Amina Idris',signed_at='2026-10-06T12:00:00')
    elif p.endswith('/forms/me'):data=dict(forms=state.get('forms',[]))
    elif p.endswith('/app-party'):data=dict(viewer_id='parent',members=[{**state['hub']['guest'],'status':'Checked in','status_at':iso(now)},child],as_of=iso(now))
    elif p.startswith('/api/invite/token/'):data=dict(event=state['event'],guest=state['hub']['guest'],already_responded=True,deadline_passed=False,pending_guardian_confirmations=[])
    elif p.endswith('/guest-hub'):
        status=state['hub_status'];data=state['hub'] if status==200 else dict(detail='GuestHub is disabled')
    elif p.endswith('/public-theme'):data=dict(colors=dict(primary='#124b3c',accent='#d6b45e'),wording={},hub_layout={})
    elif p.endswith('/experience/me'):data=state['journey']
    elif p.endswith('/experience/me/feedback'):data=state['feedback']
    elif '/guest-content/' in p:data=dict(materials=[dict(id='mat',title='Arrival guide',kind='pdf',source_url='/media/demo.pdf')],certificates=[])
    elif p.endswith('/qr.png'):return route.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="white"/><text x="25" y="100" fill="black">TEST QR FIXTURE</text></svg>')
    elif '/push/config' in p:data=dict(enabled=False)
    elif '/live/' in p or '/engagement/' in p:status=403;data=dict(detail='Fixture has no Live session')
    else:unexpected.append(p)
    route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
with sync_playwright() as pw:
    engine=os.environ.get('FESTIO_APP_BROWSER','chromium')
    options={'headless':True}
    if engine!='webkit': options['args']=['--no-sandbox']
    if engine=='edge': options['executable_path']=os.environ['FESTIO_EDGE_EXECUTABLE']
    browser=(pw.webkit if engine=='webkit' else pw.chromium).launch(**options)
    context=browser.new_context(viewport=dict(width=1440,height=1050),service_workers='block')
    context.route('**/*',intercept)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    def load(hash='#/home',query=''):
        page.goto(BASE+'/r/demo-token'+(query+'&' if query else '?')+'case='+str(time.time_ns())+hash);page.locator('.fh-event-app .greeting').wait_for() if hash=='#/home' and state['hub_status']==200 else page.locator('.fh-event-app').wait_for()
        page.wait_for_timeout(350)
    def go(screen):
        page.locator(f'.fh-event-app nav:visible button[data-go="{screen}"]').first.click();page.wait_for_timeout(120)
    load();check('real app shell renders',page.locator('.greeting').inner_text().find('Amina')>=0)
    check('three prominent services',page.locator('.service-nav a').count()==3)
    check('theme matches Design Studio',page.locator('.fh-event-app').evaluate('(e)=>getComputedStyle(e).getPropertyValue("--green")').strip()=='#124b3c')
    page.screenshot(path=str(OUT/'desktop-home.png'),full_page=True)
    go('pass');page.get_by_role('link',name='Meals',exact=True).click()
    page.get_by_role('heading',name='Meals for Amina Idris').wait_for();page.get_by_role('radio',name='Eggs').wait_for()
    check('meals stay inside GuestHub',page.url.endswith('#/meals?member=parent') and page.locator('.fh-event-app').count()==1 and len(context.pages)==1)
    check('required meals prevent incomplete save',page.get_by_role('button',name='Save Selection',exact=True).is_disabled())
    check('items without descriptions have no empty details action',page.get_by_role('button',name='View details for Oats',exact=True).count()==0)
    page.get_by_role('radio',name='Eggs').check();page.locator('.vm-categories').get_by_role('button',name='Sides',exact=True).click();page.get_by_role('checkbox',name='Fruit').check()
    page.get_by_role('button',name='Day 2',exact=True).click();check('combination card shows every included item alongside description', '2 × Vegetables' in page.locator('.vm-dish').filter(has_text='Rice and vegetables').inner_text() and 'Vegetarian' in page.locator('.vm-dish').filter(has_text='Rice and vegetables').inner_text());check('combination components are not separate choices',page.locator('.vm-grid input').count()==1);page.get_by_role('radio',name='Rice and vegetables').check()
    page.get_by_role('button',name='Save Selection',exact=True).click();page.get_by_text('Meal selection saved.',exact=False).wait_for()
    page.get_by_role('button',name='View details for Rice and vegetables',exact=True).click();page.locator('.vm-dialog[open]').wait_for();check('menu details include real combination quantities','2 × Vegetables' in page.locator('.vm-dialog').inner_text());page.keyboard.press('Escape');check('Escape closes menu details',page.locator('.vm-dialog[open]').count()==0)
    page.get_by_role('button',name='My selections',exact=False).click();check('selection summary retains combination contents', '2 × Vegetables' in page.locator('.vm-main .vm-includes').inner_text());check('selections show saved menu','Rice and vegetables' in page.locator('.vm-main').inner_text() and '✓ Saved' in page.locator('.vm-main').inner_text())
    page.get_by_role('button',name='Explore the menu',exact=True).click()
    check('saved meals retain single multi and combination choices',state['meal_tickets']['demo-parent-qr']['guest_choices']==dict(single={'breakfast':'eggs'},multi={'sides':['fruit']},combo={'dinner':'rice-set'}))
    check('saved status and update action shown',page.get_by_text('Selected',exact=True).count()==1 and page.get_by_role('button',name='Update Selection',exact=True).count()==1)
    page.screenshot(path=str(OUT/'desktop-meals.png'),full_page=True)
    page.get_by_role('button',name='Back to GuestHub',exact=False).click();check('meal back returns to previous pass', '#/pass' in page.url)
    page.go_forward();page.get_by_role('button',name='Update Selection',exact=True).wait_for();page.get_by_role('radio',name='Eggs').wait_for();check('saved meals survive navigation',page.get_by_role('radio',name='Eggs').is_checked())
    page.locator('#meal-member').select_option('child');page.get_by_role('heading',name='Meals for Sara Idris').wait_for();page.get_by_role('radio',name='Eggs').wait_for()
    check('party member has separate meal choices',not page.get_by_role('radio',name='Eggs').is_checked())
    page.get_by_role('radio',name='Oats').check();page.locator('.vm-categories').get_by_role('button',name='Sides',exact=True).click();page.get_by_role('checkbox',name='Fruit').check();page.get_by_role('checkbox',name='Toast').check();check('multi-choice maximum prevents excess selection',page.get_by_role('checkbox',name='Salad',exact=True).is_disabled());page.get_by_role('checkbox',name='Toast').uncheck()
    page.get_by_role('button',name='Day 2',exact=True).click();page.get_by_role('button',name='View details for Rice and vegetables',exact=True).click();page.get_by_role('button',name='Choose this combination',exact=True).click();check('choose from menu details selects combination',page.get_by_role('radio',name='Rice and vegetables').is_checked())
    state['meal_failure']=True;page.get_by_role('button',name='Save Selection',exact=True).click();page.get_by_role('alert').filter(has_text='selection is locked').wait_for();check('save rejection preserves choices without success',page.get_by_text('Meal selection saved.',exact=False).count()==0 and page.get_by_role('radio',name='Rice and vegetables').is_checked())
    state['meal_failure']=False;page.get_by_role('button',name='Save Selection',exact=True).click();page.get_by_text('Meal selection saved.',exact=False).wait_for();check('authorized child saves to own pass',state['meal_tickets']['demo-child-qr']['guest_choices']['single']['breakfast']=='oats')
    page.set_viewport_size(dict(width=390,height=844));page.screenshot(path=str(OUT/'phone-meals.png'),full_page=True);check('meals fit phone',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    state['meal_tickets']['demo-child-qr']['guest']['meal_served']=True;page.get_by_role('button',name='Refresh meal status').click();page.get_by_role('heading',name='Meal collected',exact=True).wait_for();check('collected meals cannot be edited',page.locator('.app-meals button[type=submit]').count()==0)
    state['meal_tickets']['demo-child-qr']['guest']['meal_served']=False;state['meal_tickets']['demo-child-qr']['menu_locked']=True;page.get_by_role('button',name='Refresh meal status').click();page.get_by_role('heading',name='Meal selection unlocks at check-in').wait_for();check('check-in gate retained')
    state['meal_tickets']['demo-child-qr']['menu_locked']=False
    display_combo=copy.deepcopy(menu_categories[-1]);display_combo['display_only']=True;display_combo['items']=[dict(id='rice',name='Rice'),dict(id='vegetables',name='Vegetables')]
    state['meal_tickets']['demo-child-qr']['menu_categories']=[display_combo]
    page.get_by_role('button',name='Refresh meal status').click();page.locator('.vm-dish').wait_for();check('display-only menu preserves the complete combination',page.locator('.vm-dish').count()==1 and 'Rice and vegetables' in page.locator('.vm-dish').inner_text() and '2 × Vegetables' in page.locator('.vm-dish').inner_text());check('display-only combination has no selection controls',page.locator('.vm-grid input').count()==0 and page.locator('.vm-save-form').count()==0)
    state['meal_tickets']['demo-child-qr']['menu_categories']=copy.deepcopy(menu_categories)
    page.set_viewport_size(dict(width=1440,height=1050));go('pass');page.locator('#app-member').select_option('child');page.get_by_role('link',name='Meals',exact=True).click();page.locator('#meal-member').wait_for();check('meal entry preserves selected party member',page.locator('#meal-member').input_value()=='child')
    page.goto(BASE+'/r/demo-token#/meals?member=untrusted');page.get_by_role('heading',name='Meals for Amina Idris').wait_for();check('untrusted member cannot choose arbitrary pass',page.locator('#meal-member').input_value()=='parent')
    state['meal_load_failure']=True;page.get_by_role('button',name='Refresh meal status').click();page.get_by_role('button',name='Retry meals',exact=True).wait_for();check('meal read failure offers retry')
    state['meal_load_failure']=False;page.get_by_role('button',name='Retry meals',exact=True).click();page.get_by_role('button',name='Update Selection',exact=True).wait_for()
    page.evaluate('window.dispatchEvent(new Event("offline"))')
    # Browser offline state is authoritative; emulate it with Playwright.
    context.set_offline(True);page.wait_for_timeout(150);check('offline selections cannot be submitted',page.get_by_role('button',name='Update Selection',exact=True).is_disabled());context.set_offline(False);page.wait_for_timeout(150)
    page.goto(BASE+'/scan/demo-parent-qr#orders');page.get_by_role('button',name='Update Selection',exact=True).wait_for();check('standalone pass retains meal selector',page.get_by_role('radio',name='Eggs').is_checked());page.get_by_role('radio',name='Oats').check();page.get_by_role('button',name='Update Selection',exact=True).click();page.get_by_text('Selection updated!',exact=False).wait_for();check('standalone meal selection still saves',state['meal_tickets']['demo-parent-qr']['guest_choices']['single']['breakfast']=='oats')
    page.goto(BASE+'/r/demo-token#/home');page.locator('.greeting').wait_for()
    check('viewing and selecting meals never performs admission',not any(x['path'] in ['/api/scan/demo-parent-qr','/api/scan/demo-child-qr'] for x in posts))
    go('programme');page.get_by_role('button',name='Faith, family').click();page.locator('dialog[open]').wait_for()
    page.go_back();check('Back closes session',page.locator('dialog[open]').count()==0)
    page.go_forward();page.locator('dialog[open]').wait_for();check('Forward restores session')
    page.get_by_role('button',name='Close session').click();go('pass');page.locator('#app-member').select_option('child')
    page.get_by_text('At pickup, show your own pass.',exact=True).wait_for();check('junior pickup guidance')
    page.get_by_role('button',name='Switch to my pass').click();check('one tap guardian pass',page.locator('#app-member').input_value()=='parent')
    check('assigned seating retained on pass','Family table 7' in page.locator('main').inner_text());check('full pass utilities remain accessible',page.get_by_role('link',name='Open full pass & options').get_attribute('href')=='/scan/demo-parent-qr')
    go('more');check('services not buried in More',all(t not in page.locator('main').inner_text() for t in ['Live Activities','FestioMe','Meals']))
    page.get_by_role('button',name='My party Family').click();check('recorded child status','In Junior room' in page.locator('main').inner_text())
    page.get_by_role('button',name='Event essentials').click();page.get_by_role('button',name='Help & FAQ').click()
    page.get_by_placeholder('Ask the host a question...').fill('Where is the registration desk?');page.locator('main').get_by_role('button',name='Send',exact=True).click()
    page.get_by_text('Where is the registration desk?',exact=True).wait_for();check('original message handler submits',any('/messages/direct' in p['path'] for p in posts))
    go('more');page.get_by_role('button',name='Feedback Share').click();page.locator('main textarea, main input').first.fill('Clear directions');page.get_by_role('button',name='Submit feedback').click();page.get_by_text('Thank you—your feedback has been recorded.').wait_for();check('existing feedback submits')
    state['journey']['consent']=dict(required=True,signed=False,form=dict(id='consent1',title='Youth consent',body='Demo consent text',version=1))
    load();page.get_by_role('button',name='Review next steps').click();page.get_by_placeholder('Type your full name to sign Youth consent').fill('Amina Idris');page.get_by_role('button',name='Sign & agree').click();page.get_by_text('Signed ✓',exact=True).wait_for();check('original consent handler submits')
    # Real bundled UI, isolated API fixtures: no live signatures or messages.
    state['forms']=[dict(id='f1',revision_id='r1',version=1,title='Junior Platform participation',body='Draft demonstration terms.',guest_id='child',guest_name='Sara Idris',on_behalf=True,status='pending',required=True,timing='before_arrival',can_submit=True,kind='consent',questions=[dict(key='contact',label='Contact telephone',type='text',required=True)])]
    load();page.get_by_role('button',name='Review next steps').click();page.locator('.event-forms summary').click()
    page.get_by_label('Contact telephone').fill('555-0100');page.get_by_label('Your full name',exact=True).fill('Amina Idris')
    page.get_by_label('I am the authorized parent').check();page.get_by_label('I have read this form').check()
    state['form_failure']=True;page.get_by_role('button',name='Sign and submit',exact=True).click();page.get_by_role('alert').filter(has_text='Not submitted').wait_for()
    check('failed submission retains entries',page.get_by_label('Your full name',exact=True).input_value()=='Amina Idris' and not page.get_by_role('heading',name='Submission received').count())
    state['form_failure']=False;page.get_by_role('button',name='Sign and submit',exact=True).click();page.get_by_role('heading',name='Submission received').wait_for()
    check('guardian submission and original receipt visible','Sara Idris' in page.locator('.form-receipt').inner_text() and 'Invalid Date' not in page.locator('.form-receipt').inner_text())
    check('receipt can print',page.get_by_role('button',name='Print / save a copy').count()==1)
    page.screenshot(path=str(OUT/'guardian-form-receipt.png'),full_page=True)
    page.get_by_role('button',name='Close receipt').click();page.get_by_role('button',name='View signed / submitted copy').click();page.get_by_role('heading',name='Submission received').wait_for();check('completed receipt reopens')
    state['forms']=[];load()
    page.evaluate("""()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{window.installInvoked=true};e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e)}""")
    page.get_by_role('button',name='Install Festio',exact=True).click();check('install follows user click',page.evaluate('window.installInvoked===true'))
    page.evaluate("window.dispatchEvent(new Event('appinstalled'))");check('installed app hides install prompt',page.get_by_role('complementary',name='Install event app').count()==0)
    page.evaluate("localStorage.removeItem('festio:app-install-dismissed')");load();page.get_by_role('button',name='Not now',exact=True).click();load();check('install dismissal survives reload',page.get_by_role('button',name='Not now',exact=True).count()==0)
    context.set_default_timeout(8000)
    page.set_viewport_size(dict(width=390,height=844));load();page.screenshot(path=str(OUT/'phone-home.png'),full_page=True)
    metrics=page.evaluate('''()=>{const root=document.querySelector('.fh-event-app');const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';return {overflow:document.documentElement.scrollWidth>innerWidth,smallText:[...root.querySelectorAll('*')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>e.textContent),smallTargets:[...root.querySelectorAll('button,a')].filter(e=>visible(e)&&(e.getBoundingClientRect().height<44||e.getBoundingClientRect().width<44)).map(e=>e.textContent),header:root.querySelector('.topbar').getBoundingClientRect().height,bottom:root.querySelector('.bottom-nav').getBoundingClientRect().height}}''')
    print(json.dumps(metrics),flush=True)
    check('phone has no horizontal overflow',not metrics['overflow']);check('phone text minimum 12px',not metrics['smallText']);check('phone targets minimum 44px',not metrics['smallTargets'])
    page.evaluate('window.scrollTo(0,500)');check('services scroll away',page.locator('.service-nav').bounding_box()['y']<0)
    for screen in ['programme','pass','inbox','more']:
        go(screen);check('phone '+screen+' fits',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        page.screenshot(path=str(OUT/f'phone-{screen}.png'),full_page=True)
    page.reload();page.get_by_role('heading',name='Your event essentials').wait_for();check('route survives reload')
    load('#/programme?session=session1');page.locator('dialog[open]').wait_for();page.get_by_role('button',name='Close session').click();check('direct session link closes to programme',page.url.endswith('#/programme'))
    state['hub_status']=403;load();page.get_by_role('button',name='Try again',exact=True).wait_for();check('disabled hub shows recovery instead of blank');state['hub_status']=200
    state['event']['engagement_enabled']=False;state['event']['festiome_enabled']=False;state['journey']['menu_enabled']=False;state['journey']['menu_selectable']=False
    load();check('disabled services are hidden',page.locator('.service-nav').count()==0)
    state['hub']['guest']['admitted']=False
    state['journey']['consent']['signed']=False
    load();check('before arrival does not request native consent',page.locator('.hero').inner_text().find('Review next steps')<0)
    page.goto(BASE+'/r/demo-token?case='+str(time.time_ns())+'#/experience');page.get_by_text('Check in with event staff before signing.').wait_for();check('native consent remains admission gated',page.get_by_role('button',name='Sign & agree').count()==0)
    state['hub']['guest']['admitted']=True
    state['event']['event_end_date']=iso(now-timedelta(minutes=1))
    load();check('closing state takes priority over stale actions','Thank you for attending' in page.locator('.hero').inner_text())
    state['event']['event_end_date']=iso(now+timedelta(days=4))
    state['journey']['consent']['required']=False
    load(query='?studio-preview=1');go('pass');check('preview QR stays non-live',page.locator('.app-pass-qr').get_attribute('src').startswith('data:'));check('preview clearly marked','PREVIEW ONLY' in page.locator('main').inner_text())
    for layout in ['classic' ,'companion','journey','complete']:
        state['event']['guest_hub_layout']=layout;page.goto(BASE+'/r/demo-token?layout='+layout+'#guest-hub');page.wait_for_timeout(650)
        check(layout+' original layout retained',page.locator('.fh-event-app').count()==0 and 'Amina' in page.locator('body').inner_text())
    # Personal timetable must work on every layout, using the same API data.
    state['hub']['guest']['admitted']=False
    own={**session,'step_id':'adult-session','title':'Adult learning circle','state':'upcoming','audience_guest_ids':['parent']}
    junior={**session,'step_id':'junior-session','title':'Junior discovery hour','starts_at':iso(now+timedelta(minutes=10)),'state':'upcoming','audience_guest_ids':['child']}
    shared={**session,'step_id':'shared-session','title':'Community gathering','state':'upcoming','audience_guest_ids':['parent','child']}
    state['journey']['program'].update(viewer_id='parent',audiences=[dict(guest_id='parent',name='Amina Idris',age_group='Adults',is_self=True),dict(guest_id='child',name='Sara Idris',age_group='Juniors',is_self=False)],days=[dict(date=now.date().isoformat(),label='Today',segments=[junior,own,shared])],current_segments=[],next_segments=[junior,own,shared])
    for layout in ['app','classic','companion','journey','complete']:
        state['event']['guest_hub_layout']=layout
        page.goto(BASE+'/r/demo-token?audience='+layout+('#/home' if layout=='app' else '#guest-hub'))
        page.wait_for_timeout(700)
        if layout=='app':
            check('Home next excludes other age groups','Junior discovery hour' not in page.locator('main').inner_text())
            go('programme')
        elif layout in ['journey','complete']:
            page.get_by_role('button',name='View Full Programme').first.click()
        elif layout=='classic':
            page.get_by_role('tab',name='Program').first.click()
        select=page.get_by_role('combobox',name='Show programme for').first
        select.wait_for()
        def shown(text): return text in page.locator('body').inner_text()
        check(layout+' defaults to own and shared',shown('Adult learning circle') and shown('Community gathering') and not shown('Junior discovery hour'))
        select.select_option('child');check(layout+' child programme',shown('Junior discovery hour') and shown('Community gathering') and not shown('Adult learning circle'))
        select.select_option('all');check(layout+' all programmes',shown('Junior discovery hour') and shown('Adult learning circle'))
        check(layout+' audience selector fits phone',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        if layout=='app':page.screenshot(path=str(OUT/'phone-programme-audiences.png'),full_page=True)
    check('no browser runtime errors',not errors)
    (OUT/'validation.json').write_text(json.dumps(dict(browser=engine,browser_version=browser.version,checks=checks,phone_metrics=metrics,errors=errors,isolated_post_paths=[p['path'] for p in posts],unmatched_fixture_requests=sorted(set(unexpected)),limitations=['Automated browser engine and viewport testing; no physical-device or branded Apple Safari testing','All API responses isolated fixtures; no staging or production mutations','Offline credential persistence remains disabled']),indent=2))
    print(json.dumps(dict(passed=len(checks),metrics=metrics,errors=errors,unexpected=sorted(set(unexpected))),indent=2))
    browser.close()
server.shutdown()
