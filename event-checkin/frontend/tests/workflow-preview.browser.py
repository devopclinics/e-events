import os,sys,tempfile,subprocess,time,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='workflow-preview-') as out:
 subprocess.run(['node',str(ROOT/'tests/workflow-preview-fixture.mjs')],cwd=ROOT,env={**os.environ,'WORKFLOW_PREVIEW_DIR':out},check=True)
 server=subprocess.Popen([sys.executable,'-m','http.server','9137','--directory',out],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  time.sleep(.5)
  with sync_playwright() as p:
   b=p.chromium.launch();page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for width in [1800,1440,1024,768,390]:
    page.set_viewport_size({'width':width,'height':1030});page.goto('http://127.0.0.1:9137');page.locator('.wf-cards>button').click();expect(page.locator('.wf-preview-frame')).to_be_visible()
    before=page.locator('.wf-preview-frame').bounding_box()
    for idx in [0,8,16,2,16]:
     page.locator('.wf-timeline>button').nth(idx).click();page.wait_for_timeout(750)
     frame=page.locator('.wf-preview-frame').bounding_box();assert abs(frame['width']/frame['height']-16/9)<.02
     assert abs(frame['height']-before['height'])<1 and abs(frame['y']-before['y'])<1,(width,frame,before)
     assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
     assert page.locator('.wf-scene').evaluate('el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll("main>*,header,footer")].every(c=>{const b=c.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1&&b.top>=r.top-1&&b.bottom<=r.bottom+1})}'),(width,idx)
    # Nested timeline scrolling must leave the slide in place.
    y=page.locator('.wf-preview-frame').bounding_box()['y'];page.locator('.wf-timeline').evaluate('el=>el.scrollTop=0');assert abs(page.locator('.wf-preview-frame').bounding_box()['y']-y)<1
    if width==1800:page.screenshot(path='/tmp/workflow-preview-fixed.png',full_page=True)
   assert not errors,errors
   b.close();print('PASS: stable 16:9 frame, unclipped slide content, independent timeline scrolling and no horizontal overflow at five viewport sizes')
 finally:server.terminate();server.wait()
