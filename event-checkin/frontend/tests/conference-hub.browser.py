"""Bundled GuestHub with synthetic attendees; all API traffic stays local."""
import json,os,threading,tempfile
from datetime import datetime,timezone
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('FESTIO_APP_ARTIFACTS') or tempfile.mkdtemp(prefix='conference-hub-'));OUT.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'dist'),**kw)
 def do_GET(self):
  if not (ROOT/'dist'/self.path.split('?')[0].lstrip('/')).is_file():self.path='/index.html'
  super().do_GET()
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{server.server_port}'
event=dict(id='conference-fixture',name='PAMCON 6.0 Conference',event_type='Conference',guest_hub_layout='app',rsvp_landing_layout='welcome',event_date='2026-11-11T09:00:00',event_end_date='2026-11-11T14:00:00',timezone='Africa/Lagos',venue_name='The Event Center',status='active',experience_enabled=True,live_program_enabled=True,rsvp_enabled=True,rsvp_token='public-conference',speaker_enabled=True,speaker_token='fixture-speakers',engagement_enabled=False,festiome_enabled=False,rsvp_deadline=None)
guest=dict(id='attendee',name='Ada Guest',qr_token='fixture-pass',rsvp_status='confirmed',admitted=True,checked_out=False)
other=dict(id='colleague',name='Sam Guest',qr_token='fixture-colleague',rsvp_status='confirmed',admitted=False)
hub=dict(guest=guest,party=[guest,{k:v for k,v in other.items() if k!='qr_token'}],capabilities={},announcements=[],direct_messages=[],chat_messages=[])
conference=dict(step_id='conference',title='PAMCON 6.0 Conference',category='Conference',starts_at='2026-11-11T10:00:00+01:00',ends_at='2026-11-11T15:00:00+01:00',state='ended',room='The Event Center',description='Technology, Creativity and Profitability.',audience_guest_ids=['attendee','colleague'])
gala=dict(step_id='gala',title='Gala Night',category='Gala Night',starts_at='2026-11-11T16:00:00+01:00',ends_at=None,state='scheduled',room='The Event Center',audience_guest_ids=['attendee','colleague'])
program=dict(enabled=True,viewer_id='attendee',audiences=[dict(guest_id='attendee',name='Ada Guest',is_self=True),dict(guest_id='colleague',name='Sam Guest')],days=[dict(date='2026-11-11',label='Wednesday, November 11',segments=[conference,gala])],current_segments=[],next_segments=[])
journey=dict(experience_enabled=True,steps=[],next_steps=[],total_count=0,completed_count=0,consent=dict(required=False),program=program)
state=dict(site_status=200);errors=[];writes=[];requests=[];checks=[]
def intercept(route):
 req=route.request;path=urlparse(req.url).path
 if not req.url.startswith(BASE):return route.abort()
 if req.method not in ['GET','HEAD','OPTIONS']:writes.append(path);return route.abort()
 if path=='/site/event/conference-fixture':return route.fulfill(status=state['site_status'],content_type='application/json',body=json.dumps(dict(url='/site/conference-fixture') if state['site_status']==200 else {}))
 if path=='/site/conference-fixture':return route.fulfill(content_type='text/html',body='<main id="programme"><h1>Published conference programme</h1><p>Conference: 10am to 3pm. Gala Night: starts at 4pm.</p></main>')
 if not path.startswith('/api/') and not path.endswith('guesthub-sw.js'):return route.continue_()
 requests.append(path)
 if path.endswith('.js'):return route.fulfill(status=404,body='')
 data={}
 if path=='/api/invite/link/public-conference':data=event
 elif path.startswith('/api/invite/token/'):data=dict(event=event,guest=guest,already_responded=True,deadline_passed=False)
 elif path.endswith('/guest-hub'):data=hub
 elif path.endswith('/public-theme'):data=dict(colors=dict(background='#330540',surface='#4A0A5D',primary='#FFB400',accent='#FF7900',text='#FFFFFF'),wording={},hub_layout={})
 elif path.endswith('/experience/me'):data=journey
 elif path.endswith('/experience/me/feedback'):data=dict(forms=[])
 elif path.endswith('/app-party'):data=dict(viewer_id='attendee',members=[guest,other])
 elif path.endswith('/forms/me'):data=dict(forms=[])
 elif path.endswith('/push/config'):data=dict(enabled=False)
 elif path.startswith('/api/speakers/'):data=dict(event_name=event['name'],speakers=[dict(id='speaker',name='Mr. Ayodeji Olonilua',title='Keynote speaker')])
 elif path.endswith('/qr.png'):return route.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="black"/></svg>')
 elif '/guest-content/' in path:data=dict(materials=[],certificates=[])
 return route.fulfill(content_type='application/json',body=json.dumps(data))
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome');context=browser.new_context(service_workers='block');page=context.new_page();page.route('**/*',intercept);page.on('pageerror',lambda e:errors.append(str(e)));page.clock.install(time=datetime(2026,11,11,15,30,tzinfo=timezone.utc))
  page.goto(BASE+'/rsvp/public-conference#/programme');expect(page.get_by_role('heading',name='Published conference programme')).to_be_visible();assert page.url==BASE+'/site/conference-fixture#programme';assert not any(p.endswith('/guest-hub') or p.endswith('/experience/me') for p in requests);checks.append('anonymous shared link opens only published programme')
  state['site_status']=404;page.goto(BASE+'/rsvp/public-conference#/programme');expect(page.get_by_role('link',name='Already registered? Open my GuestHub')).to_have_attribute('href','/rsvp/public-conference?recover=1&destination=programme');assert 'not been published yet' in page.locator('body').inner_text();checks.append('unpublished website offers private recovery')
  state['site_status']=503;page.reload();page.get_by_role('button',name='Try again',exact=True).wait_for();state['site_status']=200;page.get_by_role('button',name='Try again',exact=True).click();expect(page.get_by_role('heading',name='Published conference programme')).to_be_visible();checks.append('failed public programme retries')
  page.evaluate("localStorage.setItem('eqr_rsvp:public-conference',JSON.stringify({rsvp_status:'confirmed',qr_token:'fixture-pass'}))")
  page.goto(BASE+'/rsvp/public-conference#/programme');expect(page.get_by_role('heading',name='Your conference programme')).to_be_visible();assert '/rsvp/public-conference' in page.url
  expect(page.locator('.pg-title').filter(has_text='Gala Night')).to_be_visible();expect(page.locator('.pg-time-note')).to_have_text('Finish time to be announced.');assert 'Invalid Date' not in page.locator('body').inner_text();assert 'My family' not in page.locator('body').inner_text();assert 'My group' in page.locator('body').inner_text();assert page.locator('.fh-event-app').get_attribute('data-scheme')=='light';checks.append('returning attendee keeps personal hub and start-only gala')
  primary=page.get_by_role('navigation',name='GuestHub',exact=True)
  for label in ['Programme','My Pass','Speakers','Venue','Help']:expect(primary.get_by_role('button',name=label,exact=True)).to_have_count(1)
  checks.append('conference navigation prioritizes pass speakers venue help')
  for width in [1440,390,320]:
   page.set_viewport_size(dict(width=width,height=1000));assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width;page.screenshot(path=str(OUT/f'programme-{width}.png'),full_page=True)
  checks.append('desktop and narrow mobile fit')
  page.locator('.pg-title').filter(has_text='Gala Night').click();expect(page.locator('dialog[open]')).to_be_visible();expect(page.locator('dialog[open]').get_by_text('Finish time to be announced.',exact=True)).to_be_visible();assert 'Happening now' not in page.locator('dialog[open]').inner_text();page.keyboard.press('Escape');checks.append('gala details never invent finish or live status')
  page.goto(BASE+'/rsvp/public-conference#/home');expect(page.get_by_role('heading',name='Welcome, Ada')).to_be_visible();assert 'Event ended' not in page.locator('.greeting').inner_text();checks.append('later gala prevents premature event-ended screen')
  page.goto(BASE+'/rsvp/public-conference#/speakers');expect(page.get_by_text('Mr. Ayodeji Olonilua',exact=True)).to_be_visible()
  assert page.locator('.speaker-card').evaluate('(el)=>getComputedStyle(el).color')=='rgb(23, 32, 51)'
  checks.append('speaker name has explicit dark foreground on white card')
  assert not errors,errors;assert not writes,writes
  (OUT/'validation.json').write_text(json.dumps(dict(checks=checks,errors=errors,mutations=writes,isolated_from_production=True),indent=2));print(json.dumps(dict(passed=len(checks),errors=errors)));browser.close()
finally:server.shutdown()
