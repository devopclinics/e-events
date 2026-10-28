"""Registration presentation and existing checkout behavior, isolated from providers."""
import json,os,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
BUILD=Path(os.environ.get('FESTIO_APP_BUILD','/tmp/envelope-release-dist'))
OUT=Path(os.environ.get('FESTIO_APP_ARTIFACTS','/tmp/modern-registration-evidence'));OUT.mkdir(parents=True,exist_ok=True)
event={'id':'modern-event','name':'Mumineen Academy Annual Fundraising Event','couples_name':'Mumineen Academy','event_date':'2026-12-13T14:00:00Z','timezone':'America/Chicago','rsvp_enabled':True,'invite_mode':'closed','rsvp_landing_layout':'welcome','guest_hub_layout':'app','rsvp_collect_email':True,'rsvp_collect_phone':True,'rsvp_multi_invitee_enabled':False,'rsvp_invitee_type_options':[]}
catalog={'enabled':True,'preview_mode':True,'currency':'USD','require_attendee_names':True,'show_availability':False,'fee':{'bps':500,'paid_by':'buyer'},'tax':{'enabled':False},'checkout_fields':[{'id':'group_request','label':'Group or family request (optional)','type':'textarea','required':False}], 'tickets':[{'id':'admission','name':'General Admission','description':'One admission per attendee. Add everyone joining you.','price':5000,'currency':'USD','available':200,'min_per_order':1,'max_per_order':10,'product_type':'ticket'},{'id':'donation','name':'Support Mumineen Academy','description':'Optional support for our children’s education. Donations do not include event admission.','price':100,'currency':'USD','available':1000000,'max_per_order':1,'product_type':'donation','allow_custom_amount':True}]}
theme={'colors':{'primary':'#194e3d','accent':'#dfbf75','surface':'#fffdf6','text':'#203b30','background':'#f6f4eb'},'wording':{},'layout':{},'page_config':{},'envelope_config':{'enabled':False}}
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(BUILD),**kw)
 def do_GET(self):
  if not (BUILD/self.path.split('?')[0].lstrip('/')).is_file():self.path='/index.html'
  super().do_GET()
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://localhost:{server.server_port}'
posts=[];errors=[];checks=[]
def check(name,ok=True):assert ok,name;checks.append(name)
def intercept(route):
 r=route.request;p=urlparse(r.url).path
 if not r.url.startswith(base):return route.abort()
 if not p.startswith('/api/'):return route.continue_()
 if r.method!='GET':
  posts.append(r.post_data_json)
  return route.fulfill(status=400,json={'detail':'Synthetic checkout captured; no payment created'})
 data=theme if p.endswith('/public-theme') else catalog if '/ticketing/public/events/' in p else event if '/api/invite/' in p else []
 route.fulfill(json=data)
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',intercept)
 def load(width):
  page.set_viewport_size({'width':width,'height':1000 if width>760 else 844})
  page.goto(base+f'/rsvp/modern-link?case={width}&preview={catalog["preview_mode"]}#/rsvp/register',wait_until='domcontentloaded')
  expect(page.get_by_role('button',name='Preview order' if catalog['preview_mode'] else 'Continue to secure checkout',exact=True)).to_be_visible()
 def fill():
  page.get_by_label('First name',exact=True).fill('Amina');page.get_by_label('Last name',exact=True).fill('Idris');page.get_by_label('Email address',exact=True).fill('buyer@example.invalid')
  for i in range(4):page.get_by_placeholder(f'Ticket {i+1} first name',exact=True).fill(f'Attendee {i+1}')
 for width in [1440,390,320]:
  load(width)
  check(f'no overflow at {width}',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  page.screenshot(path=str(OUT/f'Registration-{width}.png'),full_page=True)
  quantity=page.get_by_label('General Admission quantity',exact=True)
  if width==1440:
   quantity.fill('999');expect(quantity).to_have_value('10');expect(page.get_by_role('button',name='Add one General Admission')).to_be_disabled();check('quantity cap retained')
   quantity.fill('0');expect(page.get_by_role('button',name='Remove one General Admission')).to_be_disabled();check('zero quantity retained')
  for i in range(4):page.get_by_role('button',name='Add one General Admission').click()
  expect(quantity).to_have_value('4');check(f'quantity buttons work at {width}')
  summary=page.get_by_label('Order summary',exact=True);expect(summary).to_contain_text('$210.00');check(f'four tickets and 5 percent fee at {width}')
  page.get_by_label('Support Mumineen Academy amount',exact=True).fill('100');expect(summary).to_contain_text('$315.00');check(f'donation contributes to total at {width}')
  page.get_by_label('Support Mumineen Academy amount',exact=True).fill('');expect(summary).to_contain_text('$210.00')
  fill();page.get_by_label('Group or family request (optional)',exact=True).fill('Seat together if possible')
  check(f'populated form fits at {width}',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  page.screenshot(path=str(OUT/f'Registration-selected-{width}.png'),full_page=True)
  page.get_by_role('button',name='Preview order',exact=True).click();expect(page.get_by_role('status')).to_contain_text('Preview complete')
  check(f'preview creates no writes at {width}',not posts)
 # The live path still submits the existing payload, with no real transport.
 catalog['preview_mode']=False;load(1440);page.get_by_label('General Admission quantity',exact=True).fill('4');fill()
 page.get_by_role('button',name='Continue to secure checkout',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('Synthetic checkout captured')
 check('existing order endpoint payload retained',len(posts)==1 and posts[0]['buyer_name']=='Amina Idris' and posts[0]['lines'][0]['quantity']==4 and len(posts[0]['lines'][0]['attendees'])==4)
 check('donations not included without selection',len(posts[0]['lines'])==1)
 check('no JavaScript errors',not errors);browser.close()
server.shutdown();result={'passed':len(checks),'checks':checks,'errors':errors,'scope':'Isolated fixture data; no real orders, payments or messages'};(OUT/'validation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':len(checks),'errors':errors}))
