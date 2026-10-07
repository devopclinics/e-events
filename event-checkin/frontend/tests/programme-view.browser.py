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
now=datetime(2026,12,24,15,48,tzinfo=timezone.utc)
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
    if p.endswith('/live/guest-token'):return route.fulfill(content_type='application/json',body=json.dumps({'token':'fixture-live-token','expires_in':900}))
    if p.endswith('/activities/programme'):return route.fulfill(content_type='application/json',body=json.dumps(state['activities']))
    if p.endswith('/activities/live'):return route.fulfill(content_type='application/json',body=json.dumps([a for a in state['activities'] if a['status']=='live']))
    if p.endswith('/events/current-run'):return route.fulfill(content_type='application/json',body=json.dumps({'run':{'active_activity_id':'unrelated-show'}}))
    if p.endswith('/participate'):
        aid=p.split('/')[-2];state['opened'].append(aid);a=next(a for a in state['activities'] if a['id']==aid)
        return route.fulfill(content_type='application/json',body=json.dumps({'activity':{**a,'config':{},'questions':[]},'already_responded_question_ids':[],'my_answers':{},'rules':{}}))
    if p.endswith('/qna'):return route.fulfill(content_type='application/json',body='[]')
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

# All schedule, identity, form and activity data below are isolated test fixtures.
session.update(starts_at=iso(now-timedelta(minutes=48)),ends_at=iso(now+timedelta(minutes=12)),category='Learning',audience_guest_ids=['parent'])
shared={**session,'step_id':'shared','title':'Community gathering','category':'Community','audience_guest_ids':['parent','child'],'starts_at':iso(now+timedelta(minutes=42)),'ends_at':iso(now+timedelta(minutes=102))}
junior={**session,'step_id':'junior','title':'Junior discovery hour','category':'Junior','audience_guest_ids':['child'],'age_groups':['Ages 6–8'],'room':'Junior room'}
journey['program'].update(viewer_id='parent',audiences=[dict(guest_id='parent',name='Amina Idris',is_self=True,age_group='Adult'),dict(guest_id='child',name='Sara Idris',is_self=False,age_group='Ages 6–8')],days=[dict(date=(now+timedelta(days=i)).date().isoformat(),label=(now+timedelta(days=i)).strftime('%A, %B %d'),segments=[session,shared,junior] if i==0 else [{**shared,'step_id':'day'+str(i),'starts_at':iso(now+timedelta(days=i)),'ends_at':iso(now+timedelta(days=i,minutes=60))}]) for i in range(5)])
state['opened']=[]
state['activities']=[dict(id='quiz',session_id='session1',title='Session quiz',type='quiz',status='live'),dict(id='qna',session_id='session1',title='Morning Sheikh questions',type='q_and_a',status='live'),dict(id='future',session_id='session1',title='Future poll',type='poll',status='scheduled'),dict(id='closed',session_id='session1',title='Closed vote',type='voting',status='closed'),dict(id='other',session_id='other-session',title='Another Sheikh questions',type='q_and_a',status='live')]
state['forms']=[dict(id='form1',revision_id='revision1',version=1,title='Session consent',body='Fixture consent wording',kind='consent',required=True,timing='before_arrival',guest_id='child',guest_name='Sara Idris',on_behalf=True,status='pending',can_submit=True,questions=[],step_id='session1')]
with sync_playwright() as pw:
    engine=os.environ.get('FESTIO_APP_BROWSER','chromium');opts={'headless':True}
    if engine!='webkit':opts['args']=['--no-sandbox']
    if engine=='edge':opts['executable_path']=os.environ['FESTIO_EDGE_EXECUTABLE']
    browser=(pw.webkit if engine=='webkit' else pw.chromium).launch(**opts);context=browser.new_context(viewport=dict(width=1500,height=1050),service_workers='block');context.route('**/*',intercept);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.clock.install(time=now)
    page.goto(BASE+'/r/demo-token#/programme');page.locator('.pg-title').first.wait_for();page.locator('.pg-activity.is-live').first.wait_for()
    check('session-linked activities only',page.locator('.pg-activity').count()==5 and 'Another Sheikh' not in page.locator('.pg-view').inner_text())
    check('scheduled activity disabled',page.get_by_role('button',name='Answer poll Future poll Opens later').is_disabled())
    check('closed activity disabled',page.get_by_role('button',name='Cast your vote Closed vote Closed').is_disabled())
    link=page.get_by_role('link',name='Ask a question Morning Sheikh questions').get_attribute('href');check('exact activity and personal pass handoff','activity=qna' in link and 'session=session1' in link and 'pass=demo-parent-qr' in link)
    page.get_by_role('button',name='Save Faith, family & community',exact=True).click();page.reload();page.get_by_role('button',name='Unsave Faith, family & community',exact=True).wait_for();check('bookmarks persist after reload')
    page.screenshot(path=str(OUT/'Programme-Desktop.png'),full_page=True)
    page.get_by_role('button',name='My family',exact=True).click();check('family programme remains age-scoped','Junior discovery hour' in page.locator('.pg-view').inner_text() and 'Faith, family & community' not in page.locator('.pg-view').inner_text());page.get_by_role('button',name='All programmes',exact=True).click();check('all programme includes parallel sessions','2 parallel sessions' in page.locator('.pg-spotlight').inner_text());page.get_by_role('button',name='My programme',exact=True).click()
    page.get_by_role('button',name='Review consent Session consent').click();page.locator('#event-form-form1-child[open]').wait_for();check('exact child consent opened',page.url.endswith('member=child&form=form1'))
    page.go_back();page.locator('.pg-title').first.wait_for();check('back returns to programme')
    page.locator('.pg-title').first.click();page.locator('dialog[open]').wait_for();check('session details contain the same activities',page.locator('dialog .pg-activity').count()==5);page.keyboard.press('Escape')
    page.set_viewport_size(dict(width=390,height=844));page.screenshot(path=str(OUT/'Programme-Phone.png'),full_page=True);check('phone no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    for theme in ['dark','gold','ocean']:
        page.evaluate('(theme)=>localStorage.setItem("festio:guesthub:appearance:event-demo",theme)',theme);page.reload();page.locator('.pg-title').first.wait_for();check(theme+' palette applies',page.locator('.fh-event-app').get_attribute('data-appearance')==theme);check(theme+' no overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'));page.screenshot(path=str(OUT/(theme+'-phone.png')),full_page=True)
    page.goto(BASE+link);page.get_by_text('Morning Sheikh questions',exact=True).wait_for();check('exact Q&A opened',state['opened'] and set(state['opened'])=={'qna'});page.wait_for_timeout(500);check('guided show cannot hijack session link','unrelated-show' not in state['opened']);page.screenshot(path=str(OUT/'Programme-QA-Handoff.png'),full_page=True)
    check('no JavaScript errors',not errors)
    (OUT/'validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'browser':engine,'scope':'Real frontend assets and isolated API fixtures; no actual guest changes'},indent=2));print(json.dumps({'passed':len(checks),'errors':errors}));browser.close()
server.shutdown()
