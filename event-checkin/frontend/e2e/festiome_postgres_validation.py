"""Real PostgreSQL group privacy and simultaneous RSVP validation.
Run with DATABASE_URL pointing to a fresh disposable festiome_validation_ database
and an isolated INTERNAL_SERVICE_TOKEN. Providers and rate limits are disabled.
The caller creates and removes the disposable database; never use a live database.
"""
import asyncio,json,time,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"festiome-service"))
import jwt
from httpx import AsyncClient,ASGITransport
from app.database import Base,engine
from app.main import app
from app.config import settings
import app.main as service

async def quiet(*args,**kwargs): pass
service._publish=quiet
service._rate_limit=quiet

def auth(person,kind='guest'):
    return {'Authorization':'Bearer '+jwt.encode(dict(sub=person,name=person.title(),identity_kind=kind,iss='guesthub',aud='festiome',exp=int(time.time())+300),settings.internal_service_token,algorithm='HS256')}

async def main():
    assert engine.url.database.startswith("festiome_validation_"), "Use a disposable festiome_validation_ database only"
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://isolated-postgres') as api:
        headers={'Authorization':'Bearer '+settings.internal_service_token}
        created=await api.post('/internal/v1/guesthub/event-links',headers=headers,json=dict(external_event_ref='validation-postgres',external_org_ref='validation-org',name='Isolated PostgreSQL Validation',owner=dict(subject='host',name='Host')))
        assert created.status_code==201,created.text
        group=created.json()['festiome_id']
        for guest in ('alice','bob','charlie'):
            r=await api.put('/internal/v1/guesthub/event-links/validation-postgres/members/'+guest,headers=headers,json=dict(name=guest.title()));assert r.status_code==200,r.text
        roster=(await api.get(f'/v1/groups/{group}/members',headers=auth('alice'))).json()
        bob=next(m['id'] for m in roster if m['display_name']=='Bob')
        private=await api.post('/v1/events/validation-postgres/group-chats',headers=auth('alice'),json=dict(name='Persisted PostgreSQL group',member_ids=[bob]))
        assert private.status_code==201,private.text
        private_id=private.json()['id']
        assert (await api.get(f'/v1/groups/{private_id}/channels',headers=auth('bob'))).status_code==200
        assert (await api.get(f'/v1/groups/{private_id}/channels',headers=auth('charlie'))).status_code==404
        # Repeat the last-seat race to exercise PostgreSQL row locking.
        for attempt in range(5):
            r=await api.post(f'/v1/groups/{group}/meetups',headers=auth('host','user'),json=dict(title='Last-seat validation '+str(attempt),starts_at='2099-12-24T10:00:00-05:00',capacity=2))
            assert r.status_code==201,r.text
            meetup=r.json();url=f"/v1/meetups/{meetup['id']}"
            results=await asyncio.gather(*(api.post(url+'/rsvp',headers=auth(person),json=dict(status='going')) for person in ('alice','bob')))
            assert sorted(r.status_code for r in results)==[200,409],[(r.status_code,r.text) for r in results]
            persisted=(await api.get(f'/v1/groups/{group}/meetups?include_past=true',headers=auth('charlie'))).json()
            row=next(m for m in persisted if m['id']==meetup['id'])
            assert row['attendee_count']==2 and row['starts_at'].startswith('2099-12-24T15:00:00')
            r=await api.patch(url,headers=auth('host','user'),json=dict(status='cancelled'));assert r.status_code==200,r.text
            r=await api.post(url+'/rsvp',headers=auth('charlie'),json=dict(status='going'));assert r.status_code==404,r.text
        print(json.dumps(dict(database='isolated PostgreSQL',private_group_persisted=True,uninvited_guest_denied=True,capacity_races_passed=5,cancelled_rsvp_denied=True)))
    await engine.dispose()
asyncio.run(main())
