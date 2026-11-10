"""Regression: open the full guest page on its invitation tab, not just InviteTab."""
import json,subprocess,tempfile,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
EVENT={'id':'fixture-event','name':'IEDPU invitation regression','rsvp_enabled':True,'rsvp_token':'fixture-only','rsvp_multi_invitee_limit_rules':{'Member':10},'rsvp_invitee_type_options':['Spouse','Child'],'rsvp_invitee_age_options':['Adult'],'rsvp_deadline':'2026-11-29T17:59:00'}
SCRIPT='import {build} from \'esbuild\';await build({stdin:{contents:\'import React,{useState} from "react";import {createRoot} from "react-dom/client";import {BrowserRouter} from "react-router-dom";import GuestsRedesignPage,{InviteTab} from "./src/pages/GuestsRedesignPage.jsx";import {api} from "./src/api";import "./src/pages/redesign/RedesignShell.css";function Fixture(){return <GuestsRedesignPage/>}createRoot(document.getElementById("root")).render(<BrowserRouter><Fixture/></BrowserRouter>);\',resolveDir:process.cwd(),loader:\'jsx\'},bundle:true,jsx:\'automatic\',outfile:process.argv[1],define:{\'process.env.NODE_ENV\':\'"production"\'},loader:{\'.css\':\'css\'},plugins:[{name:\'fixtures\',setup(b){b.onResolve({filter:/\\/api$|\\/AdminPage$|\\/RedesignShell$|\\/hooks\\/useCurrentEvent$|\\/hooks\\/useEventDetails$|\\/hooks\\/useGuests$/},a=>({path:a.path,namespace:\'fixture\'}));b.onLoad({filter:/.*/,namespace:\'fixture\'},a=>({loader:\'jsx\',resolveDir:process.cwd(),contents:a.path.endsWith(\'/useCurrentEvent\')?\'export const useCurrentEvent=()=>[window.__event.id,()=>{}];\':a.path.endsWith(\'/useEventDetails\')?\'export const useEventDetails=()=>({event:window.__event,refresh:async()=>{},error:null});\':a.path.endsWith(\'/useGuests\')?\'const guests=[];export const useGuests=()=>({guests,loading:false,error:null,refresh:async()=>{}});\':a.path.endsWith(\'/api\')?\'export const api=new Proxy({},{get:(_,name)=>(...args)=>fetch("/fixture/"+name,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.detail);return d})});\':a.path.endsWith(\'/AdminPage\')?\'export const INVITE_THEMES=[{id:"default",label:"Teal (Default)"},{id:"gold",label:"Gold"},{id:"rose",label:"Rose"},{id:"midnight",label:"Midnight"},{id:"forest",label:"Forest"}];export const RSVP_QUESTION_PRESETS=[{label:"Parking",question:"Do you need parking?",question_type:"boolean"}];\':\'export default function Shell({children}){return <main>{children}</main>}export const Icon=()=>null;export const Modal=({children,title})=><section role="dialog" aria-label={title}>{children}</section>;export const ConfirmDialog=({title,message,confirmLabel,onCancel,onConfirm})=><section role="dialog" aria-label={title}><p>{message}</p><button onClick={onCancel}>Cancel</button><button onClick={onConfirm}>{confirmLabel}</button></section>;export const ChannelPreviewFrame=()=>null;export const UnadmitDialog=()=>null;\'}))}}]})'

with tempfile.TemporaryDirectory() as temp:
 subprocess.run(['/tmp/mumineen-node/node-v22.16.0-linux-x64/bin/node','--input-type=module','-e',SCRIPT,temp+'/app.js'],cwd=ROOT,check=True,capture_output=True)
 Path(temp+'/index.html').write_text('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script>window.__event='+json.dumps(EVENT)+';</script><script src="app.js"></script>')
 class H(SimpleHTTPRequestHandler):
  def __init__(self,*args,**kw):super().__init__(*args,directory=temp,**kw)
  def log_message(self,*args):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=server.serve_forever,daemon=True).start()
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args=['--no-sandbox']);page=browser.new_page();errors=[];calls=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def api_route(route):
   name=route.request.url.rsplit('/',1)[-1];calls.append(name)
   assert name.startswith('list') or name in ['getEventDesign','getInvitationOpening'],name
   route.fulfill(json=[] if name.startswith('list') else {'envelope_config':{}})
  page.route('**/fixture/**',api_route)
  page.goto(f'http://127.0.0.1:{server.server_port}/?tab=invite')
  expect(page.get_by_role('tab',name='Page & RSVP')).to_be_visible()
  page.get_by_role('tab',name='Questions',exact=False).click()
  expect(page.get_by_role('tab',name='Questions',exact=False)).to_have_attribute('aria-selected','true')
  page.wait_for_timeout(200);assert not errors,errors
  print(json.dumps({'full_guest_page_invitation_tab':'passed','question_section':'passed','browser_errors':errors,'writes':0}))
  browser.close()
 server.shutdown()
