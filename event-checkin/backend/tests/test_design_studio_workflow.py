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

@pytest.mark.asyncio
@pytest.mark.parametrize("edit_draft", [False, True, "stale"])
async def test_simple_invitation_import_is_read_only_and_publication_preserves_identity(ctx, monkeypatch, edit_draft):
 from copy import deepcopy
 from conftest import _Session
 from app.models import Event, Guest
 from sqlalchemy import select, func
 async with _Session() as db:
  event=await db.get(Event,ctx.ids['event_a'])
  event.is_paid=True;event.plan_tier='tier50'
  event.invite_message='Original message'
  event.setup_preferences={'quick_invite':{'style':'gala','colour':'midnight','envelope':True,'host_name':'Our family','creator_email':'private@example.com','creator_phone':'private'}}
  token=event.rsvp_token
  await db.commit()
 state={'event_id':ctx.ids['event_a'],'revision':0,'theme_config':{},'wording_config':{},'asset_config':{}}
 writes=[]
 class Upstream:
  def __init__(self,*a,**k):pass
  async def __aenter__(self):return self
  async def __aexit__(self,*a):pass
  async def get(self,url,**kw):return httpx.Response(200,json=deepcopy(state))
  async def put(self,url,**kw):
   writes.append(('save',kw['json']));state.update(kw['json']);state['revision']+=1
   return httpx.Response(200,json=deepcopy(state))
  async def post(self,url,**kw):
   writes.append(('publish',kw['json']));state['published_snapshot']=deepcopy(state);state['is_published']=True
   return httpx.Response(200,json={'published_version':1,'is_published':True})
 monkeypatch.setattr(design_proxy.httpx,'AsyncClient',Upstream)
 ctx.login(ctx.ids['superadmin'])
 path=f"/api/events/{ctx.ids['event_a']}/design"
 initial=await ctx.client.get(path)
 assert initial.status_code==200,initial.text
 imported=initial.json()
 assert imported['theme_config']['quickInvitation']['style']=='gala'
 assert imported['theme_config']['colors']['background']=='#191b32'
 assert 'private@example.com' not in initial.text and 'creator_phone' not in initial.text
 assert not writes
 # Explicitly save a different draft; the public invitation still stays original.
 if edit_draft:
  draft=deepcopy(imported);draft['wording_config']['customMessage']='Published message'
  draft['theme_config']['quickInvitation']['style']='botanical'
  assert (await ctx.client.put(path,json=draft)).status_code==200
 async with _Session() as db:
  event=await db.get(Event,ctx.ids['event_a']);assert event.invite_message=='Original message'
 if edit_draft=='stale':
  async with _Session() as db:
   event=await db.get(Event,ctx.ids['event_a']);event.setup_preferences={**event.setup_preferences,'quick_invite':{**event.setup_preferences['quick_invite'],'invitation_revision':1}}
   await db.commit()
 result=await ctx.client.post(path+'/publish',json={'expected_revision':state['revision']})
 if edit_draft=='stale':
  assert result.status_code==409,result.text
  assert not any(kind=='publish' for kind,_ in writes)
  return
 assert result.status_code==200,result.text
 async with _Session() as db:
  event=await db.get(Event,ctx.ids['event_a'])
  assert event.invite_message==('Published message' if edit_draft else 'Original message')
  assert event.setup_preferences['quick_invite']['style']==('botanical' if edit_draft else 'gala')
  assert event.setup_preferences['quick_invite']['creator_email']=='private@example.com'
  assert event.rsvp_token==token
  assert await db.scalar(select(func.count()).select_from(Guest).where(Guest.event_id==event.id))==1


def test_existing_studio_draft_is_not_replaced_silently_and_contacts_never_import():
 from types import SimpleNamespace
 from datetime import datetime
 event=SimpleNamespace(name='New name',event_date=datetime(2027,1,1),timezone='UTC',venue_name='Garden',invite_message='New note',setup_preferences={'quick_invite':{'style':'gala','colour':'rose','invitation_revision':1,'creator_email':'private@example.com'}})
 record={'revision':7,'theme_config':{'quickInvitation':{'style':'arch','source_revision':0}},'wording_config':{'customMessage':'Old draft'}}
 result=design_proxy.invitation_design(event,record)
 assert result['theme_config']==record['theme_config']
 assert result['invitation_source_changed']
 assert result['current_invitation_design']['theme_config']['quickInvitation']['style']=='gala'
 assert 'private@example.com' not in str(result)
 assert record['wording_config']['customMessage']=='Old draft'
