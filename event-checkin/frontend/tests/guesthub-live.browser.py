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


base_intercept=intercept
state['activities']=[dict(id=id,title=title,type=kind,status=status,session_id=sid,session_title=stitle) for id,title,kind,status,sid,stitle in [
 ('quiz','Community knowledge check','quiz','live','session1','Faith, family & community'),
 ('qa','Ask the Sheikh · Family','q_and_a','live','session1','Faith, family & community'),
 ('qa2','Ask the Sheikh · Learning','q_and_a','live','session2','Quran learning circle'),
 ('poll','Your session priorities','poll','live','session1','Faith, family & community'),
 ('vote','Afropreneur audience vote','voting','scheduled','session3','Afropreneur Challenge'),
 ('survey','Convention feedback','survey','live','session1','Faith, family & community'),
 ('words','One word to take away','word_cloud','live','session1','Faith, family & community')]]
state.update(opened=[],qa={'qa':[],'qa2':[]},answers={},phase='answering',current='q1',run=None)
questions=[dict(id='q1',prompt='Where do you find your family programme?',question_type='single_choice',required=True,live_state='open',options=[dict(id='o1',label='My family',is_correct=True),dict(id='o2',label='Inbox',is_correct=False)],config={},time_limit_seconds=None),dict(id='q2',prompt='What does saving a session do?',question_type='single_choice',required=True,live_state='open',options=[dict(id='o3',label='Keeps it easy to find'),dict(id='o4',label='Grants admission')],config={},time_limit_seconds=None)]
def intercept(route):
    path=urlparse(route.request.url).path
    def send(data,status=200):return route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
    if '/engagement/' not in path:return base_intercept(route)
    if path.endswith('/activities/live'):
        if state.get('list_failure'):return send({'detail':'Temporarily unavailable'},503)
        return send([a for a in state['activities'] if a['status']=='live'])
    if path.endswith('/activities/programme'):return send(state['activities'])
    if path.endswith('/events/current-run'):return send({'run':state['run']})
    if path.endswith('/realtime-ticket'):return send({'detail':'Fixture uses reconciliation'},403)
    if path.endswith('/participate'):
        aid=path.split('/')[-2];state['opened'].append(aid)
        if state.get('participate_failure'):return send({'detail':'Activity access denied'},403)
        a=copy.deepcopy(next(a for a in state['activities'] if a['id']==aid));cfg={};qs=[]
        if a['type']=='quiz':
            qs=copy.deepcopy(questions);cfg={'show_mode':'guided','show_phase':state['phase'],'current_question_id':state['current'],'show_automation_enabled':True,'show_phase_deadline_at':state.get('deadline',iso(now+timedelta(seconds=30)))}
            for q in qs:q['live_state']='answer_revealed' if state['phase']=='reveal' and q['id']==state['current'] else 'open' if state['phase']=='answering' and q['id']==state['current'] else 'closed'
        elif a['type']=='poll':qs=[copy.deepcopy(questions[0])];cfg={'current_question_id':'q1'}
        elif a['type'] in ['survey','word_cloud']:qs=[dict(id='text1',prompt='What did you enjoy?',question_type='text',status='active',required=True,live_state='open',options=[],config={})];cfg={'current_question_id':'text1'}
        a.update(config=cfg,questions=qs)
        return send({'activity':a,'already_responded_question_ids':list(state['answers'].get(aid,{})),'my_answers':state['answers'].get(aid,{}),'rules':[],'draft_answers':{}, 'completed_at':state.get('survey_done') if aid=='survey' else None})
    if path.endswith('/respond'):
        aid=path.split('/')[-2];body=route.request.post_data_json;posts.append({'path':path,'body':body});state['answers'].setdefault(aid,{})[body['question_id']]=body
        return send({'correct':True,'score':1})
    if path.endswith('/complete'):state['survey_done']=iso(now);return send({'completed_at':iso(now),'completed':True})
    if path.endswith('/results'):return send({'questions':[{'question_id':state['current'],'option_counts':{'o1':5,'o2':2},'response_count':7}],'response_count':7})
    if path.endswith('/qna'):
        aid=path.split('/')[-2]
        if route.request.method=='POST':
            q=dict(id='submitted'+str(len(state['qa'][aid])),text=route.request.post_data_json['text'],status='pending',is_mine=True,upvote_count=0,upvoted_by_me=False);state['qa'][aid].append(q);posts.append({'path':path,'body':q});return send(q)
        return send(state['qa'][aid])
    if path.endswith('/upvote'):posts.append({'path':path});return send({'ok':True})
    return send({})

with sync_playwright() as pw:
    engine=os.environ.get('FESTIO_APP_BROWSER','chromium');opts={'headless':True}
    if engine!='webkit':opts['args']=['--no-sandbox']
    if engine=='edge':opts['executable_path']=os.environ['FESTIO_EDGE_EXECUTABLE']
    browser=(pw.webkit if engine=='webkit' else pw.chromium).launch(**opts)
    context=browser.new_context(viewport=dict(width=1440,height=1050),service_workers='block');context.route('**/*',intercept)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.clock.install(time=now)
    def load(hash='#/live'):
        page.goto(BASE+'/r/demo-token?case='+str(time.time_ns())+hash);page.locator('.guest-live').wait_for()
    def lobby():
        page.locator('.service-nav').get_by_role('link',name='Live Activities').click();page.locator('.gl-feature').wait_for()
    def open_activity(aid):
        page.evaluate('(aid)=>{location.hash="/live?activity="+aid}',aid);page.locator('.gl-heading h1').filter(has_text=next(a['title'] for a in state['activities'] if a['id']==aid)).wait_for();page.locator('.gh-live-participation').wait_for()
    load();page.locator('.gl-feature').wait_for();check('live lobby uses actual activity titles','Community knowledge check' in page.locator('.gl-feature').inner_text())
    check('upcoming activity cannot submit',page.locator('.gl-row').filter(has_text='Afropreneur').get_by_role('button').is_disabled())
    check('all supported activities remain listed',all(a['title'] in page.locator('.guest-live').inner_text() for a in state['activities']))
    page.screenshot(path=str(OUT/'Live-Desktop.png'),full_page=True)
    page.get_by_role('button',name='Join the quiz').click();page.locator('#question-q1').wait_for();check('quiz stays inside GuestHub','activity=quiz' in page.url and '/r/demo-token' in page.url and len(context.pages)==1)
    initial_seconds=int(page.get_by_role('timer').inner_text().split('s')[0]);page.clock.fast_forward(5000);remaining_seconds=int(page.get_by_role('timer').inner_text().split('s')[0]);check('visible countdown ticks',4<=initial_seconds-remaining_seconds<=6)
    page.get_by_role('button',name='My family',exact=True).click();page.get_by_role('button',name='Submit answer',exact=True).click();page.get_by_text('Correct! +1 pts').wait_for();check('existing response API receives quiz answer',posts[-1]['body']['selected_option_ids']==['o1'])
    check('host controls not exposed',not page.get_by_role('button',name='Next question').count())
    state['phase']='locked';page.clock.fast_forward(31000);page.get_by_text('Answers locked',exact=True).wait_for();check('host lock removes response controls',page.get_by_role('button',name='Submit answer',exact=True).count()==0)
    state['phase']='reveal';page.clock.fast_forward(31000);page.get_by_text('Results revealed',exact=True).wait_for();check('host reveal shows correct answer',page.get_by_text('✓ Correct',exact=True).is_visible());page.screenshot(path=str(OUT/'Live-Answer.png'),full_page=True)
    state['current']='q2';state['phase']='answering';page.clock.fast_forward(31000);page.locator('#question-q2').wait_for();check('host next opens next question',page.get_by_text('What does saving a session do?',exact=True).is_visible());page.get_by_text('Time is up. Waiting for the host’s next update.',exact=True).wait_for();check('expired question prevents late submission',page.get_by_role('button',name='Submit answer').is_disabled())
    lobby();page.get_by_role('button',name='Open session Q&A').first.click();page.get_by_label('Your question',exact=True).wait_for()
    for i in range(2):
        page.get_by_label('Your question',exact=True).fill('Family question '+str(i));page.get_by_role('button',name='Ask' if i==0 else 'Ask another question',exact=True).click();page.locator('.gh-live-participation .flex-1').filter(has_text='Family question '+str(i)).wait_for();page.get_by_role('button',name='Ask another question',exact=True).wait_for()
    check('Q&A accepts multiple questions',len(state['qa']['qa'])==2)
    check('pending questions remain labelled',page.get_by_text('Awaiting moderation',exact=True).count()==2)
    page.screenshot(path=str(OUT/'Live-QA.png'),full_page=True)
    open_activity('qa2');page.get_by_label('Your question',exact=True).wait_for();check('separate Sheikh queue has no family questions','Family question 0' not in page.locator('.guest-live').inner_text())
    page.go_back();page.locator('.gh-live-participation .flex-1').filter(has_text='Family question 0').wait_for();check('browser Back restores correct Q&A')
    context.set_offline(True);page.wait_for_timeout(100);check('offline disables question submission',page.get_by_label('Your question',exact=True).is_disabled());before=len(posts);page.clock.fast_forward(1000);check('offline does not queue writes',len(posts)==before);context.set_offline(False)
    lobby();page.get_by_role('searchbox').fill('Learning');check('search isolates correct Sheikh',page.locator('.gl-qa h2').inner_text()=='Ask the Sheikh · Learning');page.get_by_role('searchbox').fill('')
    page.get_by_role('checkbox',name='Questions & answers only').check();check('Q&A-only discovery filter','Community knowledge check' not in page.locator('.guest-live').inner_text());page.get_by_role('checkbox',name='Questions & answers only').uncheck()
    open_activity('poll');page.locator('#question-q1').wait_for();page.get_by_role('button',name='Inbox',exact=True).last.click();page.get_by_role('button',name='Submit answer').click();page.get_by_text('Correct! +1 pts').wait_for();check('poll response retained','poll' in state['answers'])
    open_activity('words');page.get_by_placeholder('Type your answer…').fill('Community');page.get_by_role('button',name='Submit',exact=True).click();page.get_by_text('Thanks — your response is in.').wait_for();check('word cloud response retained','words' in state['answers'])
    open_activity('survey');page.get_by_role('button',name='Start Survey',exact=False).click();page.get_by_placeholder('Type your answer…').fill('Learning together');page.get_by_role('button',name='Submit Feedback',exact=True).click();page.wait_for_timeout(700);check('survey submit retained',bool(state.get('survey_done')))
    page.goto(BASE+'/r/demo-token#/programme');page.locator('.pg-activity.is-live').first.wait_for();link=page.locator('.pg-activity.is-live').filter(has_text='Ask the Sheikh · Family').first
    check('programme link no longer exposes pass in URL','pass=' not in link.get_attribute('href'))
    link.click();page.get_by_label('Your question',exact=True).wait_for();check('programme opens exact embedded Q&A','activity=qa' in page.url and 'session=session1' in page.url)
    check('session modal is closed on live route',page.locator('dialog[open]').count()==0)
    state['run']={'id':'show1','status':'live','active_activity_id':'poll','current_step':{'title':'Community moment'}}
    page.clock.fast_forward(31000);check('unrelated show cannot hijack session link','activity=qa' in page.url and 'session=session1' in page.url)
    lobby();page.get_by_role('button',name='Join guided show').wait_for();page.get_by_role('button',name='Join guided show').click();page.locator('.gh-live-participation').wait_for();check('guided show follows by explicit choice','follow=1' in page.url)
    state['run']['active_activity_id']='qa2';page.clock.fast_forward(16000);page.get_by_label('Your question',exact=True).wait_for();check('guided show advances in GuestHub','activity=qa2' in page.url)
    page.evaluate('location.hash="/live?activity=qa&session=wrong-session"');page.get_by_role('heading',name='Activity unavailable').wait_for();check('mismatched session cannot open activity')
    state['participate_failure']=True;open_activity_url=BASE+'/r/demo-token#/live?activity=quiz';page.goto(open_activity_url);page.get_by_text('Activity access denied',exact=True).wait_for();check('participation failure has recovery',page.get_by_role('button',name='Try again').is_visible());state['participate_failure']=False
    load();page.locator('.gl-feature').wait_for();page.set_viewport_size(dict(width=390,height=844))
    for theme in ['event','light','dark','gold','ocean']:
        page.evaluate('(t)=>localStorage.setItem("festio:guesthub:appearance:event-demo",t)',theme);page.reload();page.locator('.gl-feature').wait_for();check(theme+' fits phone',page.evaluate('document.documentElement.scrollWidth<=innerWidth'));page.screenshot(path=str(OUT/(theme+'-phone.png')),full_page=True)
    lobby();page.locator('.gl-row').filter(has_text='Ask the Sheikh · Learning').get_by_role('button').click();page.get_by_label('Your question',exact=True).wait_for();page.wait_for_function('window.scrollY===0');check('phone activity navigation starts at top')
    page.go_back();page.locator('.gl-feature').wait_for();page.wait_for_function('window.scrollY>0');check('browser Back restores lobby scroll position')
    open_activity('qa');page.get_by_label('Your question',exact=True).wait_for();check('Q&A fits phone',page.evaluate('document.documentElement.scrollWidth<=innerWidth'));page.screenshot(path=str(OUT/'Live-QA-Phone.png'),full_page=True)
    state['current']='q1';state['phase']='answering';state['answers']['quiz']={};state['deadline']=page.evaluate('new Date(Date.now()+30000).toISOString()');open_activity('quiz');page.locator('#question-q1').wait_for();check('quiz fits phone',page.evaluate('document.documentElement.scrollWidth<=innerWidth'));page.screenshot(path=str(OUT/'Live-Quiz-Phone.png'),full_page=True)
    state['run']=None
    page.goto(BASE+'/live/guest?event=event-demo&pass=demo-parent-qr&session=session1&activity=qa');page.get_by_label('Your question',exact=True).wait_for();check('standalone Live link still works',not page.locator('.fh-event-app').count())
    state['list_failure']=True;load();page.get_by_role('alert').wait_for();check('discovery failure shows retry',page.get_by_role('button',name='Try again').is_visible());state['list_failure']=False;page.get_by_role('button',name='Try again').click();page.locator('.gl-feature').wait_for();check('discovery recovers without leaving GuestHub')
    original=state['activities'];state['activities']=[];load();page.get_by_role('heading',name='Nothing is live right now').wait_for();check('empty event displays no fictional activities',page.locator('.gl-feature,.gl-row').count()==0);state['activities']=original
    state['event']['engagement_enabled']=False;page.goto(BASE+'/r/demo-token?disabled=1#/live');page.get_by_text('Live Activities are not enabled for this event.').wait_for();check('disabled event cannot open embedded Live',page.locator('.guest-live').count()==0)
    check('no JavaScript errors',not errors)
    (OUT/'validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'browser':engine,'scope':'Built frontend, isolated API fixtures only. No actual guest responses changed.'},indent=2));print(json.dumps({'passed':len(checks),'errors':errors}));browser.close()
server.shutdown()
