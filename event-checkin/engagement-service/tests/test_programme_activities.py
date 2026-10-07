import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from app.main import app
from app.auth import Identity
from app.routers.activities import programme_activities

class ProgrammeActivitiesTests(unittest.TestCase):
    def test_endpoint_requires_authentication(self):
        self.assertEqual(TestClient(app).get('/api/engagement/v1/activities/programme').status_code,401)

    def test_scope_eligibility_and_minimal_metadata(self):
        identity=Identity(identity_kind='guest',subject='guest',org_id='org',event_id='event',role='guest',allowed_session_ids=('allowed',),session_scope_enforced=True)
        def row(id,session='allowed',config=None):
            return SimpleNamespace(id=id,session_id=session,title=id,type='quiz',status='scheduled',config=config or {},questions=['secret answer'])
        db=SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda:SimpleNamespace(all=lambda:[row('allowed'),row('denied','another'),row('staff',config={'allow_guest_participation':False}),row('needs-checkin',config={'eligibility':'checked_in'})]))))
        result=asyncio.run(programme_activities(identity,db))
        self.assertEqual(result,[{'id':'allowed','session_id':'allowed','title':'allowed','type':'quiz','status':'scheduled'}])
        query=db.execute.call_args.args[0].compile(compile_kwargs={'literal_binds':True})
        sql=str(query)
        for value in ["event_id = 'event'","org_id = 'org'","session_id IS NOT NULL","'scheduled'","'closed'"]:self.assertIn(value,sql)
        self.assertNotIn("'draft'",sql)
        self.assertNotIn("'archived'",sql)
