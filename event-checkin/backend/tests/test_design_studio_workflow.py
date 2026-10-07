import pytest
import httpx
from services.email_service import _theme_cover_url, _festio_email_shell
from app.routers import design_proxy


def test_email_cover_visibility_and_logo():
 theme={'cover_image_url':'https://example.test/cover.png','logo_image_url':'https://example.test/logo.png','image_settings':{'surfaces':{'email':False}}}
 assert _theme_cover_url(theme)==''
 html=_festio_email_shell('<p>Welcome</p>',theme=theme)
 assert 'https://example.test/logo.png' in html
 assert 'https://example.test/cover.png' not in html

@pytest.mark.asyncio
async def test_other_org_cannot_read_or_restore_versions(ctx,monkeypatch):
 def forbidden(*args,**kwargs):raise AssertionError('Upstream request must not happen')
 monkeypatch.setattr(design_proxy.httpx,'AsyncClient',forbidden)
 ctx.login(ctx.ids['user_b'])
 for method,suffix,payload in [('GET','versions',None),('POST','restore',{'version':1,'expected_revision':0})]:
  r=await ctx.client.request(method,f"/api/events/{ctx.ids['event_a']}/design/{suffix}",json=payload)
  assert r.status_code in (403,404)

@pytest.mark.asyncio
async def test_revision_forwarding_and_conflict_response(ctx,monkeypatch):
 calls=[]
 class Upstream:
  def __init__(self,*a,**k):pass
  async def __aenter__(self):return self
  async def __aexit__(self,*a):pass
  async def post(self,url,**kwargs):calls.append((url,kwargs));return httpx.Response(409,json={'detail':'Revision conflict'})
 monkeypatch.setattr(design_proxy.httpx,'AsyncClient',Upstream)
 ctx.login(ctx.ids['superadmin'])
 r=await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/design/restore",json={'version':1,'expected_revision':7})
 assert r.status_code==409 and r.json()['detail']=='Revision conflict'
 assert calls[0][1]['json']['expected_revision']==7

@pytest.mark.asyncio
async def test_upload_defers_attachment_for_revision_checked_editor(ctx,monkeypatch):
 calls=[]
 class Upstream:
  def __init__(self,*a,**k):pass
  async def __aenter__(self):return self
  async def __aexit__(self,*a):pass
  async def post(self,url,**kwargs):calls.append(kwargs);return httpx.Response(200,json={'public_url':'/stored.png'})
 monkeypatch.setattr(design_proxy.httpx,'AsyncClient',Upstream)
 ctx.login(ctx.ids['superadmin'])
 r=await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/design/assets?attach_to_design=false",files={'file':('image.png',b'fixture','image/png')})
 assert r.status_code==200
 assert calls[0]['params']=={'attach_to_design':'false'}
