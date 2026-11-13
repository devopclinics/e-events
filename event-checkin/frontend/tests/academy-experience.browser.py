"""Isolated browser fixture; all API writes are intercepted and never reach Festio."""
import json,threading,re,io
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright,expect
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];OUT=Path('/home/dev/events/artifacts/clients/mumineen-academy/mumineen-academy-2026/live-giving-implementation-2026-11-13');OUT.mkdir(parents=True,exist_ok=True)
TOKEN='0a9bae4d-85e5-41dd-9fd8-5acea115b7b3'
class H(SimpleHTTPRequestHandler):
 def do_GET(self):
  if self.path.startswith('/experiences/'):
   self.directory=str(ROOT/'public');return super().do_GET()
  self.path=self.path if self.path in ['/app.css','/app.js'] else '/index.html';return super().do_GET()
 def log_message(self,*a):pass
 def __init__(self,*a,**kw):super().__init__(*a,directory='/tmp/academy-live-fixture',**kw)
srv=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=srv.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{srv.server_port}'
qr=io.BytesIO();Image.new('RGB',(32,32),'white').save(qr,format='PNG')
campaign=dict(token=TOKEN,event_name='Mumineen Academy Annual Fundraising Event',title='Invest in Their Future',description='Support a nurturing learning environment.',logo_url=None,goal_minor=30000000,currency='USD',confirmed_minor=5000,pledged_minor=3400000,donation_count=1,pledge_count=2,show_pledged_total=True,recent_public=[],funds=[],channels=[dict(type='offline',label='Cash / cheque',enabled=True),dict(type='pledge',label='Pledge',enabled=True)],pledge_payment_channels=[dict(type='offline',label='Cash / cheque')])
requests=[];errors=[];failure=0
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1440,'height':1100});page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.dismiss())
 def api(route):
  global failure
  req=route.request;path=req.url;requests.append((req.method,path,req.post_data_json if req.post_data else None))
  if path.endswith('/qr.png'):route.fulfill(status=200,content_type='image/png',body=qr.getvalue());return
  if '/auth/live-token' in path:v={'token':'fixture-only','expires_in':900}
  elif '/engagement/v1/displays/' in path:v={'id':'screen','settings':req.post_data_json['settings']}
  elif path.endswith('/donation-campaign'):v={**campaign,'id':'campaign','event_id':'74f334fd-ebaa-43dd-a998-2bd00a4564ae','public_token':TOKEN,'public_url':BASE+'/give/academy','enabled':True}
  elif path.endswith('/donations'):v=[]
  elif '/contributions' in path:v=dict(status='pending_verification',amount_minor=(req.post_data_json or {'amount_minor':25000})['amount_minor'],currency='USD',channel=(req.post_data_json or {'channel':'offline'})['channel'],reference='LOCAL-ONLY',access_token='fixture-contribution',instructions='Arrange payment with the organizer.')
  elif '/api/give/' in path:
   if failure:route.fulfill(status=failure,content_type='application/json',body='{}');return
   v=campaign if '/other' not in path else {**campaign,'event_name':'Another Event','token':'other'}
  else:raise AssertionError('Unexpected API '+path)
  route.fulfill(status=200,content_type='application/json',body=json.dumps(v))
 page.route('**/api/**',api);page.goto(BASE+'/give/'+TOKEN);expect(page.locator('.dg-academy')).to_be_visible();expect(page.get_by_role('link',name='Explore the vision')).to_be_visible()
 for width in [1440,1024,768,390,320]:
  page.set_viewport_size({'width':width,'height':1100});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  if width in [1440,390]:page.screenshot(path=str(OUT/f'giving-{width}.png'),full_page=True)
 # Preserve actual contribution submission and privacy choices in the isolated fixture.
 page.set_viewport_size({'width':1440,'height':1100});form=page.get_by_role('form',name='Give today',exact=True)
 form.get_by_role('button',name='$250',exact=True).click();form.get_by_placeholder('Your name').fill('Local Fixture');form.get_by_label('Give anonymously',exact=False).check()
 form.get_by_role('button',name='Record $250 gift →',exact=True).click();expect(page.get_by_text('LOCAL-ONLY',exact=True)).to_be_visible()
 body=next(r[2] for r in reversed(requests) if '/contributions' in r[1] and r[0]=='POST');assert body['amount_minor']==25000 and body['channel']=='offline' and body['contact_consent']==False and body['anonymous_publicly']==True
 page.goto(BASE+'/give/other');expect(page.locator('.dg-academy')).to_have_count(0);expect(page.get_by_role('link',name='Explore the vision')).to_have_count(0)
 page.goto(BASE+'/give/'+TOKEN+'/experience?mode=live');expect(page.locator('.ma-total')).to_have_text('$50');expect(page.locator('.ma-live-stats')).to_contain_text('$34,000');assert '$34,050' not in page.locator('body').inner_text()
 page.screenshot(path=str(OUT/'live-desktop.png'),full_page=True)
 # Advance a real polling cycle: public privacy-safe anonymous donation only.
 campaign.update(confirmed_minor=505000,donation_count=2,recent_public=[dict(id='public-new',name='Anonymous donor',amount_minor=None,kind='donation')])
 expect(page.locator('.ma-total')).to_have_text('$5,050',timeout=10000);expect(page.locator('.ma-spotlight')).to_contain_text('Anonymous donor');expect(page.locator('.ma-spotlight')).not_to_contain_text('$5,000')
 failure=503;expect(page.locator('.ma-connection')).to_contain_text('Updates interrupted',timeout=10000);expect(page.locator('.ma-total')).to_have_text('$5,050')
 failure=404;expect(page.locator('.ma-total')).to_have_count(0,timeout=10000);failure=0
 page.goto(BASE+'/give/'+TOKEN+'/experience?mode=vision');expect(page.locator('.ma-vision')).to_be_visible();page.get_by_role('button',name='Play the vision',exact=False).click();page.get_by_role('button',name='Pause the vision',exact=False).click();page.get_by_role('button',name='02 / Belong',exact=False).click();expect(page.locator('.ma-vision h1')).to_contain_text('More than classrooms')
 page.screenshot(path=str(OUT/'vision-desktop.png'),full_page=True)
 page.get_by_role('button',name='The reveal',exact=True).click();expect(page.locator('.ma-reveal')).to_be_visible();expect(page.locator('.ma-reveal-progress')).to_contain_text('$5,050');page.screenshot(path=str(OUT/'reveal-desktop.png'),full_page=True)
 for width in [390,320]:
  page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
 page.set_viewport_size({'width':1440,'height':900});page.goto(BASE+'/broadcast');expect(page.locator('.ma-reveal')).to_be_visible();bounds=page.locator('.ma-experience').bounding_box();assert abs(bounds['width']/bounds['height']-16/9)<0.01;assert float(page.locator('.ma-reveal h1').evaluate('e=>getComputedStyle(e).fontSize').replace('px',''))>40;page.screenshot(path=str(OUT/'broadcast-reveal.png'),full_page=True)
 page.goto(BASE+'/studio');expect(page.get_by_role('combobox',name='Giving presentation mode')).to_be_visible();page.get_by_role('combobox',name='Giving presentation mode').select_option('reveal');page.get_by_role('button',name='Display on screen',exact=True).click()
 page.wait_for_timeout(500)
 body=next(r[2] for r in reversed(requests) if '/engagement/v1/displays/screen' in r[1]);assert body['settings']['donation_token']==TOKEN and body['settings']['donation_presentation']=='reveal' and body['settings']['theme']=='festio'
 assert not errors,errors
 b.close()
srv.shutdown();print('PASS: scoped responsive giving page, existing offline submission, public real totals, pledge separation, privacy, live polling, stale updates, campaign removal, vision/reveal controls, organizer display payload, no JS errors')
