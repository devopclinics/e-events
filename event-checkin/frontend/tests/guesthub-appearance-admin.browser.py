"""Actual Design Studio editor with isolated shell/hooks and API fixtures."""
import json,os,subprocess,tempfile,threading,copy
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('FESTIO_APP_ARTIFACTS','/tmp/appearance-admin'));OUT.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='appearance-admin-') as temp:
 build=Path(temp)
 script="""import {build} from 'esbuild';await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {BrowserRouter} from "react-router-dom";import Editor from "./src/pages/DesignStudioRedesignPage.jsx";import "./src/pages/redesign/RedesignShell.css";createRoot(document.getElementById("root")).render(<BrowserRouter><Editor/></BrowserRouter>);',resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'import.meta.env':JSON.stringify({VITE_FIREBASE_API_KEY:'fixture-key',VITE_FIREBASE_PROJECT_ID:'fixture-project'}),'process.env.NODE_ENV':'"production"'},loader:{'.css':'css'},plugins:[{name:'isolated-shell',setup(b){b.onResolve({filter:/(useCurrentEvent|useEventDetails|RedesignShell|LiveContentWorkspace)$/},a=>({path:a.path,namespace:'test-shell'}));b.onLoad({filter:/.*/,namespace:'test-shell'},a=>({resolveDir:process.cwd(),loader:'jsx',contents:a.path.endsWith('useCurrentEvent')?'export const useCurrentEvent=()=>["theme-demo"];':a.path.endsWith('useEventDetails')?'export const useEventDetails=()=>({event:{id:"theme-demo",name:"Theme preview",guest_hub_layout:"app",rsvp_token:"preview",experience_enabled:true}});':a.path.endsWith('LiveContentWorkspace')?'export const CertificatesWorkspace=()=>null;':'export default function Shell({children}){return <main>{children}</main>} export const Icon=()=>null;export const Modal=({title,children})=><section role="dialog" aria-label={title}>{children}</section>;'}));}}]})"""
 subprocess.run([os.environ.get('FESTIO_NODE','/home/dev/.local/lib/python3.12/site-packages/playwright/driver/node'),'--input-type=module','-e',script,str(build/'app.js')],cwd=ROOT,check=True)
 (build/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>')
 class Handler(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=temp,**kw)
  def log_message(self,*a):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 design={'event_id':'theme-demo','theme_config':{'guestAppTheme':'event','colors':{'primary':'#124b3c'},'hubStyle':'wallet-pass'},'wording_config':{},'asset_config':{},'page_config':{}}
 live=copy.deepcopy(design);checks=[];errors=[];saves=[]
 def check(name,condition=True):assert condition,name;checks.append(name)
 def intercept(route):
  global design,live
  p=urlparse(route.request.url).path;m=route.request.method
  if not p.startswith('/api/'):return route.continue_()
  if p.endswith('/design'):
   if m=='PUT':design={**design,**route.request.post_data_json};saves.append(copy.deepcopy(design))
   data=design
  elif p.endswith('/design/publish'):
   design.update({'is_published':True,'published_version':1});live=copy.deepcopy(design);data=design
  elif p.endswith('/public-theme'):data={'colors':live['theme_config'].get('colors',{}),'wording':live.get('wording_config',{}),'hub_style':live['theme_config'].get('hubStyle','wallet-pass'),'guest_app_theme':live['theme_config'].get('guestAppTheme','event')}
  elif p.endswith('/templates'):data={'templates':[]}
  elif p.endswith('/outputs'):data=[]
  else:data={}
  route.fulfill(content_type='application/json',body=json.dumps(data))
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1000});page.route('**/*',intercept);page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/?tab=GuestHub');page.get_by_role('heading',name='Event App appearance',exact=True).wait_for()
  page.get_by_role('group',name='Event App default appearance').get_by_role('button',name='Dark',exact=False).click();page.wait_for_timeout(1300)
  check('organizer default autosaves',design['theme_config']['guestAppTheme']=='dark')
  check('theme remains a draft before Publish',live['theme_config']['guestAppTheme']=='event')
  check('existing branding preserved',design['theme_config']['colors']['primary']=='#124b3c')
  page.reload();page.get_by_role('group',name='Event App default appearance').get_by_role('button',name='Dark',exact=False).wait_for();check('saved selection restored',page.get_by_role('group',name='Event App default appearance').get_by_role('button',name='Dark',exact=False).get_attribute('aria-pressed')=='true')
  page.screenshot(path=str(OUT/'organizer-themes.png'),full_page=True)
  page.locator('.rr-tabs').get_by_role('button',name='Publish',exact=True).click();page.get_by_role('button',name='Publish design',exact=True).click();page.get_by_role('button',name='Confirm publish',exact=True).click();page.wait_for_timeout(700)
  check('publish includes chosen default',live['theme_config']['guestAppTheme']=='dark')
  check('publication verification succeeds',not page.locator('.ds-publish-error').count() and 'Publish new version' in page.locator('main').inner_text())
  assert not errors,errors
  (OUT/'validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'scope':'Actual Design Studio editor; isolated shell/hooks and API fixtures; no live writes'},indent=2));print(json.dumps({'passed':len(checks),'errors':errors}));browser.close()
 server.shutdown()
