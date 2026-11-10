"""Real reminder editor: rendered email and both sample access variants; no sends."""
import json,subprocess,tempfile,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
script=r'''import{build}from'esbuild';await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{RealRemindersContent}from'./src/pages/AddonsRedesignPage.jsx';createRoot(document.getElementById('root')).render(<RealRemindersContent eventId='event' event={{id:'event',name:'PAMCON',timezone:'Africa/Lagos',event_date:'2026-11-11T09:00:00'}} notify={()=>{}}/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],loader:{'.css':'css'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'mock',setup(b){b.onResolve({filter:/\/api$|\/redesign\/RedesignShell$|\/redesign\/RealOperationsContent$|\/hooks\/useEventResources$|\/firebase$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'jsx',resolveDir:process.cwd(),contents:a.path.endsWith('/firebase')?'export const auth=null;':a.path.endsWith('/RealOperationsContent')?'export const RealOrdersContent=()=>null;export const RealSeatingContent=()=>null;':a.path.endsWith('/useEventResources')?'export const useEntitlements=()=>({});':a.path.endsWith('/api')?'export const api=new Proxy({},{get:(_,n)=>(...a)=>window.api(n,a)});':`export default({children})=>children;export const Icon=()=>null;export const Modal=({children})=><section role='dialog'>{children}</section>;export const ConfirmDialog=()=>null;export const WhatsAppTemplatePicker=()=>null;`}))}}]})'''
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
  page.goto(f'http://127.0.0.1:{server.server_port}');page.wait_for_timeout(200);assert not errors,errors;page.get_by_role('button',name='Edit',exact=True).click()
  page.get_by_role('button',name='Preview',exact=True).click();frame=page.frame_locator('iframe[title="Reminder email preview"]')
  expect(frame.get_by_role('heading',name='Conference + Dinner',exact=True)).to_be_visible();expect(frame.locator('body')).to_contain_text('4:00 PM')
  assert page.locator('iframe').get_attribute('sandbox')=='';assert not page.evaluate('window.executed')
  page.get_by_label('Sample reminder access',exact=True).select_option('conference_only');page.get_by_role('button',name='Preview',exact=True).click()
  expect(frame.get_by_role('heading',name='Conference Only',exact=True)).to_be_visible();expect(frame.locator('body')).not_to_contain_text('Dinner');expect(frame.locator('body')).not_to_contain_text('4:00 PM')
  page.get_by_label('Preview channel').select_option('whatsapp');page.get_by_role('button',name='Preview',exact=True).click()
  expect(page.get_by_text('Hello Ada. Pass: https://festio.events/scan/sample-pass',exact=True)).to_contain_text('Hello Ada. Pass: https://festio.events/scan/sample-pass')
  assert not errors,errors;assert not any('send' in c['n'].lower()or 'update' in c['n'].lower()for c in page.evaluate('calls'))
  print(json.dumps({'html_rendered':True,'both_access_previews':True,'scripts_blocked':True,'writes':0,'errors':errors}));b.close()
 server.shutdown()
