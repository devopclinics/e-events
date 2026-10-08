import pytest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from app.routers import public_sites as sites
from app.models import Event
from conftest import _Session

@pytest.mark.asyncio
async def test_guesthub_recovery_is_separate_from_festiome(ctx):
 async with _Session() as db:
  event=await db.get(Event,ctx.ids['event_a']);event.rsvp_enabled=True;event.rsvp_token='public-demo';event.festiome_addon_enabled=True;event.festiome_open_url='/festiome?group=demo';event.checkin_base_url='https://example.com';await db.commit()
  values=await sites._website_connections(event,db)
  assert values['guesthub']['url']=='https://example.com/rsvp/public-demo?recover=1'
  assert values['festiome']['url']=='https://example.com/festiome?group=demo'
  assert values['guesthub']['label']!='FestioMe'

def test_section_picker_preserves_destination_and_disables_absent_sections():
 content={'visible_sections':['programme'],'faqs':[{'question':'Where?','answer':'Here'}],'navigation':[{'id':'faq','destination_type':'section','url':'#faq','enabled':True},{'id':'speakers','destination_type':'section','url':'#speakers','enabled':True}]}
 result=sites._resolve_navigation(content,{'section':{'url':'#programme','available':True}})
 assert result['navigation'][0]['url']=='#faq' and result['navigation'][0]['enabled']
 assert result['navigation'][1]['enabled'] is False

@pytest.mark.asyncio
async def test_programme_times_are_in_event_timezone(monkeypatch):
 event=SimpleNamespace(id='e',speaker_enabled=False,experience_enabled=True,event_date=datetime(2026,12,24,1,tzinfo=timezone.utc),timezone='America/Chicago')
 step=SimpleNamespace(id='s',enabled=True,is_segment=True,starts_offset_seconds=0,sort_order=0,title='Evening session',description='',config={})
 monkeypatch.setattr(sites,'active_workflow',AsyncMock(return_value=SimpleNamespace(steps=[step])))
 value=await sites._website_content_sources(event,None)
 assert value['sessions'][0]['date']=='2026-12-23'
 assert value['sessions'][0]['time']=='7:00 PM'

@pytest.mark.asyncio
async def test_publish_preserves_revision_and_is_one_atomic_service_write(ctx,monkeypatch):
 ctx.login(ctx.ids['user_a'])
 event_id=ctx.ids['event_a'];calls=[]
 async def call(method,path,**kwargs):
  calls.append((method,path,kwargs))
  if method=='GET':return {'revision':'expected','content':{'event_name':'Example','headline':'Hello'}}
  return {'version':1}
 monkeypatch.setattr(sites,'_call',call)
 monkeypatch.setattr(sites,'_prepare_website',AsyncMock(return_value={'event_name':'Example','headline':'Hello'}))
 response=await ctx.client.post(f'/api/events/{event_id}/website/publish',json={'expected_revision':'expected'})
 assert response.status_code==200,response.text
 assert [method for method,_,_ in calls]==['GET','POST']
 assert calls[-1][2]['json']['expected_revision']=='expected'
 calls.clear();response=await ctx.client.post(f'/api/events/{event_id}/website/publish',json={'expected_revision':'stale'})
 assert response.status_code==409
 assert len(calls)==1

def test_null_requested_enabled_keeps_automatic_navigation_on():
 content={'navigation':[{'id':'rsvp','destination_type':'rsvp','url':'','enabled':True,'requested_enabled':None}]}
 result=sites._resolve_navigation(content,{'rsvp':{'url':'https://example.com/rsvp','available':True}})
 assert result['navigation'][0]['enabled'] is True

@pytest.mark.asyncio
async def test_published_brand_and_event_facts_are_resolved_authoritatively(ctx,monkeypatch):
 import httpx
 theme={'colors':{'primary':'#123456','accent':'#abcdef'},'font_pairing':'classic-serif','logo_image_url':'https://example.com/logo.png','cover_image_url':'https://example.com/cover.png','image_settings':{'fit':'contain','position':'top','alt':'Event poster'}}
 class Client:
  async def __aenter__(self):return self
  async def __aexit__(self,*args):pass
  async def get(self,url):return httpx.Response(200,json=theme,request=httpx.Request('GET',url))
 monkeypatch.setattr(sites.httpx,'AsyncClient',lambda **kw:Client())
 connections={key:{'url':'','available':False} for key in ['venue','guesthub','festiome','festio_live']}
 monkeypatch.setattr(sites,'_website_connections',AsyncMock(return_value=connections))
 async with _Session() as db:
  event=await db.get(Event,ctx.ids['event_a']);event.timezone='America/Chicago';event.event_date=datetime(2026,12,24,1,tzinfo=timezone.utc)
  result=await sites._prepare_website(event,{'use_event_branding':True,'primary_color':'#000000'},db)
  assert result['primary_color']=='#123456' and result['font_pairing']=='classic-serif'
  assert result['image_fit']=='contain' and result['image_alt']=='Event poster'
  assert result['start_date'].startswith('2026-12-23T19:00:00')
  assert result['timezone']=='America/Chicago'


def test_event_story_navigation_tracks_optional_content():
 content={'intro_title':'Why attend','navigation':[{'id':'about','destination_type':'section','url':'#about','enabled':True}]}
 result=sites._resolve_navigation(content,{})
 assert result['navigation'][0]['enabled'] is True
 assert result['navigation'][0]['url']=='#about'
 result['intro_title']=''
 hidden=sites._resolve_navigation(result,{})
 assert hidden['navigation'][0]['enabled'] is False
 hidden['intro_summary']='An event for our community.'
 assert sites._resolve_navigation(hidden,{})['navigation'][0]['enabled'] is True
