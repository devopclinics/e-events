import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.store import save_design,load_design
from app.routers import design

@pytest.fixture
def client(tmp_path, monkeypatch):
 monkeypatch.setattr(settings,'storage_path',str(tmp_path));monkeypatch.setattr(settings,'template_packs_path',str(tmp_path/'packs'));monkeypatch.setattr(settings,'internal_token','studio-test')
 with TestClient(app) as c:
  c.headers['X-Internal-Token']='studio-test';yield c
P='/api/v1/design/events/studio-test'
def test_revision_conflict_and_guarded_publication(client):
 first=client.put(P,json={'wording_config':{'eventTitle':'First'},'expected_revision':0}).json()
 assert first['revision']==1
 assert client.put(P,json={'wording_config':{'eventTitle':'Stale'},'expected_revision':0}).status_code==409
 assert client.post(P+'/publish',json={'expected_revision':0}).status_code==409
 assert client.get(P).json()['wording_config']['eventTitle']=='First'
 assert client.post(P+'/publish',json={'expected_revision':first['revision']}).status_code==200

def test_first_draft_private_then_published_snapshot_protects_edits(client):
 baseline=client.get(P+'/public-theme').json()
 draft=client.put(P,json={'theme_config':{'colors':{'primary':'#ff0000'}},'wording_config':{'eventTitle':'Draft'}}).json()
 public=client.get(P+'/public-theme').json()
 assert public['colors']==baseline['colors'] and public['wording']=={}
 client.post(P+'/publish',json={'expected_revision':draft['revision']})
 record=client.get(P).json();client.put(P,json={'wording_config':{'eventTitle':'Later draft'},'expected_revision':record['revision']})
 assert client.get(P+'/public-theme').json()['wording']['eventTitle']=='Draft'

def test_history_restore_does_not_change_public_version(client):
 client.put(P,json={'wording_config':{'eventTitle':'One'}});client.post(P+'/publish')
 client.put(P,json={'wording_config':{'eventTitle':'Two'}});client.post(P+'/publish')
 record=client.get(P).json()
 assert len(client.get(P+'/versions').json()['versions'])==2
 assert client.post(P+'/restore',json={'version':1,'expected_revision':0}).status_code==409
 r=client.post(P+'/restore',json={'version':1,'expected_revision':record['revision']})
 assert r.status_code==200 and r.json()['wording_config']['eventTitle']=='One'
 assert client.get(P+'/public-theme').json()['wording']['eventTitle']=='Two'
 assert client.post(P+'/restore',json={'version':99,'expected_revision':r.json()['revision']}).status_code==404

def test_image_contract_published_only(client):
 data={'asset_config':{'cover_image_url':'/cover.png','logo_image_url':'/logo.png','image_settings':{'fit':'contain','position':'top','alt':'Artwork','surfaces':{'hub':False}}}}
 client.put(P,json=data)
 assert client.get(P+'/public-theme').json()['logo_image_url'] is None
 client.post(P+'/publish');live=client.get(P+'/public-theme').json()
 assert live['logo_image_url']=='/logo.png' and live['image_settings']['fit']=='contain'
 assert live['image_settings']['surfaces']['hub'] is False

@pytest.mark.asyncio
async def test_flyer_uses_saved_or_explicit_font(client,monkeypatch):
 captured={}
 async def render(ctx,*args):captured.update(ctx);return b'png'
 monkeypatch.setattr(design,'render_flyer',render)
 client.put(P,json={'theme_config':{'fontPairing':'classic-serif'}})
 assert client.post(P+'/render/flyer',json={'preview':True}).status_code==200
 assert captured['fontPairing']=='classic-serif'
 client.post(P+'/render/flyer',json={'preview':True,'font_pairing':'display-rounded'})
 assert captured['fontPairing']=='display-rounded'

def test_internal_auth_on_history_restore(client):
 client.headers.pop('X-Internal-Token')
 assert client.get(P+'/versions').status_code==401
 assert client.post(P+'/restore',json={'version':1,'expected_revision':0}).status_code==401


def test_flyer_respects_hidden_and_removed_cover(client,monkeypatch):
 captured={}
 async def render(ctx,*args):captured.update(ctx);return b'png'
 monkeypatch.setattr(design,'render_flyer',render)
 client.put(P,json={'asset_config':{'cover_image_url':'/saved.png'}})
 client.post(P+'/render/flyer',json={'preview':True})
 assert captured['coverImageUrl']=='/saved.png'
 client.post(P+'/render/flyer',json={'preview':True,'cover_image_url':None})
 assert captured['coverImageUrl'] is None
 client.post(P+'/render/flyer',json={'preview':True,'image_settings':{'surfaces':{'flyer':False}}})
 assert captured['coverImageUrl'] is None


def test_guided_upload_does_not_invalidate_pending_draft(client):
 import io
 from PIL import Image
 image=io.BytesIO();Image.new('RGB',(8,8),'green').save(image,format='PNG')
 saved=client.put(P,json={'wording_config':{'eventTitle':'Pending'}}).json()
 upload=client.post(P+'/assets?attach_to_design=false',files={'file':('cover.png',image.getvalue(),'image/png')})
 assert upload.status_code==200
 assert client.get(P).json()['revision']==saved['revision']
 attached=client.put(P,json={'asset_config':{'cover_image_url':upload.json()['public_url']},'expected_revision':saved['revision']})
 assert attached.status_code==200
 assert client.get(P+'/public-theme').json()['cover_image_url'] is None
