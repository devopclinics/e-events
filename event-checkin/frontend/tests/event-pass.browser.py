"""Pass branding, mobile fit and admission controls with isolated synthetic data."""
import json,os,threading,tempfile
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('FESTIO_APP_ARTIFACTS') or tempfile.mkdtemp(prefix='event-pass-'));OUT.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'dist'),**kw)
 def do_GET(self):
  if not (ROOT/'dist'/self.path.split('?')[0].lstrip('/')).is_file():self.path='/index.html'
  super().do_GET()
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{server.server_port}'
state=dict(status='valid',light=False,schedule=True);errors=[];writes=[];checks=[]
event=dict(name='PAMCON 6.0 Conference',couples_name='Party Managers Association of Nigeria (PAMAN)',event_date='2026-11-11T09:00:00',timezone='Africa/Lagos',venue_name='The Event Center',venue_address='Plot 1, Block B, Hakeem Balogun Street, off Cadbury Road, Agidingbi, Lagos.',guest_hub_layout='app',experience_enabled=False,notify_sms=True,notify_whatsapp=True,checkout_enabled=True)
guest=dict(id='fixture',event_id='pass-fixture',first_name='Ada',last_name='Guest',qr_token='fixture-pass',phone='+15555550123',sms_consent=True,whatsapp_consent=True)
def route(r):
 q=r.request;path=urlparse(q.url).path
 if not q.url.startswith(BASE):return r.abort()
 if q.method not in ['GET','HEAD','OPTIONS']:writes.append(path);return r.abort()
 if not path.startswith('/api/'):return r.continue_()
 data={}
 if path.endswith('/ticket'):data=dict(guest=guest,event=event,status=state['status'])
 elif path.endswith('/public-theme'):data=dict(is_default=False,colors=dict(background='#fffdfa' if state['light'] else '#330540',surface='#ffffff' if state['light'] else '#4A0A5D',primary='#124b3c' if state['light'] else '#FFB400',accent='#d6b45e'),wording={},pass_options=dict(schedule=dict(heading='Your day at PAMCON',timezoneLabel='All times are Lagos time (WAT).',items=[dict(label='Conference',time='10:00 AM to 3:00 PM'),dict(label='Gala dinner',time='From 4:00 PM',note='Finish time to be announced.',tone='gold')])) if state['schedule'] else {})
 elif path.endswith('/consent'):data=dict(status='none')
 elif path.endswith('.png'):return r.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="white"/><rect x="25" y="25" width="190" height="190" fill="black"/></svg>')
 return r.fulfill(content_type='application/json',body=json.dumps(data))
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome');c=b.new_context(service_workers='block',timezone_id='America/Los_Angeles');page=c.new_page();page.route('**/*',route);page.on('pageerror',lambda e:errors.append(str(e)))
  for width in [1440,430,390,320]:
   page.set_viewport_size(dict(width=width,height=844));page.goto(BASE+'/scan/fixture-pass',wait_until='networkidle')
   expect(page.get_by_role('heading',name=event['name'],exact=True)).to_be_visible();expect(page.get_by_role('region',name='Event schedule')).to_contain_text('10:00 AM to 3:00 PM');expect(page.get_by_role('region',name='Event schedule')).to_contain_text('From 4:00 PM')
   assert 'Wednesday, November 11, 2026' in page.locator('.pass-header').inner_text()
   expect(page.get_by_role('link',name='Create a free event')).to_have_attribute('href','https://festio.events/create-invitation?share=invite')
   expect(page.get_by_role('link',name='Back to GuestHub')).to_have_attribute('href','/r/fixture-pass#guest-hub')
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   footer=page.locator('footer').bounding_box();card=page.locator('.pass-card').bounding_box();assert footer['y']>=card['y']+card['height']
   assert page.locator('footer').evaluate('(e)=>getComputedStyle(e).position')=='static'
   assert page.locator('.pass-header').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgb(51, 5, 64)'
   assert page.locator('.pass-qr').evaluate('(e)=>e.naturalWidth>0')
   page.screenshot(path=str(OUT/f'pass-{width}.png'),full_page=True);checks.append(f'{width}px branding, facts, QR, footer and fit')
  state['status']='admitted';page.reload(wait_until='networkidle');expect(page.get_by_text('Check-in complete',exact=True)).to_be_visible();expect(page.get_by_text('Checkout QR',exact=True)).to_be_visible();checks.append('admission and checkout preserved')
  state['light']=True;state['schedule']=False;page.reload(wait_until='networkidle');assert page.locator('.pass-header h1').evaluate('(e)=>getComputedStyle(e).color')=='rgb(20, 45, 37)';expect(page.get_by_role('region',name='Event details')).to_contain_text('10:00 AM');expect(page.get_by_role('region',name='Event schedule')).to_have_count(0);checks.append('other event colours and date-only fallback preserved')
  state['status']='invalid';page.reload(wait_until='networkidle');expect(page.get_by_role('heading',name='Invalid Ticket')).to_be_visible();expect(page.locator('.pass-qr')).to_have_count(0);checks.append('invalid passes never render usable QR')
  assert not errors,errors;assert not writes,writes;b.close()
 (OUT/'validation.json').write_text(json.dumps(dict(checks=checks,errors=errors,mutations=writes),indent=2));print(json.dumps(dict(passed=len(checks),errors=errors)))
finally:server.shutdown()
