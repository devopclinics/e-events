import json,subprocess,tempfile,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
 script=r'''import {build} from 'esbuild';await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {ManualMode} from "./src/pages/ScannerRedesignPage.jsx";createRoot(document.getElementById("root")).render(<ManualMode event={{id:"event",manual_checkin_enabled:true,venue_access_enabled:true,separate_admission_access_enabled:true}} sections={[]} zones={[{id:"conference",name:"Conference"},{id:"dinner",name:"Dinner"}]} onResult={r=>window.results.push(r)} onManifestChange={()=>{}} onQueueChange={()=>{}}/>);',resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],loader:{'.css':'css'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'mock',setup(b){b.onResolve({filter:/\/api$|\/redesign\/RedesignShell$|\/hooks\/useEventDetails$|\/hooks\/useCurrentEvent$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'jsx',contents:a.path.endsWith('/api')?'export const api=new Proxy({},{get:(_,name)=>(...args)=>window.mock(name,args)});':a.path.endsWith('/RedesignShell')?'export default ()=>null;export const Icon=()=>null;export const UnadmitDialog=()=>null;':a.path.endsWith('/useCurrentEvent')?'export const useCurrentEvent=()=>[];':'export const useEventDetails=()=>({});'}))}}]})'''
 subprocess.run(['node','--input-type=module','-e',script,tmp+'/app.js'],cwd=root,check=True,capture_output=True)
 Path(tmp+'/index.html').write_text('<div id="root"></div><script>window.results=[];window.calls=[];window.fail=false;window.used=1;window.shared=true;window.mock=async(name,args)=>{calls.push({name,args});if(name==="searchGuests")return [{id:"g",qr_token:"token",full_name:"Test group",admitted:true}];if(name==="scanGroupPassInfo")return {enabled:window.shared,scope:args[1].zone_id||"Event entry",group_name:"Test group",used,admission_limit:2,remaining:2-used};if(name==="enterGroupPass"){if(window.fail){const e=new Error("Connection interrupted");throw e;}if(args[1].zone_id==="dinner"){const e=new Error("Dinner access blocked");e.status=409;throw e;}used+=args[1].quantity;return {status:"group_admitted",used,remaining:2-used};}if(name==="scanZone"||name==="manualCheckin"||name==="manualCheckout")return {status:"admitted"};throw Error("Unexpected API: "+name);};</script><script src="app.js"></script>')
 class H(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=tmp,**kw)
  def log_message(self,*a):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=server.serve_forever,daemon=True).start()
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args=['--no-sandbox']);page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}');page.get_by_placeholder('Search by name or phone…').fill('Test');button=page.get_by_role('button',name='Already checked in',exact=True);button.click()
  panel=page.get_by_role('region',name='Confirm group admission');expect(panel).to_contain_text('1 of 2');expect(panel).to_contain_text('1 remaining')
  assert not page.evaluate('calls.some(c=>c.name==="manualCheckin"||c.name==="scanZone")')
  page.evaluate('window.fail=true');panel.get_by_role('button',name='Admit 1 people').click();expect(panel.get_by_role('button',name='Retry same admission')).to_be_visible();page.evaluate('window.fail=false');panel.get_by_role('button',name='Retry same admission').click();expect(panel).to_have_count(0)
  calls=page.evaluate('calls.filter(c=>c.name==="enterGroupPass")');assert calls[0]['args'][1]==calls[1]['args'][1]
  button.click();expect(panel).to_contain_text('0 remaining');expect(panel.get_by_role('button',name='Admit 1 people')).to_be_disabled();panel.get_by_role('button',name='Close',exact=True).click()
  page.evaluate('window.used=0');page.get_by_label('Manual operation').select_option('access');page.get_by_label('Manual search zone').select_option('dinner');page.get_by_role('button',name='Check in to Dinner',exact=True).click();panel.get_by_role('button',name='Admit 1 people').click();expect(page.get_by_text('Dinner access blocked',exact=True)).to_be_visible();assert page.evaluate('used')==0
  panel.get_by_role('button',name='Close',exact=True).click()
  page.evaluate('window.shared=false');page.get_by_role('button',name='Check in to Dinner',exact=True).click()
  assert page.evaluate('calls.at(-1).name')=='scanZone'
  page.get_by_label('Manual operation').select_option('admission');button.click()
  assert page.evaluate('calls.at(-1).name')=='manualCheckin'
  page.get_by_label('Manual operation').select_option('checkout');page.get_by_role('button',name='Check out',exact=True).click()
  assert page.evaluate('calls.at(-1).name')=='manualCheckout'
  assert not errors,errors
  print(json.dumps({'passed':['second attendee confirmation','no individual check-in bypass','network retry uses same request id','full group disabled','Dinner restriction preserved'],'page_errors':errors}))
  b.close()
 server.shutdown()
