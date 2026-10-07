import base64,io
import pytest
from PIL import Image
from app.render import build_flyer_html,render_flyer
from app.flyer_modern import FIT_SCRIPT,SIZES
from playwright.async_api import async_playwright
from test_studio_revisions import client,P
from app.routers import design

def ctx(layout='editorial'):
 im=io.BytesIO();Image.new('RGB',(80,80),'green').save(im,format='PNG')
 return dict(composition=layout,flyerSettings={'palette':'forest'},fontPairing='classic-serif',wording={'eventTitle':'IEDPU USA 3rd Biennial Convention','eventSubtitle':'A gathering of family, heritage & community.','date':'November 26–28, 2026','venue':'Wyndham Hotel','address':'Irving, Texas','rsvpNote':'Join IEDPU members, families and invited guests.','footerMessage':'Our heritage. Our people. Our future.'},logoImageUrl='data:image/png;base64,'+base64.b64encode(im.getvalue()).decode(),qr={'enabled':True,'data':'https://festio.events/invite/test-event'})

def test_route_keeps_composition_logo_and_saved_settings(client,monkeypatch):
 captured={}
 async def render(c,*args):captured.update(c);return b'png'
 monkeypatch.setattr(design,'render_flyer',render)
 saved=client.put(P,json={'asset_config':{'flyer_settings':{'composition':'brand-led','palette':'navy'},'logo_image_url':'https://example.test/logo.png'}}).json()
 assert client.post(P+'/render/flyer',json={'preview':True}).status_code==200
 assert captured['composition']=='brand-led' and captured['flyerSettings']['palette']=='navy'
 assert captured['logoImageUrl']=='https://example.test/logo.png'
 client.post(P+'/render/flyer',json={'preview':True,'composition':'editorial','logo_image_url':None,'flyer_settings':{'palette':'clay'}})
 assert captured['composition']=='editorial' and captured['logoImageUrl'] is None
 assert client.post(P+'/render/flyer',json={'composition':'bad'}).status_code==400
 client.post(P+'/publish',json={'expected_revision':saved['revision']})
 assert client.get(P).json()['published_snapshot']['asset_config']['flyer_settings']['composition']=='brand-led'

def test_escape_and_artwork_only():
 c=ctx();c['wording']['eventTitle']='<script>alert(1)</script>';html=build_flyer_html(c,'portrait');assert '<script>' not in html
 c['composition']='artwork-only';c['coverImageUrl']=c['logoImageUrl'];html=build_flyer_html(c,'portrait');body=html.split('<body>')[1];assert 'Registration QR' not in body and 'poster-title' not in body and 'finished-art' in body
 c['coverImageUrl']=None
 with pytest.raises(ValueError):build_flyer_html(c,'portrait')

@pytest.mark.asyncio
async def test_real_compositions_fit_all_formats_and_qr_positions():
 async with async_playwright() as p:
  b=await p.chromium.launch(args=['--no-sandbox'])
  try:
   for layout in ['editorial','brand-led']:
    for size,(w,h) in SIZES.items():
     page=await b.new_page(viewport={'width':w,'height':h});c=ctx(layout)
     c['wording']['eventTitle']='IEDPU USA 3rd Biennial Convention — Bringing Our Community Together Across Generations'
     await page.set_content(build_flyer_html(c,size));await page.evaluate(FIT_SCRIPT)
     assert await page.locator('.poster-title').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
     assert await page.locator('.qr img').count()==1
     await page.close()
   page=await b.new_page(viewport={'width':1080,'height':1350})
   for position in ['bottom-left','bottom-right','center-bottom']:
    c=ctx();c['qr']['position']=position;await page.set_content(build_flyer_html(c,'portrait'));await page.evaluate(FIT_SCRIPT)
    box=await page.locator('.qr').bounding_box()
    assert (box['x']<150 if position=='bottom-left' else box['x']>800 if position=='bottom-right' else abs(box['x']+box['width']/2-540)<5)
  finally:await b.close()

@pytest.mark.asyncio
async def test_real_png_and_pdf_outputs():
 png=await render_flyer(ctx(),'square','png');assert Image.open(io.BytesIO(png)).size==(1080,1080)
 pdf=await render_flyer(ctx(),'a4','pdf');assert pdf.startswith(b'%PDF')
