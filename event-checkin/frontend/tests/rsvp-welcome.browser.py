"""Bundled RSVP page; all API requests isolated with synthetic event data."""
import json, os, threading, copy
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
BUILD=Path(os.environ.get('FESTIO_APP_BUILD','/tmp/rsvp-welcome-dist'))
OUT=Path(os.environ.get('FESTIO_APP_ARTIFACTS','/tmp/rsvp-welcome-evidence'));OUT.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**k):super().__init__(*a,directory=str(BUILD),**k)
 def do_GET(self):
  if not (BUILD/self.path.split('?')[0].lstrip('/')).is_file():self.path='/index.html'
  super().do_GET()
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();BASE=f'http://localhost:{server.server_port}'
event=dict(id='welcome-demo',name='NCNMO Platform 2026',event_date='2026-12-24T14:00:00Z',event_end_date='2026-12-28T22:00:00Z',timezone='America/Indiana/Indianapolis',description='Five days of faith, family, learning and community.',venue_name='The Westin Indianapolis',venue_address='241 W Washington St, Indianapolis',rsvp_landing_layout='welcome',guest_hub_layout='app',rsvp_token='welcome-link',rsvp_enabled=True,rsvp_collect_email=True,rsvp_collect_phone=True,rsvp_email_required=True,rsvp_phone_required=False,rsvp_multi_invitee_enabled=True,rsvp_multi_invitee_limit=4,invite_mode='open',questions=[],live_program_enabled=True,experience_enabled=False)
state=dict(event=event,paid=False,recovery_status=202);recoveries=[];posts=[];errors=[];checks=[]
def check(name,val=True):
 assert val,name
 checks.append(name)
def intercept(route):
 r=route.request;p=urlparse(r.url).path
 if not r.url.startswith(BASE):return route.abort()
 if not p.startswith('/api/'):return route.continue_()
 data={}
 if r.method!='GET':
  if p=='/api/invite/welcome-demo/recover':recoveries.append(r.post_data_json);return route.fulfill(status=state['recovery_status'],json={'message':'If a registration matches, we’ll email its personal GuestHub link to the address saved on it.'})
  if p=='/api/invite/link/welcome-link/rsvp':posts.append(r.post_data_json);return route.fulfill(json=dict(rsvp_status='pending',first_name='Amina'))
  return route.abort()
 if p=='/api/invite/link/welcome-link':data=state['event']
 elif p.endswith('/public-theme'):data=dict(wording={'hotelBookingUrl':'https://example.org/hotel','hostName':'NCNMO','whoCanAttend':'Families, youth and community members'},page_config={'about':{'highlights':['Lectures and workshops','Junior Platform','Quran Competition','Gala']}})
 elif '/ticketing/' in p:data=dict(enabled=state['paid'],tickets=([dict(id='ticket1',name='Convention admission',price=25,currency='USD',available=20,max_per_order=4)] if state['paid'] else []))
 route.fulfill(json=data)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox']);ctx=b.new_context(viewport={'width':1440,'height':1000},service_workers='block');page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',intercept)
 def start():
  page.goto(BASE+'/rsvp/welcome-link',wait_until='networkidle');expect(page.locator('.rsvp-welcome')).to_be_visible()
 start();check('configured highlights',page.get_by_role('heading',name='Quran Competition').is_visible());check('no fictional schedule','Sample themes' not in page.inner_text('body'));check('desktop bounded layout',page.locator('.rw-site').bounding_box()['width']==1180);page.screenshot(path=str(OUT/'Welcome-Desktop.png'),full_page=True)
 page.get_by_role('button',name='Register / RSVP Now →').first.click();expect(page.locator('[data-registration-step=details]')).to_be_visible();check('registration uses hash',page.url.endswith('#/rsvp/register'));page.go_back();expect(page.locator('.rw-hero')).to_be_visible();check('browser back returns to event')
 page.get_by_role('button',name='My GuestHub ↗').click();expect(page.locator('dialog')).to_be_visible()
 page.get_by_label('Registration email',exact=True).fill('amina@example.org');page.get_by_text('Add your name to help find your registration (optional)',exact=True).click();page.get_by_label('First name (optional)',exact=True).fill('Amina');page.get_by_label('Last name (optional)',exact=True).fill('Idris')
 check('email verification only',page.locator('dialog input[type=tel]').count()==0 and page.locator('#rw-access-link').count()==0)
 page.get_by_role('button',name='Email my GuestHub link →').click();expect(page.get_by_role('heading',name='Check your email',exact=True)).to_be_visible();check('email request uses event and optional names',recoveries==[dict(email='amina@example.org',first_name='Amina',last_name='Idris')]);check('generic success does not claim registration found','If a registration matches' in page.locator('dialog').inner_text());check('recovery stays on public page','/rsvp/' in page.url)
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'Recovery-Email-Success-Phone.png'));page.get_by_role('button',name='Use a different email').click()
 for status,expected in [(429,'Please wait a few minutes'),(503,'We couldn’t request your link'),(422,'Check your email address'),(410,'This event has ended')]:
  state['recovery_status']=status;page.get_by_role('button',name='Email my GuestHub link →').click();expect(page.get_by_role('alert')).to_contain_text(expected);check(f'recovery handles {status}');expect(page.get_by_role('button',name='Email my GuestHub link →')).to_be_enabled()
 state['recovery_status']=202;page.set_viewport_size({'width':320,'height':844});check('recovery dialog fits phone',page.locator('dialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth'));page.screenshot(path=str(OUT/'Recovery-Email-Phone.png'));page.get_by_role('button',name='Close GuestHub dialog').click()

 for width in [390,320]:
  page.set_viewport_size({'width':width,'height':844});check(f'no overflow at {width}',page.evaluate('document.documentElement.scrollWidth<=innerWidth'));expect(page.locator('.rw-mobile-actions')).to_be_visible();check(f'mobile visible register at {width}')
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'Welcome-Phone.png'),full_page=True);page.get_by_role('button',name='Register →',exact=True).click();expect(page.get_by_placeholder('Jane',exact=True)).to_be_visible();check('mobile first field above fold',page.get_by_placeholder('Jane',exact=True).bounding_box()['y']<650);page.screenshot(path=str(OUT/'Registration-Phone.png'),full_page=True)
 page.get_by_placeholder('Jane',exact=True).fill('Amina');page.get_by_placeholder('Smith',exact=True).fill('Demo');page.get_by_placeholder('jane@example.com').fill('synthetic@example.org');page.get_by_role('button',name='Continue to Family / Guests →').click();expect(page.get_by_label('Relationship / role',exact=True)).to_be_visible();check('existing family controls retained');page.get_by_role('button',name='Review registration →').click();page.get_by_role('button',name='Confirm Registration →').click();expect(page.get_by_text("once the host confirms your spot.",exact=False)).to_be_visible();check('pending approval not shown as confirmed');check('existing RSVP endpoint used',len(posts)==1 and posts[0]['first_name']=='Amina')
 page.evaluate('localStorage.clear()');state['event']={**event,'rsvp_landing_layout':'current'};page.goto(BASE+'/rsvp/welcome-link',wait_until='networkidle');expect(page.locator('.complete-event-screen')).to_be_visible();check('current app landing unchanged');check('welcome not rendered when disabled',page.locator('.rsvp-welcome').count()==0)
 for layout in ['classic','companion','journey','complete','app']:
  state['event']={**event,'guest_hub_layout':layout};start();check(f'welcome independent of {layout}');check(f'no demo title {layout}','Your people.' not in page.inner_text('body'))
 state['event']={**event,'deadline_passed':True};start();page.get_by_role('button',name='Register →',exact=True).click();expect(page.get_by_text('RSVP has closed for this event.',exact=False)).to_be_visible();check('closed RSVP gate retained')
 state['event']=event;state['paid']=True;start();page.get_by_role('button',name='Register →',exact=True).click();expect(page.get_by_text('Convention admission',exact=True)).to_be_visible();check('paid ticket catalog retained');check('free RSVP not shown with paid tickets',page.get_by_placeholder('Jane',exact=True).count()==0)
 b.close()
server.shutdown();(OUT/'browser-validation.json').write_text(json.dumps(dict(checks=checks,errors=errors,scope='Isolated Chromium fixtures, no live writes'),indent=2));print(json.dumps(dict(passed=len(checks),errors=errors)));assert not errors
