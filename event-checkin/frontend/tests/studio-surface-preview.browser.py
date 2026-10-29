"""Built guest pages with envelopes enabled; isolated transport and no guest writes."""
import copy,json,os,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
BUILD=Path(os.environ.get('FESTIO_APP_BUILD','/tmp/envelope-release-dist'));OUT=Path(os.environ.get('FESTIO_APP_ARTIFACTS','/tmp/studio-surface-preview-evidence'));OUT.mkdir(parents=True,exist_ok=True)
event={'id':'surface-demo','name':'Academy Preview','event_date':'2026-12-13T14:00:00Z','timezone':'America/Chicago','rsvp_enabled':True,'invite_mode':'open','rsvp_landing_layout':'welcome','guest_hub_layout':'classic','experience_enabled':False,'questions':[]}
theme={'colors':{'primary':'#194e3d','accent':'#dfbf75','surface':'#fffdf6','text':'#203b30','background':'#f6f4eb'},'wording':{},'layout':{},'page_config':{},'envelope_config':{'enabled':True,'frequency':'always','use_default':True,'appearance':{'style':'wax','palette':'ivory','seal':'gold','initials':'MA'}}}
checks=[];errors=[];writes=[]
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(BUILD),**kw)
 def do_GET(self):
  if not (BUILD/self.path.split('?')[0].lstrip('/')).is_file():self.path='/index.html'
  super().do_GET()
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://localhost:{server.server_port}'
def route(r):
 if not r.request.url.startswith(base):return r.abort()
 path=urlparse(r.request.url).path
 if not path.startswith('/api/'):return r.continue_()
 if r.request.method!='GET':writes.append(path);return r.fulfill(status=400,json={'detail':'No writes allowed'})
 data=theme if path.endswith('/public-theme') else event if path.startswith('/api/invite/') else {'enabled':False,'tickets':[]} if '/ticketing/' in path else []
 r.fulfill(json=copy.deepcopy(data))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome');page=b.new_page();page.route('**/*',route);page.on('pageerror',lambda e:errors.append(str(e)))
 for width in [1440,390]:
  page.set_viewport_size({'width':width,'height':1000 if width==1440 else 844})
  for layout in ['classic','companion','journey','complete','app']:
   theme['page_config']={'experience':{'guestHubLayout':layout,'rsvpLayout':'welcome'}}
   page.goto(base+f'/invite/surface-demo?studio-preview=1&studio-surface=hub&case={layout}-{width}',wait_until='networkidle')
   expect(page.locator('body')).to_contain_text('Academy Preview');assert not page.locator('.inv-opening').count();assert not page.locator('.rsvp-welcome').count();assert page.locator('#guest-hub, .complete-shell, .gh-app, .guesthub-shell, .complete-event-screen').count() or 'Programme' in page.locator('body').inner_text() or 'My Pass' in page.locator('body').inner_text()
   checks.append(f'{width}px {layout} GuestHub bypasses envelope');page.screenshot(path=str(OUT/f'hub-{layout}-{width}.png'))
  page.goto(base+f'/invite/surface-demo?studio-preview=1&studio-surface=rsvp&focus=hero&case={width}',wait_until='networkidle');expect(page.locator('.rsvp-welcome')).to_be_visible();assert not page.locator('.inv-opening').count();checks.append(f'{width}px Event Page renders landing page');page.screenshot(path=str(OUT/f'event-page-{width}.png'))
 for query,name in [('', 'public invitation still opens envelope'),('?envelope-preview=1','explicit envelope preview remains available'),('?studio-preview=1&envelope-preview=1','explicit studio envelope preview remains available')]:
  page.goto(base+'/invite/surface-demo'+query,wait_until='networkidle');expect(page.locator('.inv-opening')).to_be_visible();checks.append(name)
 assert not errors,errors;assert not writes,writes;b.close()
server.shutdown();(OUT/'validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'writes':writes},indent=2));print(json.dumps({'passed':len(checks),'errors':errors,'writes':writes}))
