"""Contextual tool guidance: browser interactions with isolated API fixtures."""
import json,os,subprocess,tempfile,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/tmp/customer-tool-browser');OUT.mkdir(exist_ok=True)
NODE='/tmp/mumineen-node/node-v22.16.0-linux-x64/bin/node'
checks=[]
with tempfile.TemporaryDirectory() as tmp:
 build=Path(tmp)
 script=r'''import {build} from 'esbuild';await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {BrowserRouter} from "react-router-dom";import Journey from "./src/components/setup/ToolSetupJourney.jsx";import {CUSTOMER_TOOLS} from "./src/pages/customerJourneyModel.mjs";import {toolWorkspaceHref} from "./src/components/setup/toolGuides.mjs";window.tools=CUSTOMER_TOOLS.map(t=>({...t,href:toolWorkspaceHref(t)}));createRoot(document.getElementById("root")).render(<BrowserRouter><Journey eventId="qa-event"/><div id="tool-editor-start" tabIndex={-1}>Native tool editor</div></BrowserRouter>);',resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'import.meta.env':JSON.stringify({VITE_CUSTOMER_JOURNEY_ENABLED:'true'}),'process.env.NODE_ENV':'"production"'},loader:{'.css':'css'},plugins:[{name:'fixture',setup(b){b.onResolve({filter:/context\/AuthContext$/},()=>({path:'auth',namespace:'fixture'}));b.onResolve({filter:/\/api$/},()=>({path:'api',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='auth'?'export const useAuth=()=>({user:{role:"admin"}})':'export const api=new Proxy({},{get:(_,method)=>async(...args)=>{window.calls.push({method,args});if(window.fail===method)throw Error("Service unavailable");if(method==="listEvents")return [window.fixture.event];if(method==="toggleFeatures"){Object.assign(window.fixture.event,args[1]);return window.fixture.event}if(method==="recordSetupEvidence"){window.recorded=args[0];return {id:"qa-evidence"}}return window.fixture[method]??[]}})',loader:'js'}))}}]});'''
 subprocess.run([NODE,'--input-type=module','-e',script,str(build/'app.js')],cwd=ROOT,check=True)
 (build/'index.html').write_text('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>')
 class Handler(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=tmp,**kw)
  def log_message(self,*a):pass
  def do_GET(self):
   if not Path(tmp,self.path.split('?')[0].lstrip('/')).is_file():self.path='/index.html'
   super().do_GET()
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script("window.calls=[];window.fixture={event:{id:'qa-event',live_program_enabled:false,experience_enabled:true},getSetupProgress:{evidence:[]},listExperienceWorkflows:[{status:'published'}],liveProgramSessions:[{id:'session'}],listGuests:[{id:'g',first_name:'QA',last_name:'Guest',rsvp_status:'confirmed',invite_token:'private-test-token',is_test:true}]}")
  page.goto(base+'/');tools=page.evaluate('window.tools')
  for tool in tools:
   page.goto(base+tool['href']);page.get_by_role('heading',name=tool['title'],exact=True).wait_for();page.get_by_role('button',name='Refresh saved setup',exact=True).wait_for();assert page.locator('.tj-steps li').count()==3
   assert not page.evaluate('window.calls.some(c=>c.method==="toggleFeatures"||c.method==="recordSetupEvidence")')
   checks.append(tool['id']+': guide renders without enabling or publishing')
  programme=next(t for t in tools if t['id']=='programme');page.goto(base+programme['href']);page.get_by_role('button',name='Make published programme visible').click();page.get_by_role('status').filter(has_text='Programme visibility enabled').wait_for();assert page.evaluate('window.fixture.event.live_program_enabled');checks.append('programme visibility repair explicit')
  page.get_by_role('button',name='Choose a guest to preview').click();page.get_by_label('Preview guest').select_option('g');assert page.get_by_role('link',name='Open personal guest preview').get_attribute('href').endswith('/r/private-test-token#/programme');checks.append('guest preview uses chosen personal credential')
  page.get_by_role('button',name='Continue in the editor').click();assert page.locator('#tool-editor-start').evaluate('(e)=>e===document.activeElement');checks.append('editor action moves keyboard focus')
  page.evaluate('window.fail="liveProgramSessions"');page.get_by_role('button',name='Refresh saved setup').click();page.get_by_role('button',name='Retry setup checks').wait_for();assert page.locator('[data-state="unknown"]').count()>0;checks.append('outage becomes unknown and retryable')
  page.locator('.tj-test summary').click();page.get_by_role('button',name='Record my scoped test result').click();assert page.get_by_role('option',name='Passed · this scoped test only').get_attribute('disabled') is not None, page.locator('.tj-test').inner_html();checks.append('unverified outcome cannot be marked passed')
  page.get_by_label('Test reference',exact=True).fill('QA programme review');page.get_by_role('button',name='Save test record').click();page.get_by_role('status').filter(has_text='scoped test result was recorded').wait_for();assert page.evaluate('window.recorded.result')=='partial';checks.append('partial evidence records explicit scope')
  page.screenshot(path=str(OUT/'programme-desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.goto(base+programme['href']);page.get_by_role('button',name='Refresh saved setup').wait_for();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.screenshot(path=str(OUT/'programme-mobile.png'),full_page=True);checks.append('mobile no horizontal overflow')
  assert not errors,errors;browser.close()
 server.shutdown()
(OUT/'results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'browser_errors':errors},indent=2));print(json.dumps({'passed':len(checks),'browser_errors':errors}))
