import os,sys,subprocess,tempfile,time,json,csv,io
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
rows=[dict(id=str(i),guest_id=g,guest_name=name,email='person@example.test',template_name=template,certificate_number=f'CERT-{i}',status=status,issued_at='2026-11-13T12:00:00',sent_at='2026-11-13T12:01:00' if i==0 else None,viewed_at='2026-11-13T12:02:00' if i==0 else None,document_url='/document.pdf',verification_url='https://example.test/verify') for i,(g,name,template,status) in enumerate([('g1','=TEST()','Participation','issued'),('g1','=TEST()','Speaker','issued'),('g2','Revoked Person','Participation','revoked')])]
with tempfile.TemporaryDirectory(prefix='certificate-results-') as out:
 subprocess.run(['node',str(ROOT/'tests/certificate-results-fixture.mjs')],cwd=ROOT,env={**os.environ,'CERTIFICATE_RESULTS_DIR':out},check=True)
 server=subprocess.Popen([sys.executable,'-m','http.server','9141','--directory',out],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  time.sleep(.5)
  with sync_playwright() as p:
   b=p.chromium.launch();page=b.new_page(viewport={'width':1280,'height':900},accept_downloads=True)
   page.route('**/fixture-report',lambda route:route.fulfill(json={'rows':rows,'summary':{}}));page.goto('http://127.0.0.1:9141')
   metrics=page.locator('.er-certificate-metrics article')
   expect(metrics.filter(has_text='Certificates issued').locator('strong')).to_have_text('2')
   expect(metrics.filter(has_text='Recipients').locator('strong')).to_have_text('1')
   expect(metrics.filter(has_text='Without an active certificate').locator('strong')).to_have_text('3')
   expect(page.get_by_text('Email queued records',exact=False)).to_be_visible()
   page.get_by_label('Search certificates',exact=True).fill('Speaker');expect(page.locator('tbody tr')).to_have_count(1)
   with page.expect_download() as d:page.get_by_role('button',name='Export certificates CSV').click()
   content=Path(d.value.path()).read_text(encoding='utf-8-sig');parsed=list(csv.reader(io.StringIO(content)));assert len(parsed)==2 and parsed[1][0]=="'=TEST()" and parsed[1][2]=='Speaker'
   page.get_by_label('Search certificates',exact=True).fill('');page.get_by_label('Certificate status',exact=True).select_option('revoked');expect(page.locator('tbody tr')).to_have_count(1)
   page.set_viewport_size({'width':390,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   page.route('**/fixture-report',lambda route:route.fulfill(status=503,body='unavailable'));page.get_by_role('button',name='Refresh certificate results').click();expect(page.get_by_role('alert')).to_contain_text('could not be loaded');expect(page.locator('.er-certificate-metrics')).to_have_count(0)
   b.close();print('PASS certificate Results: distinct recipient coverage, revocations, search, filtered safe CSV, mobile containment and error state')
 finally:server.terminate();server.wait()
