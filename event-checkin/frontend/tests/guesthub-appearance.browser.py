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
BASE=os.environ.get('FESTIO_REMOTE_BASE') or f'http://127.0.0.1:{server.server_port}'
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
    elif p.endswith('/public-theme'):data=dict(colors=dict(primary='#124b3c',accent='#d6b45e'),wording={},hub_layout={},guest_app_theme=state.get('default_appearance','event'))
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
    if engine!='webkit':options['args']=['--no-sandbox']
    if engine=='edge':options['executable_path']=os.environ['FESTIO_EDGE_EXECUTABLE']
    browser=(pw.webkit if engine=='webkit' else pw.chromium).launch(**options)
    context=browser.new_context(viewport=dict(width=1440,height=1050),service_workers='block')
    context.route('**/*',intercept)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    state['forms']=[dict(id='form',revision_id='r1',version=1,title='Participation consent',body='Isolated test form wording.',guest_id='child',guest_name='Sara Idris',on_behalf=True,status='pending',required=True,timing='before_arrival',can_submit=True,kind='consent',questions=[dict(key='notes',label='Notes',type='textarea',required=False)])]
    def load(route):
        page.goto(BASE+'/r/demo-token?case='+str(time.time_ns())+'#/'+route);page.locator('.fh-event-app').wait_for();page.wait_for_timeout(220)
    def screen(route):
        page.evaluate('(r)=>location.hash="#/"+r',route);page.wait_for_timeout(180)
    def appearance(): return page.locator('.fh-event-app').get_attribute('data-appearance')
    load('appearance')
    check('default event appearance preserved',appearance()=='event')
    for theme in ['light','dark','gold','ocean']:
        screen('appearance');page.get_by_role('button',name=theme.title(),exact=False).last.click()
        check(theme+' applies immediately',appearance()==theme)
        check(theme+' remembered for event',page.evaluate('localStorage.getItem("festio:guesthub:appearance:event-demo")')==theme)
        for route in ['home','programme','pass','inbox','more','meals','experience','communications','feedback','resources','party','venue']:
            screen(route);check(theme+' retained on '+route,appearance()==theme)
            check(theme+' fits desktop '+route,page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            if route=='pass':check(theme+' QR stays white',page.locator('.app-pass-qr').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(255, 255, 255)')
            if route=='experience':
                page.locator('.forms-item summary').click();page.get_by_label('Your full name',exact=True).fill('Preview signer')
                if theme=='dark':check('dark signing card uses themed background',page.locator('.forms-signature').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(23, 34, 28)')
            if theme in ['dark','gold'] and route in ['home','meals','experience','communications']:
                page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/(theme+'-'+route+'-desktop.png')),full_page=True)
        load('home');check(theme+' survives reload',appearance()==theme)
        page.set_viewport_size(dict(width=390,height=844))
        for route in ['home','appearance','programme','pass','meals','experience']:
            screen(route);check(theme+' fits phone '+route,page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            page.evaluate('window.scrollTo(0,0)')
            if route in ['home','appearance','meals']:page.screenshot(path=str(OUT/(theme+'-'+route+'-phone.png')))
        page.set_viewport_size(dict(width=1440,height=1050))
    state['default_appearance']='gold';load('home');check('personal appearance overrides event default',appearance()=='ocean')
    page.get_by_role('button',name='Change appearance',exact=True).click();page.get_by_role('button',name='Event default',exact=False).click();check('event default restored',appearance()=='gold')
    load('home');check('published default used on reload',appearance()=='gold')
    page.evaluate('localStorage.setItem("festio:guesthub:appearance:event-demo","invalid")');load('home');check('invalid saved preference falls back safely',appearance()=='gold')
    page.get_by_role('button',name='Change appearance',exact=True).click();page.go_back();check('browser back returns from appearance','#/home' in page.url)
    page.evaluate('localStorage.removeItem("festio:guesthub:appearance:event-demo")')
    page.add_init_script("Storage.prototype.setItem=function(){throw new Error('storage blocked')}")
    load('appearance');page.get_by_role('button',name='Dark',exact=False).click();check('storage failure still applies theme',appearance()=='dark');check('storage failure explained',page.get_by_role('status').filter(has_text='Applied for this visit').is_visible())
    assert not errors and not unexpected
    result={'checks':checks,'errors':errors,'unexpected':unexpected,'limitations':['Isolated APIs and test identities; no production data changes.','Browser engine and phone viewport testing, not physical devices.']}
    (OUT/'validation.json').write_text(json.dumps(result,indent=2));print(json.dumps({'passed':len(checks),'errors':errors}));browser.close();server.shutdown()
