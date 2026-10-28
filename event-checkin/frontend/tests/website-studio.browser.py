"""Real website editor, isolated shell and API fixtures; no external writes."""
import copy,json,os,subprocess,tempfile,threading,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('FESTIO_APP_ARTIFACTS','/tmp/website-studio-evidence'));OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT.parent/'public-site-service'))
from app.render import render_site
checks=[];errors=[];calls=[]
event={'id':'website-test','name':'Mumineen Academy Annual Fundraising Event','event_date':'2026-12-13T14:00:00Z','timezone':'America/Chicago','venue_name':'Community Hall'}
initial={'slug':'mumineen-preview','template_family':'noor-future','revision':1,'published_release_id':'release-1','published_version':1,'public_url':'https://example.com/site/mumineen','content':{'headline':'Together, a brighter future.','summary':'An evening of connection, generosity and possibility.','navigation':[],'sessions':[{'title':'Welcome','time':'18:00','featured':True}],'speakers':[{'name':'Academy host','role':'Host'}],'faqs':[{'question':'Where?','answer':'Community Hall'}],'feature_sections':[{'id':'story','title':'Our story','summary':'A community coming together.'}],'stats':[{'label':'Years together','value':'20'}],'tracks':[]}}
site=copy.deepcopy(initial);fail=False
with tempfile.TemporaryDirectory(prefix='website-studio-') as tmp:
 build=Path(tmp)
 script=r'''import {build} from 'esbuild';await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import Editor from "./src/pages/EventWebsitePage.jsx";import "./src/pages/redesign/RedesignShell.css";createRoot(document.getElementById("root")).render(<Editor/>);',resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'css'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/(useCurrentEvent|RedesignShell|\/api)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),loader:'jsx',contents:a.path.endsWith('useCurrentEvent')?'export const useCurrentEvent=()=>["website-test"];export const registerEventChangeGuard=()=>()=>{};':a.path.endsWith('/api')?'export const api=new Proxy({},{get:(_,name)=>(...args)=>fetch("/fixture/"+name,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)}).then(async r=>{let d=await r.json();if(!r.ok)throw Object.assign(Error(d.detail),{status:r.status});return d})});':'export default function Shell({children}){return <main className="admin-redesign"><header className="rr-topbar"><div className="rr-topbar-inner"><b>Festio</b><span>Event workspace · Design Studio</span></div></header><div className="rr-body"><main className="rr-main rr-main-wide">{children}</main></div></main>}'}));}}]})'''
 subprocess.run([os.environ.get('FESTIO_NODE','/tmp/mumineen-node/node-v22.16.0-linux-x64/bin/node'),'--input-type=module','-e',script,str(build/'app.js')],cwd=ROOT,check=True)
 (build/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>')
 class Handler(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=tmp,**kw)
  def do_GET(self):
   if self.path.startswith('/website-templates/'):
    data=(ROOT/'public'/urlparse(self.path).path.lstrip('/')).read_bytes();self.send_response(200);self.send_header('Content-Type','image/png');self.end_headers();self.wfile.write(data);return
   if self.path.startswith('/design-studio-redesign'):self.path='/index.html'
   super().do_GET()
  def log_message(self,*a):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 def route(r):
  global site
  if not r.request.url.startswith(base):return r.abort()
  name=urlparse(r.request.url).path.split('/')[-1]
  if '/fixture/' not in r.request.url:return r.continue_()
  args=r.request.post_data_json;calls.append([name,args]);data={}
  if name=='listEvents':data=[event]
  elif name=='website':data=site
  elif name=='websiteConnections':data={'connections':{'rsvp':{'available':True,'url':'https://example.com/rsvp'},'guesthub':{'available':True,'url':'https://example.com/hub'}}}
  elif name=='websiteContentSources':data={'sessions':[{'source_id':'new','title':'Imported programme','time':'19:00'}],'speakers':[{'source_id':'sp','name':'Imported speaker'}]}
  elif name=='websiteReleases':data=[{'id':'release-1','version':1,'created_at':'2026-10-28T20:00:00Z'}]
  elif name=='publicDesignTheme':data={'colors':{'primary':'#174a39','accent':'#d9b86a'}}
  elif name=='saveWebsite':
   if fail:return r.fulfill(status=503,json={'detail':'Save unavailable'})
   assert args[1]['expected_revision']==site['revision'];site={**site,**args[1],'revision':site['revision']+1};data=site
  elif name=='renderWebsitePreview':data={'html':render_site(args[1]['content'],args[1]['template_family'],preview=True)}
  elif name=='publishWebsite':site={**site,'published_version':site['published_version']+1};data={'version':site['published_version']}
  elif name=='previewWebsite':data={'preview_url':base+'/saved-preview'}
  elif name in ['restoreWebsiteDraft','rollbackWebsite']:site={**copy.deepcopy(initial),'revision':site['revision']+1};data=site
  elif name=='uploadWebsiteAsset':data={'url':base+'/website-templates/noor-future.png','width':100,'height':100}
  r.fulfill(json=copy.deepcopy(data))
 def check(name,condition=True):assert condition,name;checks.append(name)
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome');page=browser.new_page(viewport={'width':1440,'height':1100});page.route('**/*',route);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  page.goto(base+'/design-studio-redesign/website');expect(page.get_by_role('heading',name='A place for your story.')).to_be_visible();expect(page.locator('iframe')).to_be_visible();page.wait_for_timeout(800)
  check('Nine editing sections remain accessible',page.locator('.ews-tabs button').count()==9)
  check('Desktop preview appears left of controls',page.locator('.ews-preview-panel').bounding_box()['x']<page.locator('.ews-editor-panel').bounding_box()['x'])
  page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
  headline=page.get_by_role('textbox',name='Website headline',exact=True);headline.fill('A future we build together.');expect(page.locator('.ews-save-bar')).to_contain_text('Unsaved changes');page.get_by_role('button',name='Save draft',exact=True).click();expect(page.locator('.ews-save-bar')).to_contain_text('Draft saved. Publish separately')
  check('Save preserves existing content collections',all(site['content'][key]==initial['content'][key] for key in ['sessions','speakers','faqs','stats','feature_sections']))
  page.get_by_role('button',name='Design',exact=True).click();check('All 24 designs retained',page.locator('.ews-template-card').count()==24)
  search=page.get_by_role('searchbox',name='Find your look');search.fill('Noor');check('Template search filters gallery',page.locator('.ews-template-card').count()==1);search.fill('zzzz');expect(page.get_by_text('No matching designs.',exact=False)).to_be_visible();search.fill('Atrium');page.get_by_role('button',name='Apply to draft',exact=True).click();check('Template switch retains complete event content',site['content']['headline']=='A future we build together.')
  page.get_by_role('button',name='Save draft',exact=True).click();expect(page.locator('.ews-save-bar')).to_contain_text('Draft saved. Publish separately');check('Selected template saves',site['template_family']=='atrium')
  for label in ['Header & footer','Style & media','Programme','Speakers','Content sections','Connections','History']:
   page.get_by_role('button',name=label,exact=True).click();check(label+' controls render',page.locator('.ews-editor-panel fieldset').first.is_visible());check(label+' has no desktop overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  expect(page.get_by_role('button',name='Restore draft',exact=True)).to_be_visible();expect(page.get_by_role('button',name='Revert live website',exact=True)).to_be_visible()
  page.get_by_role('button',name='Programme',exact=True).click();page.get_by_role('button',name='Import programme (1)',exact=True).click();page.get_by_role('button',name='Merge and keep website edits',exact=True).click();check('Programme import merge retains existing session',page.locator('.ews-session').count()==2)
  page.get_by_role('button',name='Save draft',exact=True).click();expect(page.locator('.ews-save-bar')).to_contain_text('Draft saved. Publish separately');check('Programme merge saved',len(site['content']['sessions'])==2)
  page.get_by_role('button',name='Publish website',exact=True).click();expect(page.locator('.ews-save-bar')).to_contain_text('Published version 2.');check('Publish keeps revision boundary',any(c[0]=='publishWebsite' and c[1][1].get('expected_revision') for c in calls))
  page.get_by_role('button',name='Identity',exact=True).click();page.get_by_role('textbox',name='Website headline',exact=True).fill('Unsaved recovery headline');page.reload();expect(page.get_by_role('button',name='Recover unsaved work',exact=True)).to_be_visible();page.get_by_role('button',name='Recover unsaved work',exact=True).click();expect(page.get_by_role('textbox',name='Website headline',exact=True)).to_have_value('Unsaved recovery headline');check('Browser recovery still works')
  fail=True;page.get_by_role('button',name='Save draft',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('Save unavailable');check('Save failure leaves changes intact',page.get_by_role('textbox',name='Website headline',exact=True).input_value()=='Unsaved recovery headline');fail=False
  page.get_by_role('button',name='Save draft',exact=True).click();expect(page.locator('.ews-save-bar')).to_contain_text('Draft saved. Publish separately')
  page.locator('html').evaluate('(e)=>e.classList.add("dark")');page.screenshot(path=str(OUT/'dark.png'),full_page=True);check('Dark theme uses existing shell tokens',page.locator('.ews-studio').evaluate('(e)=>getComputedStyle(e).getPropertyValue("--page-bg").trim()')=='#16130d');page.locator('html').evaluate('(e)=>e.classList.remove("dark")')
  for width in [390,320]:
   page.set_viewport_size({'width':width,'height':844})
   for key in ['identity','design','navigation','style','programme','speakers','sections','connections','history']:
    page.locator('.ews-mobile-step select').select_option(key);check(f'{width}px {key} no overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   page.locator('.ews-mobile-step select').select_option('identity');page.screenshot(path=str(OUT/f'phone-{width}.png'),full_page=True)
   page.get_by_role('button',name='See preview',exact=True).click();page.get_by_role('button',name='Mobile',exact=True).click();expect(page.locator('iframe')).to_be_visible();check(f'{width}px preview fits',page.evaluate('document.documentElement.scrollWidth<=innerWidth'));check(f'{width}px preview isolated','allow-same-origin' not in page.locator('iframe').get_attribute('sandbox'));page.screenshot(path=str(OUT/f'preview-{width}.png'),full_page=True);page.get_by_role('button',name='Edit website',exact=True).click()
  assert not errors,errors;browser.close()
 server.shutdown()
(OUT/'validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'scope':'Actual editor bundled with isolated shell and API fixtures. No production state or external services modified.'},indent=2));print(json.dumps({'passed':len(checks),'errors':errors}))
