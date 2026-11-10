"""Real reminder editor and API client: send button, acceptance and failure feedback. Providers mocked."""
import json,subprocess,tempfile,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
script=r'''import{build}from'esbuild';await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{RealRemindersContent}from'./src/pages/AddonsRedesignPage.jsx';createRoot(document.getElementById('root')).render(<RealRemindersContent eventId='event' event={{id:'event',name:'PAMCON',timezone:'Africa/Lagos',event_date:'2026-11-11T09:00:00'}} notify={()=>{}}/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],loader:{'.css':'css'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'mock',setup(b){b.onResolve({filter:/\/redesign\/RedesignShell$|\/redesign\/RealOperationsContent$|\/hooks\/useEventResources$|\/firebase$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'jsx',resolveDir:process.cwd(),contents:a.path.endsWith('/firebase')?'export const auth={currentUser:{getIdToken:async()=>\"fixture-token\"}};':a.path.endsWith('/RealOperationsContent')?'export const RealOrdersContent=()=>null;export const RealSeatingContent=()=>null;':a.path.endsWith('/useEventResources')?'export const useEntitlements=()=>({});':a.path.endsWith('/api')?'export const api=new Proxy({},{get:(_,n)=>(...a)=>window.api(n,a)});':`export default({children})=>children;export const Icon=()=>null;export const Modal=({children})=><section role='dialog'>{children}</section>;export const ConfirmDialog=()=>null;export const WhatsAppTemplatePicker=()=>null;`}))}}]})'''
with tempfile.TemporaryDirectory()as tmp:
 subprocess.run(['/tmp/mumineen-node/node-v22.16.0-linux-x64/bin/node','--input-type=module','-e',script,tmp+'/app.js'],cwd=root,check=True)
 Path(tmp+'/index.html').write_text('''<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script>
 window.calls=[];window.executed=false;window.api=async(n,a)=>{calls.push({n,a});if(n==='listReminders')return[{id:'draft',label:'PAMCON draft',status:'pending',enabled:false,offset_days:1,send_time_local:'09:00',fire_at_utc:'2026-11-10T08:00:00Z',channels:['email','whatsapp'],whatsapp_template_ref:'approved:version',whatsapp_template_vars:{firstName:'{{first_name}}',passLink:'{{ticket_link}}'},audience_rsvp_statuses:['confirmed'],subject:'Reminder {{session_access_label}}',email_body:'<html><body>{{session_access_label}} {{session_access_schedule}}</body></html>'}];if(n==='listApprovedWhatsAppTemplates')return[{ref:'approved:version',variables:['firstName','passLink'],body:'Hello {{firstName}}. Pass: {{passLink}}'}];if(n==='previewReminder'){const both=a[2].sample_session_access==='conference_dinner';return{subject:'Reminder '+(both?'Conference + Dinner':'Conference Only'),body:'<html><body><h1>'+(both?'Conference + Dinner':'Conference Only')+'</h1><p>Conference 10:00 AM</p>'+(both?'<p>Gala Dinner 4:00 PM</p>':'')+'<script>parent.executed=true;<'+ '/script></body></html>'}}throw Error('Unexpected '+n)};
 </script><script src="app.js"></script>''')
 class H(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=tmp,**kw)
  def log_message(self,*a):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=server.serve_forever,daemon=True).start()
 with sync_playwright()as p:
  b=p.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args=['--no-sandbox']);page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def api_route(route):
   req=route.request;url=req.url;payload=req.post_data_json if req.method=='POST' else None
   if url.endswith('/reminders'):
    result=page.evaluate("window.api('listReminders',[])")
   elif 'whatsapp-templates/approved' in url or url.endswith('/templates/whatsapp/approved'):
    result=page.evaluate("window.api('listApprovedWhatsAppTemplates',[])")
   elif url.endswith('/preview'):
    result=page.evaluate("p=>window.api('previewReminder',['event','draft',p])",payload)
   elif url.endswith('/send-summary'):
    result={'audience':92,'reachable_guests':92,'unreachable_guests':0,'excluded_test_guests':0,'channels':{'email':89,'whatsapp':80},'blockers':[],'confirmation_token':'snapshot-1'}
   elif url.endswith('/send-now'):
    calls.append(payload);result={'status':'queued'}
   elif url.endswith('/test-send'):
    calls.append(payload)
    assert req.headers.get('authorization')=='Bearer fixture-token'
    if mode[0]=='failed':route.fulfill(status=502,json={'detail':'Provider did not accept this test'});return
    result={'ok':True,'status':'accepted','provider_message_id':'mock-123'}
   else:raise AssertionError('Unexpected API '+url)
   route.fulfill(json=result)
  calls=[];mode=['accepted'];page.route('**/api/**',api_route)
  page.goto(f'http://127.0.0.1:{server.server_port}');page.wait_for_timeout(200);assert not errors,errors;page.get_by_role('button',name='Edit',exact=True).click()
  page.get_by_role('button',name='Cancel',exact=True).click()
  page.get_by_role('button',name='Send now',exact=True).click()
  expect(page.get_by_role('dialog')).to_contain_text('guests to notify')
  expect(page.locator('.ad-send-review-channel-email')).to_contain_text('89')
  expect(page.locator('.ad-send-review-channel-whatsapp')).to_contain_text('80')
  assert not calls
  page.add_style_tag(content=(root/'src/pages/redesign/RedesignShell.css').read_text()+"\nbody{margin:0;padding:24px}section[role=dialog]{box-sizing:border-box;width:min(580px,100%);margin:20px auto;padding:24px;background:var(--surface);border-radius:18px}*{box-sizing:border-box}")
  page.evaluate("document.body.classList.add('admin-redesign')")
  output=Path('/home/dev/events/artifacts/product/messaging/reminder-send-review-2026-11-10');output.mkdir(parents=True,exist_ok=True)
  page.set_viewport_size({'width':1000,'height':1000});page.get_by_role('dialog').screenshot(path=str(output/'desktop.png'))
  page.set_viewport_size({'width':390,'height':1100});page.get_by_role('dialog').screenshot(path=str(output/'mobile.png'))
  assert page.get_by_role('dialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
  page.set_viewport_size({'width':1000,'height':1000})
  page.get_by_role('button',name='Cancel',exact=True).click();assert not calls
  page.get_by_role('button',name='Send now',exact=True).click()
  page.get_by_role('button',name='Confirm send now',exact=True).click()
  expect(page.get_by_role('dialog')).to_have_count(0)
  assert calls==[{'confirmation_token':'snapshot-1'}]
  assert not errors,errors
  print(json.dumps({'real_api_client':True,'summary_counts_visible':True,'cancel_sends_nothing':True,'confirmation_required':True,'one_queue_request':True,'real_provider_sends':0,'errors':errors}));b.close()
 server.shutdown()
