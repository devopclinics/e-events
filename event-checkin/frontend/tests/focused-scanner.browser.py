import json,subprocess,tempfile,threading,os
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
 script=r'''import{build}from'esbuild';await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{TokenScanner,CommandResultPanel}from'./src/pages/ScannerRedesignPage.jsx';import ScannerActionSettings from './src/components/ScannerActionSettings.jsx';import{scannerPresentedResult}from'./src/lib/scannerPresentation.mjs';function App(){const [result,setResult]=useState(null);window.showResult=setResult;const event=window.event;return <main><ScannerActionSettings event={event} onSaved={async()=>{}}/><TokenScanner event={event} zones={window.zones} gates={[]} sections={[]} mode='camera' offlineManifest={{guests:[]}} onResult={r=>setResult(r?{...r,experience_next_steps:window.steps}:null)} onRefreshManifest={()=>{}} onQueueChange={()=>{}}/><CommandResultPanel result={scannerPresentedResult(result,event)} onStepComplete={()=>{}} stepBusy={false}/></main>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],loader:{'.css':'css'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'mock',setup(b){b.onResolve({filter:/\/api$|\/redesign\/RedesignShell$|\/hooks\/useEventDetails$|\/hooks\/useCurrentEvent$|\/components\/QrCameraScanner$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'jsx',contents:a.path.endsWith('/api')?'export const api=new Proxy({},{get:(_,name)=>(...args)=>window.mock(name,args)});':a.path.endsWith('/RedesignShell')?'export default({children})=>children;export const Icon=()=>null;export const UnadmitDialog=()=>null;':a.path.endsWith('/QrCameraScanner')?'export default()=>null;':a.path.endsWith('/useCurrentEvent')?'export const useCurrentEvent=()=>[];':'export const useEventDetails=()=>({});'}))}}]})'''
 subprocess.run(['node','--input-type=module','-e',script,tmp+'/app.js'],cwd=root,check=True,capture_output=True)
 html='''<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><style>body{margin:0;background:#faf7ef;font-family:Arial;color:#23443c}main{max-width:900px;margin:20px auto;padding:16px}:root{--surface:#fff;--surface-2:#f3f0e9;--ink:#23443c;--muted:#6a7269;--line:#ddd;--teal:#194e3d}*{box-sizing:border-box}</style><div id="root"></div><script>
 window.calls=[];window.zones=[{id:'conference',name:'Conference'},{id:'dinner',name:'Dinner'}];window.steps=[{id:'welcome',title:'Arrival and welcome',type:'custom'},{id:'conf',title:'PAMCON Conference',type:'session_attendance'},{id:'gala',title:'Gala Night',type:'session_attendance'},{id:'feedback',title:'Event feedback',type:'custom'}].map(step=>({step}));window.event={id:'event',my_can_manage_event:true,venue_access_enabled:true,manual_checkin_enabled:true,setup_preferences:{session_seating_modes:{conference:'none',dinner:'event'},session_attendance_steps:{conference:'conf',dinner:'gala'},scanner_presentation:{focused:true,admission_step_ids:[],zone_step_ids:{}}}};
 window.form={...event.setup_preferences.scanner_presentation,attendance_step_ids:event.setup_preferences.session_attendance_steps,zones,steps:steps.map(x=>x.step),revision:'x'.repeat(64)};
 window.mock=async(name,args)=>{calls.push({name,args});if(name==='scannerPresentation')return form;if(name==='saveScannerPresentation'){form=args[1];return form}if(name==='scanGroupPassInfo')return {enabled:false};if(name==='scanZone')return {status:'ok',zone_name:zones.find(z=>z.id===args[1].zone_id).name,direction:args[1].direction,guest_name:'QA Participant',message:'Check-in recorded'};throw Error('Unexpected '+name)};
 </script><script src="app.js"></script>'''
 Path(tmp+'/index.html').write_text(html)
 class H(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=tmp,**kw)
  def log_message(self,*a):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=server.serve_forever,daemon=True).start()
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args=['--no-sandbox']);page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}')
  page.get_by_label('Zone',exact=True).select_option('conference');page.get_by_label('Pass token',exact=True).fill('qa-token');page.get_by_role('button',name='Check in to Conference',exact=True).click()
  result=page.get_by_test_id('scan-result');expect(result).to_contain_text('PAMCON Conference');expect(result).not_to_contain_text('Gala Night');expect(result).not_to_contain_text('Arrival and welcome');expect(result).not_to_contain_text('Event feedback')
  page.get_by_label('Zone',exact=True).select_option('dinner');expect(result).to_have_count(0);page.get_by_label('Pass token',exact=True).fill('qa-token');page.get_by_role('button',name='Check in to Dinner',exact=True).click();expect(result).to_contain_text('Gala Night');expect(result).not_to_contain_text('PAMCON Conference')
  page.get_by_label('Direction',exact=True).select_option('out');page.get_by_label('Pass token',exact=True).fill('qa-token');page.get_by_role('button',name='Check out of Dinner',exact=True).click();expect(result).not_to_contain_text('Program sessions')
  page.get_by_text('Configure scanner actions',exact=False).click();page.get_by_role('button',name='Save scanner actions',exact=True).click();expect(page.get_by_text('Saved. Staff should refresh',exact=False)).to_be_visible()
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth');assert not errors,errors
  out=os.environ.get('SCANNER_TEST_EVIDENCE')
  if out:Path(out).mkdir(parents=True,exist_ok=True);page.screenshot(path=str(Path(out)/'focused-settings-mobile.png'),full_page=True)
  for payload,headline in [
   ({'status':'ok','zone_name':'Conference','guest_name':'QA Participant'},'Checked in for Conference'),
   ({'status':'ok','zone_name':'Dinner','guest_name':'QA Participant','table_name':'Dinner Table 01','seat_number':1},'Checked in for Dinner'),
   ({'status':'denied','denied':True,'zone_name':'Dinner','guest_name':'QA Participant','deny_reason':'Conference-only pass. Dinner access is not approved.'},'Entry denied for Dinner'),
   ({'status':'already_admitted','guest_name':'QA Participant'},'Already checked in'),
   ({'status':'offline_queued','guest_name':'QA Participant'},'Saved offline · awaiting sync'),
   ({'status':'ok','direction':'out','zone_name':'Dinner','guest_name':'QA Participant'},'Checked out of Dinner'),
  ]:
   page.evaluate('(r)=>window.showResult(r)',payload)
   heading=page.locator('.sc-command-status-headline');expect(heading).to_have_text(headline)
   assert heading.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)')>=24
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
   if payload.get('deny_reason'):expect(result).to_contain_text(payload['deny_reason'])
   if out and headline.startswith(('Checked in','Entry denied')):page.screenshot(path=str(Path(out)/(headline.replace(' ','-')+'.png')),full_page=True)
  print(json.dumps({'checks':['Conference hides Dinner and unrelated programme actions','Dinner hides Conference','Changing station clears stale result','Exit has no entry actions','Admin settings save','390px no overflow'],'errors':errors}))
  b.close()
 server.shutdown()
