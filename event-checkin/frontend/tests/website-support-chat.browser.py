"""Public WhatsApp handoff, isolated auth fixture; no messages sent."""
from pathlib import Path
from tempfile import TemporaryDirectory
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import subprocess,threading,json
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=Path('/home/dev/events/artifacts/festio-website-chat-2026');OUT.mkdir(exist_ok=True)
with TemporaryDirectory() as tmp:
 d=Path(tmp)
 script=r'''import {build} from 'esbuild';await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import Contact from './src/components/WhatsAppContact.jsx';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[q.get('route')||'/']}><Contact/></MemoryRouter>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},loader:{'.css':'css'},plugins:[{name:'identity',setup(b){b.onResolve({filter:/context\/AuthContext/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const useAuth=()=>({loading:false,user:location.search.includes('manager')?{id:'manager',is_platform_superadmin:true}:location.search.includes('organiser')?{id:'organiser'}:null})`,loader:'js'}))}}]});'''
 subprocess.run(['/tmp/mumineen-node/node-v22.16.0-linux-x64/bin/node','--input-type=module','-e',script,str(d/'app.js')],cwd=ROOT,check=True)
 (d/'index.html').write_text('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><style>body{margin:0;background:#f6f1e7;font-family:Arial}main{padding:clamp(20px,5vw,80px);color:#174d3b}h1{font:clamp(26px,5vw,60px) Georgia}</style><main><h1>Your event.<br>Everything connected.</h1><p>Create · Share · Run</p></main><div id="root"></div><script src="app.js"></script>')
 class H(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=tmp,**kw)
  def log_message(self,*a):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}'
 checks=[];errors=[];messages=[{'id':'welcome','role':'bot','body':'Hi! Ask about your event.'}];state={'mode':'auto'};calls=[]
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome');page=b.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)))
  def route(r):
   path=r.request.url.split('/api/')[-1];calls.append((path,r.request.method))
   if path.endswith('whatsapp/contact'):return r.fulfill(json={'heading':'Your next event. Let’s talk.','intro':'Chat with our team.','message':'Hi Festio'})
   if path=='platform/support/chat/session' and r.request.method=='POST':return r.fulfill(json={'token':'opaque-test-token','messages':messages,'mode':state['mode']})
   assert r.request.headers.get('authorization')=='Bearer opaque-test-token'
   if path=='platform/support/chat/messages':
    data=r.request.post_data_json;messages.append({'id':data['request_id'],'role':'customer','body':data['body']})
    if data['body']=='human':state['mode']='human';reply='The team can reply here.'
    else:reply='PAMCON starts at 10 AM.'
    messages.append({'id':data['request_id']+'reply','role':'bot','body':reply})
   return r.fulfill(json={'messages':messages,'mode':state['mode']})
  page.route('**/api/**',route);page.goto(url);page.get_by_role('button',name='Chat with Festio',exact=True).click();expect(page.get_by_role('button',name='Start chat here',exact=True)).to_be_visible();assert not any(c[0]=='platform/support/chat/session' for c in calls);checks.append('Opening the widget does not silently create a conversation')
  page.get_by_role('button',name='Start chat here',exact=True).click();page.get_by_label('Your message',exact=True).fill('PAMCON time');page.get_by_role('button',name='Send message',exact=True).click();expect(page.get_by_role('log')).to_contain_text('10 AM');checks.append('Customer sees an event answer inside the website')
  page.get_by_role('button',name='Talk to the team',exact=True).click();expect(page.get_by_role('status')).to_contain_text('Waiting for the Festio team');checks.append('Human handover keeps the visitor in the website conversation')
  messages.append({'id':'staff','role':'team','body':'Hello from Festio support.'});page.reload();page.get_by_role('button',name='Chat with Festio',exact=True).click();expect(page.get_by_role('log')).to_contain_text('Hello from Festio support.');checks.append('Browser remembers the conversation and displays a management reply')
  page.screenshot(path=str(OUT/'website-chat-desktop.png'));page.get_by_role('button',name='WhatsApp',exact=True).click();expect(page.get_by_role('link',name='Continue in WhatsApp',exact=False)).to_have_attribute('href','https://wa.me/15553888825?text=Hi+Festio');checks.append('WhatsApp remains an explicit separate choice')
  page.get_by_role('button',name='Chat here',exact=True).click();page.set_viewport_size({'width':320,'height':640});page.screenshot(path=str(OUT/'website-chat-mobile.png'));assert page.locator('body').evaluate('(e)=>e.scrollWidth<=innerWidth');expect(page.get_by_role('button',name='Send message',exact=True)).to_be_visible();checks.append('Chat fits a 320px mobile screen')
  assert not errors,errors;b.close()
 server.shutdown();(OUT/'browser-validation.json').write_text(json.dumps({'checks':checks,'page_errors':errors,'provider_messages_sent':0},indent=2));print('Website chat browser checks passed:',len(checks))
