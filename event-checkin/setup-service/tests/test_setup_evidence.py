"""Persist real evidence records and enforce the service's event authorization."""
import asyncio
import os
from datetime import datetime

os.environ['DATABASE_URL'] = 'sqlite+aiosqlite:///:memory:'
from httpx import ASGITransport, AsyncClient
from app import main as m


def test_evidence_lifecycle_and_authorization():
    async def run():
        async with m.engine.begin() as connection:
            await connection.run_sync(m.Base.metadata.create_all)
            await connection.run_sync(m.SetupBase.metadata.create_all)
        async with m.SessionLocal() as db:
            db.add_all([
                m.Organization(id='org', is_active=True),
                m.Organization(id='other-org', is_active=True),
                m.User(id='owner',name='Owner',email='owner@example.test',is_active=True),
                m.User(id='reader',name='Reader',email='reader@example.test',is_active=True),
                m.User(id='outsider',name='Outsider',email='out@example.test',is_active=True),
                m.Membership(id='om',org_id='org',user_id='owner',role='owner'),
                m.Membership(id='rm',org_id='org',user_id='reader',role='member'),
                m.Event(id='event',org_id='org',name='Test',event_date=datetime(2026,11,1)),
                m.Event(id='second',org_id='org',name='Second',event_date=datetime(2026,11,1)),
                m.Event(id='foreign',org_id='other-org',name='Foreign',event_date=datetime(2026,11,1)),
                m.EventUser(id='r',event_id='event',user_id='reader',event_role='manager',access_level='view'),
                m.SetupProgress(event_id='event',step_key='phase2_ticket_test',status='completed',completed_by_user_id='owner'),
            ])
            await db.commit()
        actor='owner'
        async def user():
            async with m.SessionLocal() as db:
                return await db.get(m.User,actor)
        m.app.dependency_overrides[m.current_user]=user
        try:
            async with AsyncClient(transport=ASGITransport(app=m.app),base_url='http://test') as c:
                body={'event_id':'event','step_key':'phase2_ticket_test','result':'partial','checks':[{'label':'One named order','passed':False}],'reference':'Order demo-123','config_revision':'v1-test'}
                response=await c.post('/api/setup/evidence',json=body)
                assert response.status_code==201,response.text
                first=response.json()
                assert first['recorded_by']=='owner' and first['recorded_at'] and first['source']=='organizer_recorded'
                bad=await c.post('/api/setup/evidence',json={**body,'result':'passed'})
                assert bad.status_code==422
                for update in [{'reference':'   '},{'checks':[]},{'result':'invented'},{'step_key':'outcome_rsvp'}]:
                    assert (await c.post('/api/setup/evidence',json={**body,**update})).status_code==422
                body.update(result='passed',checks=[{'label':'One named order','passed':True}])
                passed=await c.post('/api/setup/evidence',json=body)
                assert passed.status_code==201
                state=(await c.get('/api/setup/progress',params={'event_id':'event'})).json()
                assert state['steps']['phase2_ticket_test']=='completed'
                assert state['legacy_checks'][0]['recorded_by']=='owner'
                assert len(state['evidence'])==2
                assert state['evidence'][0]['result']=='passed'
                assert state['evidence'][1]['id']==first['id']
                assert (await c.get('/api/setup/progress',params={'event_id':'second'})).json()['evidence']==[]
                assert (await c.post('/api/setup/evidence',json={**body,'event_id':'foreign'})).status_code==404
                actor='reader'
                assert (await c.get('/api/setup/progress',params={'event_id':'event'})).status_code==200
                assert (await c.post('/api/setup/evidence',json=body)).status_code==403
                actor='outsider'
                assert (await c.get('/api/setup/progress',params={'event_id':'event'})).status_code==404
                assert (await c.post('/api/setup/evidence',json=body)).status_code==404
        finally:
            m.app.dependency_overrides.clear()
            async with m.engine.begin() as connection:
                await connection.run_sync(m.SetupBase.metadata.drop_all)
                await connection.run_sync(m.Base.metadata.drop_all)
            await m.engine.dispose()
    asyncio.run(run())
