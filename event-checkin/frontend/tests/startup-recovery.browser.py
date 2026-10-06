"""Exercise entry-bundle failures before React can install its error boundary."""
import json,os,tempfile,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];BUILD=Path(os.environ.get('FESTIO_APP_BUILD',ROOT/'dist'));OUT=Path(os.environ.get('FESTIO_STARTUP_ARTIFACTS',tempfile.mkdtemp(prefix='festio-startup-')));OUT.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(BUILD),**kw)
 def do_GET(self):
  if not (BUILD/self.path.split('?')[0].lstrip('/')).is_file():self.path='/index.html'
  super().do_GET()
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{server.server_port}'
checks=[]
def check(name,ok=True):assert ok,name;checks.append(name)
with sync_playwright() as p:
 engine=os.environ.get('FESTIO_STARTUP_BROWSER','chromium');options={'headless':True}
 if engine!='webkit':options['args']=['--no-sandbox']
 if engine=='edge':options['executable_path']='/tmp/festio-browser-runtime/edge/opt/microsoft/msedge/msedge'
 b=(p.webkit if engine=='webkit' else p.chromium).launch(**options)
 for scenario in ['normal','once','persistent','no-storage','offline','runtime-error']:
  c=b.new_context(viewport={'width':390,'height':844},service_workers='block');page=c.new_page();page.set_default_timeout(12000);attempts=[]
  if scenario=='no-storage':c.add_init_script("Object.defineProperty(window,'sessionStorage',{get(){throw new Error('Storage disabled')}})")
  if scenario=='offline':c.add_init_script("Object.defineProperty(navigator,'onLine',{get(){return false}})")
  def route(r):
   url=r.request.url
   if '/assets/index-' in url and url.endswith('.js'):
    attempts.append(url)
    if scenario=='runtime-error':return r.fulfill(content_type='application/javascript',body="throw new Error('Startup test failure')")
    if scenario in ['persistent','no-storage','offline'] or scenario=='once' and len(attempts)==1:return r.fulfill(status=404,body='missing',content_type='text/plain')
   if '/api/' in url:return r.fulfill(status=200,content_type='application/json',body='{}')
   if not url.startswith(BASE):return r.abort()
   return r.continue_()
  c.route('**/*',route);page.goto(BASE,wait_until='load')
  if scenario in ['normal','once']:
   page.locator('#festio-startup').wait_for(state='detached');page.wait_for_function('document.body.innerText.length>100');check(scenario+' mounts app',len(page.locator('body').inner_text())>100);check(scenario+' clears retry marker',page.evaluate("sessionStorage.getItem('festio:startup-recovery')") is None)
   if scenario=='once':check('missing entry automatically retries once',len(attempts)==2)
  elif scenario=='persistent':
   page.get_by_text('Festio could not load the latest app files.',exact=False).wait_for();check('persistent failure has bounded automatic retries',len(attempts)==3)
   page.get_by_role('button',name='Reload Festio',exact=True).wait_for();check('persistent failure provides recovery instead of blank',len(page.locator('body').inner_text())>20)
   check('recovery fits phone',page.evaluate('document.documentElement.scrollWidth<=innerWidth'));page.screenshot(path=str(OUT/'phone-recovery.png'))
  else:
   page.get_by_role('button',name='Reload Festio',exact=True).wait_for();check(scenario+' remains readable without reload loop',len(attempts)==1 and len(page.locator('body').inner_text())>20)
   if scenario=='offline':check('offline explains reconnection','offline' in page.locator('body').inner_text())
  c.close()
 (OUT/'validation.json').write_text(json.dumps({'browser':engine,'version':b.version,'checks':checks,'scope':'Built app with isolated API responses and simulated asset/network failures'},indent=2));print(json.dumps({'browser':engine,'passed':len(checks)}));b.close()
server.shutdown()
