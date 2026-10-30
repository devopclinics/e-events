import io
from datetime import datetime
import pytest
from PIL import Image
from sqlalchemy import select
from conftest import _Session
from app.models import Event, Membership
from app.routers import media_library


def image_bytes():
    out=io.BytesIO();Image.new('RGB',(80,40),'#336655').save(out,format='PNG');return out.getvalue()

@pytest.fixture
def stored(monkeypatch):
    files={}
    def save(path,data,mime):files[path]=(data,mime);return '/api/uploads/'+path
    monkeypatch.setattr(media_library.storage,'save',save)
    monkeypatch.setattr(media_library.storage,'delete',lambda path:files.pop(path,None))
    return files

@pytest.mark.asyncio
async def test_shared_media_reuses_across_events_and_preserves_links(ctx,stored):
    ctx.login(ctx.ids['user_a']);eid=ctx.ids['event_a']
    response=await ctx.client.post(f'/api/events/{eid}/media-library',files={'file':('venue.png',image_bytes(),'image/png')})
    assert response.status_code==201,response.text
    asset=response.json();assert (asset['width'],asset['height'])==(80,40)
    duplicate=await ctx.client.post(f'/api/events/{eid}/media-library',files={'file':('again.png',image_bytes(),'image/png')})
    assert duplicate.json()['id']==asset['id'] and len(stored)==1
    async with _Session() as db:
        event=Event(org_id=ctx.ids['org_a'],name='Second occasion',couples_name='Team',event_date=datetime(2027,1,1),checkin_base_url='http://x');db.add(event);await db.commit();other=event.id
    listing=await ctx.client.get(f'/api/events/{other}/media-library')
    assert listing.json()['assets'][0]['id']==asset['id']
    renamed=await ctx.client.patch(f'/api/events/{other}/media-library/{asset["id"]}',json={'title':'Our venue'})
    assert renamed.json()['title']=='Our venue' and renamed.json()['url']==asset['url']
    assert (await ctx.client.delete(f'/api/events/{eid}/media-library/{asset["id"]}')).json()['existing_links_preserved']
    assert (await ctx.client.get(f'/api/events/{other}/media-library')).json()['assets']==[]
    assert len(stored)==1

@pytest.mark.asyncio
async def test_shared_media_rejects_other_organizations_and_staff(ctx,stored):
    ctx.login(ctx.ids['user_a']);eid=ctx.ids['event_a']
    asset=(await ctx.client.post(f'/api/events/{eid}/media-library',files={'file':('venue.png',image_bytes(),'image/png')})).json()
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(f'/api/events/{eid}/media-library')).status_code==403
    async with _Session() as db:
        event=Event(org_id=ctx.ids['org_b'],name='Other org',couples_name='Team',event_date=datetime(2027,1,1),checkin_base_url='http://x');db.add(event);await db.commit();other=event.id
    assert (await ctx.client.patch(f'/api/events/{other}/media-library/{asset["id"]}',json={'title':'stolen'})).status_code==404
    assert (await ctx.client.delete(f'/api/events/{other}/media-library/{asset["id"]}')).status_code==404
    async with _Session() as db:
        m=await db.scalar(select(Membership).where(Membership.user_id==ctx.ids['user_b'].id));m.role='staff';await db.commit()
    assert (await ctx.client.get(f'/api/events/{other}/media-library')).status_code==403
    assert len(stored)==1

@pytest.mark.asyncio
@pytest.mark.parametrize('name,data,mime',[('bad.svg',b'<svg/>','image/svg+xml'),('fake.png',b'<html/>','image/png'),('fake.pdf',b'<html/>','application/pdf'),('bad.jpg',image_bytes(),'image/jpeg'),('empty.pdf',b'','application/pdf')])
async def test_shared_media_rejects_unsafe_files(ctx,stored,name,data,mime):
    ctx.login(ctx.ids['user_a'])
    response=await ctx.client.post(f'/api/events/{ctx.ids["event_a"]}/media-library',files={'file':(name,data,mime)})
    assert response.status_code==400 and not stored

@pytest.mark.asyncio
async def test_shared_media_pdf_and_limits(ctx,stored):
    ctx.login(ctx.ids['user_a']);eid=ctx.ids['event_a']
    response=await ctx.client.post(f'/api/events/{eid}/media-library',files={'file':('programme.pdf',b'%PDF-1.4\n%%EOF','application/pdf')})
    assert response.status_code==201 and response.json()['width'] is None
    assert (await ctx.client.patch(f'/api/events/{eid}/media-library/{response.json()["id"]}',json={'title':'  '})).status_code==400
    with pytest.raises(Exception) as exc:media_library.validate_file(b'X'*(20*1024*1024+1),'application/pdf')
    assert exc.value.status_code==400
