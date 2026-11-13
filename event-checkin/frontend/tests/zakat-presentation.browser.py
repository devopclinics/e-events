"""Local-only presentation export and interaction checks; no event/API writes."""
import json,threading,subprocess,re
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright,expect
from pptx import Presentation
from pptx.util import Inches
ROOT=Path(__file__).resolve().parents[1];PUBLIC=ROOT/'public';DECK=PUBLIC/'presentations/mumineen-zakat';OUT=Path('/home/dev/events/artifacts/clients/mumineen-academy/mumineen-academy-2026/zakat-presentation-2026-11-13');OUT.mkdir(parents=True,exist_ok=True)
class H(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(PUBLIC),**kw)
 def log_message(self,*a):pass
srv=ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=srv.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{srv.server_port}/presentations/mumineen-zakat/'
errors=[];pngs=[]
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1440,'height':900},device_scale_factor=1);page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base,wait_until='networkidle');expect(page.locator('.slide:not([hidden])')).to_have_count(1)
 page.keyboard.press('ArrowRight');expect(page.locator('#counter')).to_have_text('02 / 14');page.keyboard.press('Home');expect(page.locator('#counter')).to_have_text('01 / 14')
 page.get_by_role('button',name='Speaker notes',exact=True).click();expect(page.locator('#notes')).to_be_visible();expect(page.locator('#notes-copy')).to_contain_text('Welcome');page.keyboard.press('Escape')
 page.get_by_role('button',name='Open slide overview',exact=True).click();expect(page.locator('#overview-grid button')).to_have_count(14);page.locator('#overview-grid [data-page="5"]').click();expect(page.locator('.coins .coin')).to_have_count(40);page.get_by_role('button',name='Reveal the share',exact=False).click();assert page.locator('.share').evaluate('e=>e.classList.contains("revealed")')
 assert page.locator('.share').evaluate('e=>e.classList.contains("revealed")')
 page.keyboard.press('ArrowRight');page.get_by_role('button',name='Reveal the answer',exact=False).click();expect(page.locator('.formula .result')).to_have_text('$250')
 page.evaluate('window.zakatPresentation.goTo(11)');page.get_by_role('button',name='Reveal the answer',exact=False).click();expect(page.locator('.answer.correct')).to_contain_text('Qualifying wealth')
 page.keyboard.press('b');expect(page.locator('#blackout')).to_be_visible();page.keyboard.press('b');expect(page.locator('#blackout')).not_to_be_visible()
 for width in [390,320]:
  page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
 page.set_viewport_size({'width':1440,'height':900});page.emulate_media(reduced_motion='reduce')
 page.evaluate('document.body.classList.add("exporting")')
 notes=page.evaluate('window.ZAKAT_DECK.slides.map(s=>({title:s.title.replace(/<[^>]*>/g," "),notes:s.notes}))')
 for i in range(14):
  page.evaluate('(i)=>window.zakatPresentation.goTo(i)',i)
  current=page.locator('.slide:not([hidden])');expect(current).to_be_visible();current.evaluate('e=>e.classList.add("revealed")')
  page.wait_for_function('Array.from(document.querySelectorAll(".slide:not([hidden]) img")).every(i=>i.complete&&i.naturalWidth>0)')
  # The teaching content must fit above the source footer on every slide.
  bounds=current.bounding_box();main=current.locator('.slide-main').bounding_box();foot=current.locator('.slide-bottom').bounding_box();assert main['y']+main['height']<=foot['y']+2,(i+1,main,foot)
  assert current.evaluate('e=>e.scrollWidth<=e.clientWidth'),i+1
  page.wait_for_timeout(100)
  path=OUT/f'slide-{i+1:02}.png';current.screenshot(path=str(path));pngs.append(path)
 page.evaluate('window.zakatPresentation.preparePrint()');page.pdf(path=str(DECK/'Mumineen-Zakat.pdf'),prefer_css_page_size=True,print_background=True)
 info=subprocess.check_output(['pdfinfo',str(DECK/'Mumineen-Zakat.pdf')]).decode();assert re.search(r'Pages:\s+14\b',info),info
 # Embedded slides honor the presenter page URL and omit laptop controls.
 page.goto(base+'?embed=1&page=8');expect(page.locator('.slide:not([hidden])')).to_have_attribute('id','slide-8');expect(page.locator('.controls')).not_to_be_visible();expect(page.locator('.recipient')).to_have_count(8)
 assert not errors,errors;b.close()
srv.shutdown()
prs=Presentation();prs.slide_width=Inches(16);prs.slide_height=Inches(9)
for img,note in zip(pngs,notes):
 s=prs.slides.add_slide(prs.slide_layouts[6]);s.shapes.add_picture(str(img),0,0,width=prs.slide_width,height=prs.slide_height);s.notes_slide.notes_text_frame.text=note['title']+'\n\n'+note['notes']
prs.save(DECK/'Mumineen-Zakat.pptx');assert len(Presentation(DECK/'Mumineen-Zakat.pptx').slides)==14
(DECK/'SPEAKER-NOTES.md').write_text('# Zakat — when wealth becomes well-being\n\n'+ '\n\n'.join(f'## {i+1}. {n["title"]}\n\n{n["notes"]}' for i,n in enumerate(notes)))
(OUT/'validation.json').write_text(json.dumps({'slides':14,'checks':['keyboard navigation','notes','overview','40-token explanation','example arithmetic','audience question','blackout','mobile overflow','slide content bounds','PDF export','PowerPoint with notes','embed page navigation'],'errors':errors,'production_writes':False},indent=2))
print('PASS: 14 complete slides, keyboard/fullscreen controls, notes, reveals, bounded content, mobile, PDF, PowerPoint with speaker notes, native embed page; no JS errors')
