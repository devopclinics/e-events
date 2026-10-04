"""Disposable SQLite FestioMe HTTP service for real browser creation tests.
Run: E2E_FIXTURE_DIR=/tmp/festiome-real-api python3 frontend/e2e/festiome_real_api_fixture.py
No production database, provider, or guest records are accessed.
"""
import asyncio, json, os, sys, time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('E2E_FIXTURE_DIR','/tmp/festiome-real-api'))
OUT.mkdir(parents=True,exist_ok=True)
os.environ['DATABASE_URL']='sqlite+aiosqlite:///'+str(OUT/'database.sqlite')
os.environ['INTERNAL_SERVICE_TOKEN']='isolated-browser-test-only-not-a-live-secret'
os.environ['UPLOAD_DIR']=str(OUT/'uploads')
sys.path.insert(0,str(ROOT/'festiome-service'))
import jwt, uvicorn
from httpx import ASGITransport, AsyncClient
from app.database import Base, engine
from app.main import app
import app.main as service

async def no_network(*args,**kwargs): pass
service._publish=no_network
service._rate_limit=no_network

def token(subject,kind='guest'):
    return jwt.encode(dict(sub=subject,name=subject.title(),email=subject+'@fixture.test',
        identity_kind=kind,aud='festiome',iss='guesthub',exp=int(time.time())+86400),
        'isolated-browser-test-only-not-a-live-secret',algorithm='HS256')

async def seed():
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://fixture') as client:
        svc={'Authorization':'Bearer isolated-browser-test-only-not-a-live-secret'}
        created=await client.post('/internal/v1/guesthub/event-links',headers=svc,json={
            'external_event_ref':'ui-validation-event','external_org_ref':'ui-validation-org',
            'name':'FestioMe UI Validation','owner':{'subject':'host','name':'Host','email':'host@fixture.test'}})
        assert created.status_code==201,created.text
        group=created.json()['festiome_id']
        for person in ('alice','bob','charlie'):
            result=await client.put('/internal/v1/guesthub/event-links/ui-validation-event/members/'+person,headers=svc,json={'name':person.title()})
            assert result.status_code==200,result.text
        host={'Authorization':'Bearer '+token('host','user')}
        for name,kind in (('Session Discussions','discussion'),('Announcements','announcement')):
            result=await client.post(f'/v1/groups/{group}/channels',headers=host,json={'name':name,'kind':kind})
            assert result.status_code==201,result.text
        public=await client.post('/v1/events/ui-validation-event/subgroups',headers=host,json={'name':'Public networking','join_policy':'open','visibility':'listed'})
        assert public.status_code==201,public.text
        guests={person:token(person) for person in ('alice','bob','charlie')}
        for person in ('alice','bob'):
            result=await client.patch(f'/v1/profile?group_id={group}',headers={'Authorization':'Bearer '+guests[person]},json={'display_name':person.title(),'bio':'Community member','interest_tags':['community'],'discoverable':True})
            assert result.status_code==200,result.text
        channels=(await client.get(f'/v1/groups/{group}/channels',headers=host)).json()
        general=next(row['id'] for row in channels if row['name']=='General')
        result=await client.post(f'/v1/channels/{general}/messages',headers={'Authorization':'Bearer '+guests['bob']},json={'body':'Welcome to our validation community'})
        assert result.status_code==201,result.text
        (OUT/'context.json').write_text(json.dumps(dict(group_id=group,guests=guests,event_id='ui-validation-event')))
        print('Fixture ready: isolated groups, guests, message, and discovery directory',flush=True)

if __name__=='__main__':
    asyncio.run(seed())
    uvicorn.run(app,host='127.0.0.1',port=int(os.environ.get('E2E_FIXTURE_PORT','9186')),lifespan='off',log_level='warning')
