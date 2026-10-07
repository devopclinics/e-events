"""Regression audit against built assets and an isolated HTTP fixture server.
Unlike request-routing tests, this exercises a real service worker and offline reload.
"""
from pathlib import Path
from types import SimpleNamespace
source=Path(__file__).with_name('guesthub-live.browser.py').read_text().split('with sync_playwright() as pw:')[0]
source=source.replace("if a['status']=='live'", "if a['status'] in ['live','paused','closed']")
exec(compile(source,str(Path(__file__).with_name('guesthub-live.browser.py')),'exec'))
server.shutdown()
class FixtureHandler(Handler):
 def api(self):
  handler=self
  class Route:
   request=SimpleNamespace(url=BASE+handler.path,method=handler.command,post_data_json=json.loads(handler.rfile.read(int(handler.headers.get('Content-Length',0))) or '{}'))
   def fulfill(self,status=200,body='',content_type='application/json',headers=None):
    data=body.encode() if isinstance(body,str) else body
    handler.send_response(status);handler.send_header('Content-Type',content_type);handler.send_header('Content-Length',str(len(data)));handler.end_headers();handler.wfile.write(data)
   def abort(self):self.fulfill(status=403,body='Blocked test request')
  intercept(Route())
 def do_GET(self):
  if self.path.startswith('/api/'):return self.api()
  super().do_GET()
 def do_POST(self):self.api()
server=ThreadingHTTPServer(('127.0.0.1',0),FixtureHandler);threading.Thread(target=server.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{server.server_port}'
state['forms']=[dict(id='f1',revision_id='r1',version=1,title='Event participation',body='Fixture wording',guest_id='parent',guest_name='Amina Idris',on_behalf=False,status='pending',required=True,timing='before_arrival',can_submit=True,kind='consent',questions=[])]
state['journey']['consent']=dict(required=True,signed=False,form=dict(id='legacy',title='Existing check-in consent',body='Retained requirement',version=1))
state['journey']['steps']=[dict(id='badge',title='Print badge',type='badge',status='available',self_service=False)]
base_date=datetime(2026,12,24,14,0,tzinfo=timezone.utc)
schedule=[dict(step_id=f'slot{i}',title=f'DEMO · Group {i%5} · Workshop',room=f'Room {i%5}',age_groups=[f'Group {i%5}'],starts_at=iso(base_date+timedelta(minutes=(i//5)*30)),ends_at=iso(base_date+timedelta(minutes=(i//5+1)*30)),description='DEMO DRAFT: fixture source notes') for i in range(80)]
state['journey']['program']['days']=[dict(date='2026-12-24',label='December 24',segments=schedule)]
state['journey']['program']['next_segments']=schedule
state['journey']['program'].update(viewer_id='parent',audiences=[dict(guest_id='parent',name='Amina Idris',age_group='Adult',is_self=True),dict(guest_id='child',name='Sara Idris',age_group='Group 2',is_self=False)])
state['qa']['qa']=[dict(id='existing',text='An existing question',status='approved',upvote_count=0,upvoted_by_me=False)]
next(a for a in state['activities'] if a['id']=='qa')['status']='paused'
with sync_playwright() as pw:
 engine=os.environ.get('FESTIO_APP_BROWSER','chromium');opts={'headless':True}
 if engine!='webkit':opts['args']=['--no-sandbox']
 if engine=='edge':opts['executable_path']=os.environ['FESTIO_EDGE_EXECUTABLE']
 browser=(pw.webkit if engine=='webkit' else pw.chromium).launch(**opts)
 c=browser.new_context(viewport={'width':390,'height':844});page=c.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(12000)
 def go(screen):page.goto(BASE+'/r/demo-token#/'+screen);page.locator('.fh-event-app').wait_for();page.wait_for_timeout(300)
 go('programme');page.locator('.pg-time-group').first.wait_for();check('80 sessions grouped into 16 time blocks',page.locator('.pg-time-group').count()==16);check('only one time block initially open',page.locator('.pg-time-group[open]').count()==1);check('large programme remains compact',page.evaluate('document.documentElement.scrollHeight')<6000)
 check('next skips simultaneous sessions','9:30' in page.locator('.pg-next').inner_text())
 check('self view has no duplicate selector',page.get_by_label('Show programme for',exact=True).count()==0)
 page.get_by_role('button',name='My family',exact=True).click();page.get_by_label('Show programme for',exact=True).wait_for();check('family selector appears only for family');page.get_by_role('button',name='All programmes',exact=True).click()
 page.get_by_label('Filter programme by room').select_option('Room 2');check('room filter narrows all cards',page.locator('.pg-title').count()==16);check('featured session respects room filter','Room 2' in page.locator('.pg-spotlight').inner_text())
 page.get_by_role('button',name='Collapse all times').click();page.wait_for_timeout(150);check('collapse all works',page.locator('.pg-time-group[open]').count()==0)
 page.get_by_role('button',name='Jump to next time').click();check('jump opens a time block',page.locator('.pg-time-group[open]').count()==1)
 page.evaluate('scrollTo(0,0)');page.screenshot(path=str(OUT/'Programme-grouped-phone.png'),full_page=True)
 page.get_by_label('Filter programme by room').select_option('all');page.get_by_label('Filter programme by age group').select_option('Group 3');check('age group filter retains matching sessions',page.locator('.pg-title').count()==16)
 go('home');check('far-future countdown uses days','days' in page.locator('.up-next .starts').inner_text());check('adult status omits pickup placeholder','Room / pickup status unavailable' not in page.inner_text('body'))
 go('experience');page.locator('.forms-item').wait_for();check('published forms not mixed with legacy consent',page.get_by_placeholder('Type your full name to sign Existing check-in consent').count()==0 and 'Print badge' not in page.locator('main').inner_text());page.get_by_role('button',name='Review check-in consent').click();page.get_by_placeholder('Type your full name to sign Existing check-in consent').wait_for();check('legacy requirement remains accessible');check('staff checklist gives actionable explanation','Event staff complete this step.' in page.locator('main').inner_text())
 go('live');page.get_by_role('button',name='View questions →').click();page.get_by_text('Questions are paused by the organizer.',exact=False).wait_for();check('paused QA explains missing composer',page.get_by_label('Your question',exact=True).count()==0);check('paused QA prevents upvotes',page.get_by_role('button',name='Upvote question; 0 votes').is_disabled());page.screenshot(path=str(OUT/'Paused-QA-phone.png'),full_page=True)
 go('live');page.locator('.gl-feature').wait_for();check('phone activity action within first viewport',page.locator('.gl-feature button').bounding_box()['y']<650);page.get_by_role('button',name='Search & filter activities').click();page.get_by_placeholder('Search activities…').fill('Learning');check('search still works','Learning' in page.locator('.gl-qa').inner_text());page.screenshot(path=str(OUT/'Live-phone.png'),full_page=True)
 menu=copy.deepcopy(menu_categories[-1]);menu.update(display_only=True,day_label='2026-12-24');state['meal_tickets']['demo-parent-qr']['menu_categories']=[menu]
 go('meals');page.locator('.vm-dish').wait_for();check('menu-only wording does not promise ordering','Choosing meals' not in page.locator('main').inner_text() and 'make each meal yours' not in page.locator('main').inner_text());check('readable meal dates',page.locator('.vm-days').inner_text().replace(',','')=='Thu 24 Dec');check('display menu cannot submit',page.locator('.vm-save-form').count()==0)
 if os.environ.get('FESTIO_REVIEW_OFFLINE')=='0':
  check('no JavaScript errors',not errors)
  (OUT/'validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'browser':engine,'scope':'Online UI checks only. Offline reload unverified: WebKit internal error also reproduced with an independent minimal service worker.'},indent=2));print(json.dumps({'passed':len(checks),'errors':errors,'offline':'unverified'}));browser.close();server.shutdown();raise SystemExit(0)
 # Real worker, no route interception, explicit offline credential saving.
 go('pass');page.get_by_role('button',name='Save pass offline',exact=True).click();page.get_by_text('Available offline on this device',exact=True).wait_for(timeout=25000);page.wait_for_function('navigator.serviceWorker.controller !== null');check('offline readiness confirmed after saving')
 page.locator('#app-member').select_option('child');page.get_by_role('button',name='Save pass offline',exact=True).click();page.get_by_text('Available offline on this device',exact=True).wait_for();c.set_offline(True);page.reload(wait_until='domcontentloaded');page.get_by_role('heading',name='Your saved passes').wait_for();check('pass reload works offline');check('both explicitly saved passes available',page.locator('#person option').count()==2);check('offline reload preserves selected child pass',page.locator('#person').input_value()=='child');page.locator('#person').select_option('child');check('offline child pass retains guardian guidance','authorized guardian' in page.locator('#junior').inner_text());check('offline QR decodes',page.locator('#qr').evaluate('(e)=>e.complete&&e.naturalWidth>0'));page.screenshot(path=str(OUT/'Offline-pass-phone.png'),full_page=True)
 page.goto(BASE+'/?guesthub=1',wait_until='domcontentloaded');page.get_by_role('heading',name='Your saved passes').wait_for();check('installed app start URL works offline')
 page.get_by_role('button',name='Remove saved passes',exact=True).click();page.get_by_text('Saved passes removed from this device.',exact=True).wait_for();page.reload(wait_until='domcontentloaded');page.get_by_role('heading',name='Connect to open GuestHub').wait_for();check('removal clears installed offline copy');page.goto(BASE+'/r/demo-token#/pass',wait_until='domcontentloaded');page.get_by_role('heading',name='Connect to open GuestHub').wait_for();check('removal clears personal offline copy')
 c.set_offline(False);page.get_by_role('button',name='Try again',exact=True).click();page.locator('.fh-event-app').wait_for();page.get_by_role('button',name='Save pass offline',exact=True).click();page.get_by_text('Available offline on this device',exact=True).wait_for();page.evaluate('''async()=>{const c=await caches.open('festio-offline-pass-pages-v1');for(const key of await c.keys()){const r=await c.match(key);const h=new Headers(r.headers);h.set('X-Festio-Expires','1');await c.put(key,new Response(await r.text(),{headers:h}));}}''');c.set_offline(True);page.reload(wait_until='domcontentloaded');page.get_by_role('heading',name='Connect to open GuestHub').wait_for();check('expired copy never displayed')
 check('no JavaScript errors',not errors);check('no real service writes',not posts)
 (OUT/'validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'browser':engine,'scope':'Local HTTP API fixtures with real service worker; no live guest changes'},indent=2));print(json.dumps({'passed':len(checks),'errors':errors}));browser.close()
server.shutdown()
