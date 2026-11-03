"""Isolated proposal studio; real renderer, mocked authorised reads, no event writes."""
import subprocess,tempfile,threading,json
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
 d=Path(tmp)
 script=r'''import {build} from 'esbuild';await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Studio from './src/components/proposals/ProposalGenerator.jsx';window.calls=[];createRoot(document.getElementById('root')).render(<Studio onClose={()=>window.closedStudio=true}/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',outfile:process.argv[1],define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},loader:{'.css':'css'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:new RegExp('/api$')},()=>({path:'api',namespace:'fixture'}));b.onResolve({filter:new RegExp('media-library/SharedMedia$')},()=>({path:'media',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='media'?`import React from 'react';export function SharedMediaFiles({onSelect}){return <button type="button" onClick={()=>onSelect({url:'/photo.svg',title:'Approved image'})}>Use approved image</button>}`:`export const api={listEvents:async()=>{window.calls.push('GET events');return [{id:'event',name:'Birthday celebration',event_date:'2027-05-22T09:00:00',timezone:'Africa/Lagos',venue_name:'Sample hall',guest_cap:500}]},getPricing:async()=>{window.calls.push('GET pricing');return {tiers:[{name:'Festio Scale Event Pass',guest_cap:500,credits:3000,amount:45000000}]}}}`,loader:'jsx',resolveDir:process.cwd()}))}}]});'''
 subprocess.run(['/tmp/mumineen-node/node-v22.16.0-linux-x64/bin/node','--input-type=module','-e',script,str(d/'app.js')],cwd=ROOT,check=True)
 (d/'index.html').write_text('<link rel="stylesheet" href="app.css"><div id="root"></div><script src="app.js"></script>')
 class H(SimpleHTTPRequestHandler):
  def __init__(self,*a,**kw):super().__init__(*a,directory=tmp,**kw)
  def log_message(self,*a):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=server.serve_forever,daemon=True).start()
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome');page=b.new_page(viewport={'width':1440,'height':1050},accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*.svg',lambda r:r.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#254f43"/></svg>'));page.goto(f'http://127.0.0.1:{server.server_port}');page.get_by_label('Start from an event').select_option('event');assert page.get_by_label('Event date',exact=True).input_value()=='2027-05-22';page.get_by_role('button',name='Choose event image',exact=True).click();page.get_by_role('button',name='Use approved image',exact=True).click();frame=page.frame_locator('iframe');frame.locator('img[alt="Selected event image"]').wait_for();assert frame.locator('.sheet').count()==3;review=page.get_by_role('checkbox',name='I reviewed',exact=False);review.check();button=page.get_by_role('button',name='Download HTML',exact=True);button.wait_for()
  from playwright.sync_api import expect
  expect(button).to_be_enabled(timeout=15000)
  with page.expect_download() as info:button.click()
  html=Path(info.value.path()).read_text();assert '600,000' in html and '4 operators' in html and 'photo.svg' in html
  page.get_by_label('Prepared for',exact=True).fill('Different client');assert not review.is_checked();assert button.is_disabled();page.get_by_label('pass standard value',exact=True).fill('500000');assert '650,000' in page.locator('.pg-summary').inner_text();assert all(x.startswith('GET') for x in page.evaluate('calls'));assert not errors,errors;b.close()
 server.shutdown();print('Proposal generator browser checks passed: event, media, three pages, totals, review reset and HTML export; reads only')
