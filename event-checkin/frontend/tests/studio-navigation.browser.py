"""Studio surface and navigation regressions with real editors and isolated transport."""
import copy,json,os,subprocess,tempfile,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('FESTIO_APP_ARTIFACTS','/tmp/studio-navigation-evidence'));OUT.mkdir(parents=True,exist_ok=True)
labels=['Guided design','Event website','Templates','Envelope','GuestHub','Flyer','Event Page','Festio Pass','FestioHub','Certificates','Email Preview','Publish'];checks=[];errors=[];fail=False;saves=[];certificate_saves=[];calls=[]
design={'revision':1,'selected_template_id':'forest','selected_flyer_template_id':'forest','theme_config':{'colors':{'primary':'#194e3d','accent':'#dfbf75'}},'wording_config':{},'asset_config':{},'page_config':{}}
event={'id':'studio-nav','name':'Studio navigation fixture','guest_hub_layout':'classic','rsvp_token':'fixture'}
with tempfile.TemporaryDirectory(prefix='studio-navigation-') as temp:
 build=Path(temp)
 script=r'''import {build} from 'esbuild';await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {BrowserRouter,useLocation} from "react-router-dom";import Studio from "./src/pages/DesignStudioWorkspace.jsx";import Website from "./src/pages/EventWebsitePage.jsx";import "./src/pages/redesign/RedesignShell.css";function App(){const {pathname}=useLocation();return pathname.endsWith("/website")?<Website/>:<Studio/>}createRoot(document.getElementById("root")).render(<BrowserRouter><App/></BrowserRouter>);',resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'import.meta.env':JSON.stringify({}),'process.env.NODE_ENV':'"production"'},loader:{'.css':'css'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/(useCurrentEvent|useEventDetails|RedesignShell|\/api)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),loader:'jsx',contents:a.path.endsWith('useCurrentEvent')?'export const useCurrentEvent=()=>["studio-nav"];export const registerEventChangeGuard=()=>()=>{};':a.path.endsWith('useEventDetails')?'export const useEventDetails=()=>({event:{id:"studio-nav",name:"Studio navigation fixture",guest_hub_layout:"classic",rsvp_token:"fixture"}});':a.path.endsWith('/api')?'export const api=new Proxy({},{get:(_,name)=>(...args)=>fetch("/fixture/"+name,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)}).then(async r=>{let d=await r.json();if(!r.ok)throw Object.assign(Error(d.detail),{status:r.status});if(name==="renderFlyer")return {...d,blob:new Blob([d.svg],{type:"image/svg+xml"})};return d})});':'export default function Shell({children}){return <main className="admin-redesign">{children}</main>}export const Icon=()=>null;export const Modal=({title,children})=><section role="dialog" aria-label={title}>{children}</section>;'}));}}]})'''
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
  name=urlparse(r.request.url).path.split('/')[-1];args=r.request.post_data_json;data={};calls.append([name,args])
  if name=='getEventDesign':data=design
  elif name=='saveEventDesign':
   if fail:return r.fulfill(status=503,json={'detail':'Save unavailable'})
   design={**design,**args[1],'revision':design['revision']+1};saves.append(copy.deepcopy(design));data=design
  elif name=='designTemplates':data={'templates':[{'id':'forest','name':'Forest invitation','category':'Classic','style':'Elegant','isFree':True,'surfaces':['Flyer','Event Page','Festio Pass','GuestHub'],'defaultColors':{'primary':'#194e3d','accent':'#dfbf75','background':'#f5f3e9','surface':'#ffffff','text':'#213c31'},'fontPairing':'elegant-serif','layout':{}},{'id':'modern','name':'Modern gathering','category':'Modern','style':'Minimal','isFree':True,'surfaces':['Flyer','Event Page'],'defaultColors':{'primary':'#193c50','accent':'#dfbf75'},'layout':{}}]}
  elif name=='renderFlyer':data={'svg':'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#194e3d"/><rect x="32" y="32" width="536" height="736" rx="240" fill="none" stroke="#dfbf75"/><text x="300" y="360" text-anchor="middle" fill="#dfbf75" font-size="32">Your event, together.</text></svg>','filename':'fixture.png'}
  elif name=='listCertificateTemplates':data=[{'id':'cert-1','name':'Participation','active':True,'design':{'title':'Certificate of Participation','body':'For joining our community','signature_name':'Academy team'},'eligibility':{'minimum_sessions':1,'require_event_checkin':True}}]
  elif name in ['listCertificateCandidates','listEventCertificates','listLiveContentSessions']:data=[]
  elif name=='saveCertificateTemplate':certificate_saves.append(args[2]);data={'id':'cert-1',**args[2]}
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
  for width in [1440,1024,390,320]:
   page.set_viewport_size({'width':width,'height':1000 if width>900 else 844})
   for tab in labels[2:]:
    nav.get_by_role('link',name=tab,exact=True).click();expect(nav.get_by_role('link',name=tab,exact=True)).to_have_attribute('aria-current','page')
    if tab=='Flyer':expect(page.get_by_alt_text('Live flyer preview')).to_be_visible()
    if tab=='Certificates':expect(page.get_by_label('Certificate name',exact=True)).to_be_visible()
    if tab!='Envelope':expect(page.locator('.ds-surface-intro')).to_be_visible()
    check(f'{width}px {tab} page fits',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    if width in [1440,390]:page.screenshot(path=str(OUT/f'surface-{tab.replace(" ","-")}-{width}.png'),full_page=True)
   page.goto(base+'/design-studio-redesign');expect(page.locator('.studio-v2')).to_be_visible();check(f'{width}px guided workspace fits',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  page.set_viewport_size({'width':1440,'height':1000});page.goto(base+'/design-studio-redesign?tab=Email%20Preview')
  for button in page.locator('.ds-email-workbench .rd-seg button').all():
   name=button.inner_text();button.click();expect(button).to_have_class('on');check(name+' email type remains selectable')
  nav.get_by_role('link',name='Certificates',exact=True).click();page.get_by_label('Heading',exact=True).fill('A shared achievement');page.get_by_role('button',name='Save design and rules',exact=True).click();expect(page.get_by_text('Certificate design saved',exact=False)).to_be_visible();check('Certificate design save preserved',certificate_saves[-1]['design']['title']=='A shared achievement')
  nav.get_by_role('link',name='Flyer',exact=True).click()
  group=page.locator('.ds-controls-section').filter(has=page.locator('summary',has_text='Wording'));group.locator('summary').click();expect(group.locator('input').first).to_be_visible();check('All flyer wording fields remain available',group.locator('input').count()>20);group.locator('summary').click()
  page.get_by_role('button',name='Download PNG',exact=True).click();expect(page.get_by_text('Flyer rendered and downloaded',exact=True)).to_be_visible()
  check('Flyer download action sends PNG request',any(c[0]=='renderFlyer' and c[1][1].get('format')=='png' for c in calls))
  nav.get_by_role('link',name='Publish',exact=True).click();page.get_by_role('button',name='Publish design',exact=True).click();expect(page.get_by_role('dialog',name='Publish this design?')).to_be_visible();page.get_by_role('button',name='Cancel',exact=True).click();check('Publication still requires explicit confirmation')
  page.locator('html').evaluate('(e)=>e.classList.add("dark")')
  for tab in labels[2:]:
   nav.get_by_role('link',name=tab,exact=True).click();check(tab+' dark workspace fits',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   if tab in ['Flyer','Certificates','Email Preview']:page.screenshot(path=str(OUT/f'dark-{tab.replace(" ","-")}.png'),full_page=True)
  page.locator('html').evaluate('(e)=>e.classList.remove("dark")')
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
