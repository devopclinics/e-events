import asyncio,json,os,socket,subprocess,tempfile,sys,time,urllib.request
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
TEMP=tempfile.TemporaryDirectory(prefix='certificate-workflow-browser-')
UI=Path(TEMP.name)
out=Path(os.environ.get('CERTIFICATE_TEST_EVIDENCE',str(UI/'evidence')));out.mkdir(parents=True,exist_ok=True)
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0));PORT=sock.getsockname()[1]
BASE=f'http://127.0.0.1:{PORT}'
subprocess.run(['node',str(ROOT/'tests/certificate-workflow-fixture.mjs')],cwd=ROOT,env={**os.environ,'CERTIFICATE_TEST_UI_DIR':str(UI)},check=True)
server=subprocess.Popen([os.environ.get('CERTIFICATE_TEST_PYTHON',sys.executable),str(ROOT.parent/'backend/tests/certificate_workflow_browser_server.py'),str(PORT),str(UI)],stdout=(UI/'server.log').open('w'),stderr=subprocess.STDOUT)
for attempt in range(100):
 try:
  urllib.request.urlopen(BASE+'/api/health',timeout=1);break
 except Exception:
  if server.poll() is not None:raise RuntimeError((UI/'server.log').read_text())
  time.sleep(.1)
else:raise RuntimeError('Local certificate fixture did not start')
async def main():
 errors=[];checks=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/dev/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args=['--no-sandbox'])
  admin=await b.new_page(viewport={'width':1440,'height':1100});admin.on('pageerror',lambda e:errors.append(str(e)))
  await admin.goto(BASE+'/studio',wait_until='domcontentloaded')
  await admin.get_by_role('heading',name='Participant certificates',exact=True).wait_for()
  for name in ['Royal Purple','Heritage Gold','Midnight Copper','Ivory Signature']:
   await admin.get_by_role('button',name=name+' Add / open style',exact=True).click()
   await expect(admin.locator('.cw-notice')).to_contain_text(name+' is ready')
  await admin.locator('.cw-template-options').get_by_label('Royal Purple',exact=True).check()
  await admin.locator('.cw-template-options').get_by_label('Midnight Copper',exact=True).check()
  await admin.get_by_role('button',name='Create client review link',exact=True).click()
  link=admin.get_by_label('New private certificate link');await expect(link).to_have_value(__import__('re').compile('/certificate-review/'))
  review=await link.input_value();client=await b.new_page(viewport={'width':390,'height':900});client.on('pageerror',lambda e:errors.append(str(e)))
  await client.goto(review,wait_until='domcontentloaded')
  await client.get_by_role('radio',name='Midnight Copper Choose this design',exact=True).check()
  await client.get_by_label('Your name',exact=True).fill('QA Client')
  await client.get_by_label('Notes for the organiser (optional)').fill('Please use this navy design.')
  for frame in client.frames[1:]:await frame.locator('.certificate').wait_for()
  await client.screenshot(path=str(out/'review-mobile.png'),full_page=True)
  await client.get_by_role('button',name='Confirm my design choice').click()
  await expect(client.get_by_role('heading',name='Your choice is recorded.')).to_be_visible()
  await client.reload();await expect(client.get_by_role('heading',name='Your choice is recorded.')).to_be_visible();checks.append('Client choice saved on server and restored in a fresh request')
  await admin.get_by_role('button',name='Refresh responses',exact=True).click()
  await expect(admin.get_by_text('Selected: Midnight Copper',exact=True)).to_be_visible()
  await admin.get_by_role('button',name='Open selected template',exact=True).click()
  await admin.get_by_label('Minimum sessions attended',exact=True).fill('0')
  await admin.get_by_role('button',name='Save design and rules',exact=True).click()
  await expect(admin.get_by_text('Certificate design saved and eligibility refreshed.',exact=True)).to_be_visible()
  await admin.get_by_label('Expected email (optional)',exact=True).fill('signer@example.test')
  await admin.get_by_label('Signatory role / request label',exact=True).fill('PAMAN President')
  await admin.get_by_role('button',name='Create private signing link',exact=True).click()
  await expect(link).to_have_value(__import__('re').compile('/certificate-sign/'))
  signing=await link.input_value();await client.goto(signing,wait_until='domcontentloaded')
  await client.get_by_label('Full name',exact=True).fill('QA Authorised Signatory')
  await client.get_by_label('Position / title',exact=True).fill('PAMAN President')
  await client.get_by_label('Email (as specified by the organiser)',exact=True).fill('signer@example.test')
  canvas=client.get_by_label('Draw your signature with a mouse or finger',exact=True);await canvas.scroll_into_view_if_needed();bounds=await canvas.bounding_box()
  await client.mouse.move(bounds['x']+25,bounds['y']+bounds['height']*.7);await client.mouse.down()
  for x,y in [(45,.2),(65,.8),(90,.3),(120,.65),(180,.45)]:await client.mouse.move(bounds['x']+x,bounds['y']+bounds['height']*y,steps=4)
  await client.mouse.up()
  await client.get_by_role('checkbox').check()
  for frame in client.frames[1:]:await frame.locator('.certificate').wait_for()
  await client.screenshot(path=str(out/'signature-mobile.png'),full_page=True)
  await client.get_by_role('button',name='Submit signature for approval',exact=True).click()
  await expect(client.get_by_role('heading',name='Your signature has been submitted.')).to_be_visible()
  await admin.get_by_role('button',name='Refresh responses',exact=True).click()
  await expect(admin.get_by_text('QA Authorised Signatory',exact=True)).to_be_visible()
  await expect(admin.get_by_role('button',name='Issue selected',exact=True)).to_be_disabled()
  await admin.get_by_role('button',name='Approve for certificates',exact=True).click()
  await expect(admin.get_by_role('button',name='Issue selected',exact=True)).to_be_enabled()
  checks.append('Phone-size canvas signature, consent, admin approval and issuance gate')
  await admin.screenshot(path=str(out/'studio-desktop.png'),full_page=True)
  await admin.get_by_role('button',name='Issue selected',exact=True).click()
  await expect(admin.get_by_text('Issued 1 certificate.',exact=True)).to_be_visible();checks.append('Local fixture participant certificate issued only after signature approval; no email')
  await admin.get_by_label('Search participants',exact=True).fill('participant@example.test')
  await admin.locator('.lc-candidates tbody input[type=checkbox]').check()
  await expect(admin.get_by_role('button',name='Issue selected',exact=True)).to_be_disabled()
  await admin.get_by_role('button',name='Issue & email',exact=True).click()
  await expect(admin.get_by_text('Issued 0 certificates; queued 1 certificate email.',exact=True)).to_be_visible()
  emails=(await admin.request.get(BASE+'/fixture-emails'));assert len(await emails.json())==1
  assert len(await (await admin.request.get(BASE+'/api/events/qa-event/certificates')).json())==1
  checks.append('Selecting an already issued participant and Issue & email sends the existing credential once; no duplicate certificate')
  for page in [admin,client]:assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
  await admin.set_viewport_size({'width':390,'height':900});await admin.screenshot(path=str(out/'studio-mobile.png'),full_page=True)
  assert not await admin.evaluate('document.documentElement.scrollWidth>innerWidth')
  assert not errors,errors
  (out/'browser-validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'scope':'Isolated localhost application with SQLite, real API and UI; no real guests or outbound providers'},indent=2));print(json.dumps({'checks':checks,'errors':errors}))
  await b.close()
try:asyncio.run(main())
finally:
 server.terminate();server.wait(timeout=10);TEMP.cleanup()
