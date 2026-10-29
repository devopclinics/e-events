"""Navigation regression using real guided, advanced and website editors with isolated transport."""
import copy,json,os,subprocess,tempfile,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('FESTIO_APP_ARTIFACTS','/tmp/studio-navigation-evidence'));OUT.mkdir(parents=True,exist_ok=True)
labels=['Guided design','Event website','Templates','Envelope','GuestHub','Flyer','Event Page','Festio Pass','FestioHub','Certificates','Email Preview','Publish'];checks=[];errors=[];fail=False;saves=[]
design={'revision':1,'selected_template_id':None,'theme_config':{'colors':{'primary':'#194e3d','accent':'#dfbf75'}},'wording_config':{},'asset_config':{},'page_config':{}}
event={'id':'studio-nav','name':'Studio navigation fixture','guest_hub_layout':'classic','rsvp_token':'fixture'}
with tempfile.TemporaryDirectory(prefix='studio-navigation-') as temp:
 build=Path(temp)
 script=r'''import {build} from 'esbuild';await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {BrowserRouter,useLocation} from "react-router-dom";import Studio from "./src/pages/DesignStudioWorkspace.jsx";import Website from "./src/pages/EventWebsitePage.jsx";import "./src/pages/redesign/RedesignShell.css";function App(){const {pathname}=useLocation();return pathname.endsWith("/website")?<Website/>:<Studio/>}createRoot(document.getElementById("root")).render(<BrowserRouter><App/></BrowserRouter>);',resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'import.meta.env':JSON.stringify({}),'process.env.NODE_ENV':'"production"'},loader:{'.css':'css'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/(useCurrentEvent|useEventDetails|RedesignShell|LiveContentWorkspace|\/api)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),loader:'jsx',contents:a.path.endsWith('useCurrentEvent')?'export const useCurrentEvent=()=>["studio-nav"];export const registerEventChangeGuard=()=>()=>{};':a.path.endsWith('useEventDetails')?'export const useEventDetails=()=>({event:{id:"studio-nav",name:"Studio navigation fixture",guest_hub_layout:"classic",rsvp_token:"fixture"}});':a.path.endsWith('LiveContentWorkspace')?'export const CertificatesWorkspace=()=> <h2>Certificates workspace</h2>;':a.path.endsWith('/api')?'export const api=new Proxy({},{get:(_,name)=>(...args)=>fetch("/fixture/"+name,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)}).then(async r=>{let d=await r.json();if(!r.ok)throw Object.assign(Error(d.detail),{status:r.status});return d})});':'export default function Shell({children}){return <main className="admin-redesign">{children}</main>}export const Icon=()=>null;export const Modal=({title,children})=><section role="dialog" aria-label={title}>{children}</section>;'}));}}]})'''
 subprocess.run([os.environ.get('FESTIO_NODE','/tmp/mumineen-node/node-v22.16.0-linux-x64/bin/node'),'--input-type=module','-e',script,str(build/'app.js')],cwd=ROOT,check=True)
 (build/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>')
 class Handler(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=temp,**kw)
  def do_GET(self):
   if self.path.startswith('/design-studio-redesign'):self.path='/index.html'
   if self.path.startswith('/invite/'):
    self.send_response(200);self.end_headers();self.wfile.write(b'<p>Isolated guest preview</p>');return
   super().do_GET()
  def log_message(self,*a):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 def route(r):
  global design
  if not r.request.url.startswith(base):return r.abort()
  if '/fixture/' not in r.request.url:return r.continue_()
  name=urlparse(r.request.url).path.split('/')[-1];args=r.request.post_data_json;data={}
  if name=='getEventDesign':data=design
  elif name=='saveEventDesign':
   if fail:return r.fulfill(status=503,json={'detail':'Save unavailable'})
   design={**design,**args[1],'revision':design['revision']+1};saves.append(copy.deepcopy(design));data=design
  elif name=='designTemplates':data={'templates':[]}
  elif name in ['designOutputs','websiteReleases']:data=[]
  elif name=='listEvents':data=[event]
  elif name=='website':data={'slug':'fixture','template_family':'noor-future','revision':1,'content':{'headline':'Fixture headline'}}
  elif name=='websiteConnections':data={'connections':{}}
  elif name=='websiteContentSources':data={'sessions':[],'speakers':[]}
  elif name=='publicDesignTheme':data={'colors':{'primary':'#194e3d','accent':'#dfbf75'}}
  elif name=='renderWebsitePreview':data={'html':'<h1>Isolated website preview</h1>'}
  r.fulfill(json=copy.deepcopy(data))
 def check(name,condition=True):assert condition,name;checks.append(name)
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome');page=browser.new_page(viewport={'width':1440,'height':1000});page.route('**/*',route);page.on('pageerror',lambda e:errors.append(str(e)));nav=page.get_by_role('navigation',name='Design Studio tools',exact=True)
  page.goto(base+'/design-studio-redesign');expect(nav).to_be_visible();check('Guided editor shows all tools',nav.get_by_role('link').all_text_contents()==labels);expect(nav.get_by_role('link',name='Guided design',exact=True)).to_have_attribute('aria-current','page')
  page.get_by_role('navigation',name='Design steps').get_by_role('button',name=__import__('re').compile('Customize')).click();page.get_by_role('textbox',name='Welcome message',exact=True).fill('Keep my edits while navigating');nav.get_by_role('link',name='Envelope',exact=True).click();expect(nav.get_by_role('link',name='Envelope',exact=True)).to_have_attribute('aria-current','page');check('Guided edits flushed before navigation',saves[-1]['wording_config']['customMessage']=='Keep my edits while navigating')
  for tab in labels[2:]:
   nav.get_by_role('link',name=tab,exact=True).click();expect(nav.get_by_role('link',name=tab,exact=True)).to_have_attribute('aria-current','page');check(tab+' URL matches selected tool','tab='+__import__('urllib.parse',fromlist=['quote']).quote(tab) in page.url or 'tab='+tab.replace(' ','+') in page.url)
  page.go_back();expect(nav.get_by_role('link',name='Email Preview',exact=True)).to_have_attribute('aria-current','page');check('Browser Back restores selected tab')
  page.goto(base+'/design-studio-redesign?tab=Envelope');expect(nav.get_by_role('link',name='Envelope',exact=True)).to_have_attribute('aria-current','page');check('Legacy deep link opens correct editor')
  nav.get_by_role('link',name='Event website',exact=True).click();expect(nav.get_by_role('link',name='Event website',exact=True)).to_have_attribute('aria-current','page');check('Website editor shows identical tools',nav.get_by_role('link').all_text_contents()==labels)
  page.get_by_role('textbox',name='Website headline',exact=True).fill('Unsaved website title');page.once('dialog',lambda d:d.dismiss());nav.get_by_role('link',name='Envelope',exact=True).click();check('Website unsaved edits can block navigation',page.url.endswith('/website'))
  page.get_by_role('textbox',name='Website headline',exact=True).fill('Fixture headline');nav.get_by_role('link',name='Envelope',exact=True).click();expect(nav.get_by_role('link',name='Envelope',exact=True)).to_have_attribute('aria-current','page');page.screenshot(path=str(OUT/'advanced-desktop.png'),full_page=True)
  for width in [390,320]:
   page.set_viewport_size({'width':width,'height':844})
   for path,current in [('/design-studio-redesign','Guided design'),('/design-studio-redesign/website','Event website'),('/design-studio-redesign?tab=Envelope','Envelope')]:
    page.goto(base+path);expect(nav.get_by_role('link',name=current,exact=True)).to_have_attribute('aria-current','page');check(f'{width}px {current} all tools reachable',nav.get_by_role('link').count()==12);check(f'{width}px {current} navigation contained',nav.evaluate('(e)=>e.scrollWidth>=e.clientWidth') and nav.bounding_box()['width']<=width);page.screenshot(path=str(OUT/f'{current.replace(" ","-")}-{width}.png'),full_page=True)
  page.goto(base+'/design-studio-redesign');page.get_by_role('navigation',name='Design steps').get_by_role('button',name=__import__('re').compile('Customize')).click();fail=True;page.get_by_role('textbox',name='Welcome message',exact=True).fill('Unsaved change');nav.get_by_role('link',name='Event website',exact=True).click();expect(page.get_by_text('Your design could not be saved.',exact=False)).to_be_visible();check('Guided save failure blocks leaving',page.url==base+'/design-studio-redesign');assert not errors,errors;browser.close()
 server.shutdown()
(OUT/'validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'scope':'Real editors, isolated shell/hooks and fixture API only; no production writes.'},indent=2));print(json.dumps({'passed':len(checks),'errors':errors}))
