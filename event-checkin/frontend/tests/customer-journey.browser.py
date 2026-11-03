"""Actual customer screens and shell; isolated identity and API fixtures, no outbound sends."""
import json,os,subprocess,tempfile,threading,copy
from pathlib import Path
from urllib.parse import urlparse
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('FESTIO_CUSTOMER_ARTIFACTS','/tmp/customer-journey-browser'));OUT.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='customer-journey-browser-') as tmp:
 build=Path(tmp)
 script=r'''import {build} from 'esbuild';await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {BrowserRouter,Routes,Route} from "react-router-dom";import Workspace from "./src/pages/CustomerWorkspace.jsx";import Setup from "./src/pages/SetupRedesignPage.jsx";import {ThemeProvider} from "./src/context/ThemeContext.jsx";createRoot(document.getElementById("root")).render(<ThemeProvider><BrowserRouter><Routes><Route path="/setup-redesign" element={<Setup/>}/><Route path="*" element={<Workspace/>}/></Routes></BrowserRouter></ThemeProvider>);',resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'import.meta.env':JSON.stringify({VITE_CUSTOMER_JOURNEY_ENABLED:'true'}),'process.env.NODE_ENV':'"production"'},loader:{'.css':'css','.svg':'dataurl','.png':'dataurl'},plugins:[{name:'test-identity',setup(b){b.onResolve({filter:/context\/AuthContext$/},a=>({path:'auth',namespace:'test'}));b.onResolve({filter:/\/firebase$/},a=>({path:'firebase',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='auth'?'export const useAuth=()=>({user:{id:"qa-user",name:"QA Organizer",email:"qa@example.com",role:"admin",is_org_admin:true,redesign_cohort:"redesign_default"},logout:()=>{}})':'export const auth={currentUser:{getIdToken:async()=>"isolated-token"}}',loader:'js'}))}}]});'''
 subprocess.run([os.environ.get('FESTIO_NODE','/tmp/mumineen-node/node-v22.16.0-linux-x64/bin/node'),'--input-type=module','-e',script,str(build/'app.js')],cwd=ROOT,check=True)
 (build/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>')
 class Handler(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=tmp,**kw)
  def log_message(self,*a):pass
  def do_GET(self):
   if not Path(tmp,self.path.split('?')[0].lstrip('/')).is_file():self.path='/index.html'
   super().do_GET()
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 ev={'id':'qa-event','name':'QA Customer Journey','event_date':'2027-02-15T09:00:00','timezone':'Africa/Lagos','venue_name':'QA Hall','status':'draft','rsvp_enabled':False,'rsvp_token':'qa-token','invite_mode':'open','description':'Fictional test data','updated_at':'2026-11-02T00:00:00','setup_preferences':{'quick_invite':{'style':'arch','colour':'lavender'}},'seating_enabled':False,'guest_cap':25,'is_paid':False,'message_credits':100}
 events=[ev];writes=[];tables=[];checks=[];errors=[];fail_check=False;fail_enable=False;fail_status=True;fail_bulk=False
 def check(s,ok=True):assert ok,s;checks.append(s)
 def intercept(route):
  nonlocal_dummy=None
  req=route.request;p=urlparse(req.url).path;m=req.method
  if not p.startswith('/api/'):return route.continue_()
  body=req.post_data_json if m in ['POST','PUT','PATCH'] else None
  if m!='GET':writes.append((p,m,body))
  data={}
  if p=='/api/events/creation-limits':data={'currency':'NGN','guest_cap':25,'unlimited_event_creation':True}
  elif p=='/api/events':
   if m=='POST':
    data={**ev,**body,'id':'created-event','status':'draft','rsvp_enabled':False};events.append(data)
   else:data=events
  elif p.startswith('/api/billing/tiers/'):data={'currency':'NGN','available_addons':['addon_seating'],'plan_tier':'tier300'}
  elif p.endswith('/guests'):data=[]
  elif p.endswith('/features'):
   if fail_enable:return route.fulfill(status=402,content_type='application/json',body=json.dumps({'detail':'Event Pass required'}))
   ev.update(body);data=copy.deepcopy(ev)
  elif p.endswith('/invite-settings'):ev.update(body);ev['updated_at']='2026-11-02T01:00:00';data=copy.deepcopy(ev)
  elif p.endswith('/status'):
   if fail_status:return route.fulfill(status=409,content_type='application/json',body=json.dumps({'detail':'Event changed; review and retry'}))
   assert body.get('if_unmodified_since')==ev['updated_at'],'Activation used a stale event version after saving RSVP'
   ev['status']=body['status'];data=copy.deepcopy(ev)
  elif p.endswith('/tables'):
   if m=='POST':tables.append({**body,'id':'table-qa'})
   data=tables[-1] if m=='POST' else tables
  elif p.endswith('/tables/bulk'):
   g=body['groups'][0];n=1 if fail_bulk else g['table_count'];ids=[]
   for i in range(n):
    row={'id':'table-'+str(len(tables)+1),'name':g['group_name']+' '+str(i+1),'capacity':g['table_capacity']};tables.append(row);ids.append(row['id'])
   data={'groups':[{'group_name':g['group_name'],'table_group_id':None if fail_bulk else 'group-qa','table_ids':ids,'created':n,'requested':g['table_count'],'error':'A later table could not be saved' if fail_bulk else None}]}
  elif p.startswith('/api/quick-invites/public/') or p=='/api/invite/qa-event':
   if fail_check:return route.fulfill(status=503,content_type='application/json',body=json.dumps({'detail':'Unavailable'}))
   data={**ev,'rsvp_enabled':ev['status']=='active' and ev['rsvp_enabled']}
  elif p=='/api/quick-invites' and m=='POST':data={'id':'quick-created'}
  elif p.endswith('/tasks'):data=[]
  elif p.endswith('/design'):data={}
  else:data=[]
  route.fulfill(content_type='application/json',body=json.dumps(data))
 with sync_playwright() as w:
  browser=w.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(10000);page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',intercept)
  base=f'http://127.0.0.1:{server.server_port}'
  page.goto(base+'/setup-redesign?view=guide');page.get_by_role('button',name='Free invitation',exact=False).wait_for();check('empty-account guide opens creation rather than not-found')
  page.evaluate('localStorage.setItem("eq.currentEventId","qa-event")');page.goto(base+'/admin-redesign');page.get_by_role('heading',name='QA Customer Journey',exact=True).wait_for();check('real event dashboard renders');page.screenshot(path=str(OUT/'dashboard-desktop.png'),full_page=True)
  page.get_by_role('link',name='Review registration',exact=False).click();page.get_by_role('button',name='Review opening registration').click();page.get_by_role('button',name='Confirm & open registration').click();page.get_by_role('alert').filter(has_text='Event changed; review and retry').wait_for();check('partial opening failure is visible and retryable',ev['rsvp_enabled'] and ev['status']=='draft');fail_status=False;page.get_by_role('button',name='Review opening registration').click();page.get_by_role('button',name='Confirm & open registration').click();page.get_by_role('button',name='Check invitation link').wait_for();check('explicit confirmation uses lifecycle API with concurrency token',any(p.endswith('/status') and body.get('if_unmodified_since') for p,m,body in writes if body))
  fail_check=True;page.get_by_role('button',name='Check invitation link').click();page.get_by_role('alert').filter(has_text='could not be opened').wait_for();check('failed destination never enables copying',page.get_by_role('button',name='Copy link').count()==0)
  fail_check=False;page.get_by_role('button',name='Check invitation link').click();page.get_by_role('button',name='Copy link').wait_for();check('destination is read before sharing and quick alias preserved','/i/qa-token' in page.get_by_label('Invitation link').input_value());page.goto(base+'/admin-redesign');page.get_by_role('heading',name='Your invitation is ready to share.',exact=True).wait_for();page.goto(base+'/admin-redesign?view=share');page.get_by_role('button',name='Copy link',exact=True).wait_for();check('checked invitation survives normal navigation');fail_check=True;page.get_by_role('button',name='Check again',exact=True).click();page.get_by_role('alert').filter(has_text='could not be opened').wait_for();check('failed explicit recheck clears previous successful state',page.get_by_role('button',name='Copy link',exact=True).count()==0);fail_check=False;page.get_by_role('button',name='Check invitation link',exact=False).click();page.get_by_role('button',name='Copy link',exact=True).wait_for();page.screenshot(path=str(OUT/'share-desktop.png'),full_page=True)
  page.goto(base+'/admin-redesign?view=tools');seat=page.locator('.cj-tool').filter(has=page.get_by_role('heading',name='Give everyone a seat',exact=True));seat.get_by_role('button',name='Enable & set up').wait_for();check('included access avoids upgrade detour')
  fail_enable=True;seat.get_by_role('button').click();page.get_by_role('alert').filter(has_text='Event Pass required').wait_for();check('server entitlement rejection stays enforced',not ev['seating_enabled'])
  fail_enable=False;seat.get_by_role('button').click();page.get_by_role('dialog').wait_for();page.get_by_role('button',name='Single table',exact=True).click();page.get_by_label('Table name',exact=True).fill('QA Table 01');page.get_by_role('button',name='Save table',exact=True).click();page.get_by_role('status').filter(has_text='QA Table 01').wait_for();check('inline seating persists real API payload',tables[0]['capacity']==10 and tables[0]['name']=='QA Table 01');check('tool activation preserves quick invitation design',ev['setup_preferences']['quick_invite']=={'style':'arch','colour':'lavender'})
  page.get_by_role('button',name='Close seating setup').click();seat.get_by_role('button').click();page.get_by_label('Total number of guests',exact=True).fill('210');page.get_by_label('Table group name',exact=False).fill('Main hall');page.get_by_role('status').filter(has_text='For 210 guests, add 20 tables').wait_for();page.screenshot(path=str(OUT/'seating-capacity-desktop.png'),full_page=True)
  page.get_by_role('button',name='Create 20 tables',exact=False).click();page.get_by_text('20 tables saved · 200 new seats',exact=True).wait_for();check('guest-count planning creates only needed additional capacity',len(tables)==21 and sum(t['capacity'] for t in tables)==210);check('bulk payload uses supported setup API',any(p.endswith('/tables/bulk') and body['groups'][0]['table_count']==20 and body['groups'][0]['table_capacity']==10 for p,m,body in writes if body))
  page.get_by_role('button',name='Close seating setup').click();seat.get_by_role('button').click();page.get_by_role('button',name='By table count',exact=True).click();page.get_by_label('Total guests (optional)',exact=True).fill('1000');page.get_by_label('New tables to add',exact=True).fill('20');check('insufficient table plan cannot be saved',page.get_by_role('button',name='Create 20 tables',exact=False).is_disabled())
  page.get_by_label('Total guests (optional)',exact=True).fill('');page.get_by_label('New tables to add',exact=True).fill('2');page.get_by_label('Table group name',exact=False).fill('Partial');fail_bulk=True;page.get_by_role('button',name='Create 2 tables',exact=False).click();page.get_by_role('alert').filter(has_text='1 of 2 tables').wait_for();check('partial batch is reported and repeat submission stays blocked',page.get_by_role('button',name='Create 2 tables',exact=False).is_disabled() and len(tables)==22);fail_bulk=False
  page.get_by_role('button',name='Close seating setup').click();page.get_by_label('Find a tool',exact=True).fill('certificates');check('catalog search exposes certificates',page.get_by_role('heading',name='Issue event certificates',exact=True).is_visible());page.get_by_label('Find a tool',exact=True).fill('meals');check('missing add-on becomes a discoverable card',page.get_by_role('heading',name='Organize meals & orders',exact=True).is_visible());page.get_by_label('Find a tool',exact=True).fill('');check('complete catalog contains all 34 customer tool areas',page.locator('.cj-tool').count()==34)
  page.screenshot(path=str(OUT/'complete-tools-desktop.png'),full_page=True)
  page.goto(base+'/setup-redesign?view=guide');page.get_by_role('heading',name='What are you planning?',exact=True).wait_for();check('guide explains connected journey and selling points',page.get_by_role('heading',name='Why bring it together with Festio?',exact=True).is_visible() and page.locator('.cj-advantage-grid article').count()==6);check('guide offers eight familiar event types',page.locator('.cj-recipe').count()==8);before=len(writes);page.get_by_role('button',name='Wedding & Nikkah',exact=False).click();check('occasion recommendations do not activate or overwrite the event',len(writes)==before and page.get_by_text('Suggested for Wedding & Nikkah',exact=True).is_visible());page.screenshot(path=str(OUT/'event-recipes-desktop.png'),full_page=True);page.get_by_role('heading',name='Your invitation stays yours.').wait_for();page.get_by_role('button',name='2. Open & share').click();page.get_by_role('link',name='Review & check invitation').wait_for();check('simplified guide links to actual registration checks');page.screenshot(path=str(OUT/'guide-desktop.png'),full_page=True)
  page.goto(base+'/setup-redesign?view=wizard');page.get_by_role('button',name='Conference',exact=False).click();page.get_by_label('Event name',exact=True).fill('QA New Conference');page.get_by_label('Date and start time').fill('2027-02-15T10:00');page.get_by_label('Host / organizer name').fill('QA Organizer');page.get_by_label('Organizer phone').fill('+2348000000000');page.get_by_role('button',name='Create draft event').click();page.wait_for_url('**/admin-redesign');check('new event works despite existing selection and inherits currency',any(p=='/api/events' and body.get('setup_preferences',{}).get('currency')=='NGN' for p,m,body in writes if body));check('draft creation does not activate tools or send messages',not any('send' in p or 'broadcast' in p for p,m,body in writes))
  page.goto(base+'/setup-redesign?view=wizard');page.get_by_role('button',name='Free invitation',exact=False).click();page.get_by_label('Event name',exact=True).fill('QA Invitation');page.get_by_label('Date and start time').fill('2027-02-15T10:00');page.get_by_label('Host / organizer name').fill('QA Organizer');page.get_by_label('Organizer phone').fill('+2348000000000');page.get_by_label('Colours',exact=True).select_option('rose');page.get_by_role('button',name='Create invitation & open replies').click();page.wait_for_url('**/admin-redesign');check('free flow keeps style and colour with idempotency key',any(p=='/api/quick-invites' and body['colour']=='rose' and body['style']=='arch' and body['request_id'] for p,m,body in writes if body))
  page.evaluate('localStorage.setItem("eq.currentEventId","qa-event")')
  for width in [390,320]:
   page.set_viewport_size({'width':width,'height':844})
   for path in ['/admin-redesign','/admin-redesign?view=share','/admin-redesign?view=tools','/setup-redesign?view=guide','/setup-redesign?view=wizard']:
    page.goto(base+path);page.wait_for_timeout(200)
    if page.evaluate('document.documentElement.scrollWidth>innerWidth'):
     print('OVERFLOW',path,page.evaluate('[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth+2).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,15)'))
     page.screenshot(path=str(OUT/'overflow.png'),full_page=True)
    check(f'no horizontal overflow {width}px {path}',not page.evaluate('document.documentElement.scrollWidth>innerWidth'))
   if width==390:page.screenshot(path=str(OUT/'creation-mobile.png'),full_page=True)
  check('no browser exceptions',not errors)
  (OUT/'validation.json').write_text(json.dumps({'scope':'Actual React screens, actual shell; isolated auth/API fixtures; no external writes','checks':checks,'errors':errors},indent=2));print(json.dumps({'passed':len(checks),'errors':errors}));browser.close()
 server.shutdown()
