"""Checks native presenter controls with intercepted local-only display updates."""
import json,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright,expect
class H(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory='/tmp/zakat-presenter-fixture',**kw)
 def log_message(self,*a):pass
srv=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=srv.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{srv.server_port}';updates=[];errors=[]
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 def route(r):
  url=r.request.url
  if '/presenter-materials' in url:data=[{'id':'zakat','title':'Zakat — when wealth becomes well-being','status':'approved','kind':'slides','source_type':'link','visibility':'production','metadata':{},'source_url':base+'/presentations/mumineen-zakat/'}]
  elif '/auth/live-token' in url:data={'token':'local-only','expires_in':900}
  elif '/engagement/v1/displays/screen' in url:updates.append(r.request.post_data_json);data={'id':'screen'}
  else:raise AssertionError(url)
  r.fulfill(status=200,content_type='application/json',body=json.dumps(data))
 page.route('**/api/**',route);page.goto(base);page.get_by_role('button',name='Present',exact=True).click();expect(page.get_by_text('Page 1',exact=True)).to_be_visible();assert updates[-1]['settings']['presentation']['url'].endswith('?embed=1&page=1')
 page.get_by_role('button',name='Next →',exact=True).click();expect(page.get_by_text('Page 2',exact=True)).to_be_visible();assert updates[-1]['settings']['presentation']['url'].endswith('?embed=1&page=2')
 page.get_by_role('button',name='← Previous',exact=True).click();expect(page.get_by_text('Page 1',exact=True)).to_be_visible();expect(page.get_by_role('button',name='← Previous',exact=True)).to_be_disabled()
 for i in range(13):page.get_by_role('button',name='Next →',exact=True).click();expect(page.get_by_text(f'Page {i+2}',exact=True)).to_be_visible()
 expect(page.get_by_role('button',name='Next →',exact=True)).to_be_disabled();page.get_by_role('button',name='Blackout',exact=True).click();assert updates[-1]['settings']['presentation']['blackout']==True;assert updates[-1]['settings']['presentation']['total_pages']==14
 assert not errors,errors;b.close()
srv.shutdown();print('PASS: native Present/Next/Previous/Blackout drive the correct embedded Zakat slide; first/last bounds work; no external writes or JS errors')
