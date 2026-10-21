"""Production auto-enrollment, with synthetic identities and no real sends."""
from datetime import timedelta
import json
import jwt
from unittest.mock import Mock
import httpx
import pytest
from sqlalchemy import select
from test_email_pilot import pilot, add, run, signed_ready
from test_engagement_reliability import service, get_lead, make_due


@pytest.fixture
def automatic(pilot, monkeypatch):
    m,client,headers,sender,ready,launch=pilot
    monkeypatch.setenv('MARKETING_ONBOARDING_ENABLED','true')
    monkeypatch.setenv('MARKETING_ONBOARDING_SCHEDULER_ENABLED','true')
    monkeypatch.setenv('MARKETING_ONBOARDING_LAUNCH_AT',launch.isoformat())
    monkeypatch.setenv('MARKETING_ONBOARDING_ACCOUNT_URL','http://backend:8000/api/internal/marketing/organizer-account-context')
    with m.SessionLocal() as db:
        pins={s.payload['stage']:{'id':s.id,'sha256':m.email_pilot.template_fingerprint(s)} for s in db.scalars(select(m.ModuleRecord).where(m.ModuleRecord.module=='sequences'))}
    monkeypatch.setenv('MARKETING_ONBOARDING_TEMPLATES',json.dumps(pins))
    state={'events':0,'owner':True}
    def get(url, **kwargs):
        if url.endswith('/organizer-account-context'):
            at=m.now();fields=dict(sub='organizer-account-context-response',iss='festio-backend',aud='organizer-account-context-response',iat=at,exp=at+timedelta(seconds=5),jti=kwargs['params']['challenge'],account_id=kwargs['params']['account_id'],current_owner=state['owner'],event_count=state['events'])
            return httpx.Response(200,request=httpx.Request('GET',url),json={'proof':jwt.encode(fields,m.TOKEN_SECRET,algorithm='HS256')})
        return signed_ready(m,url,kwargs['params'])
    monkeypatch.setattr(m.httpx,'get',get)
    return pilot,state


def test_future_accounts_do_not_need_allowlist(automatic):
    p,_=automatic
    lead=add(p,index=25)
    assert run(p,lead,mode='production')['sent']==1
    assert p[3].call_count==1


@pytest.mark.parametrize('field,value',[('consent_email',False),('email_verified',False),('organizer_account',False),('account_registered_at','2020-01-01T00:00:00Z')])
def test_automatic_enrollment_preserves_evidence_boundary(automatic,field,value):
    p,_=automatic
    response=p[1].post('/api/marketing/internal/ingest',headers=p[2],json={'email':'new@example.com','festio_user_id':'future','event_id':'new-account','stage':'registered','lifecycle_event':'signup_consent','email_verified':True,'organizer_account':True,'consent_email':True,'occurred_at':p[0].now().isoformat(),'registered_at':p[0].now().isoformat(),'account_registered_at':p[0].now().isoformat(),field:value})
    assert response.status_code==200
    assert run(p,mode='production')['sent']==0
    p[3].assert_not_called()


def test_source_event_stops_stale_creation_message(automatic):
    p,state=automatic;lead=add(p,index=21);state['events']=1
    assert run(p,lead,mode='production')['sent']==0
    p[3].assert_not_called()


def test_revoked_ownership_stops_sending(automatic):
    p,state=automatic;lead=add(p,index=21);state['owner']=False
    assert run(p,lead,mode='production')['sent']==0


def test_template_changes_block_production(automatic):
    p,_=automatic;lead=add(p,index=22);m=p[0]
    with m.SessionLocal() as db:
        seq=db.scalar(select(m.ModuleRecord).where(m.ModuleRecord.payload['stage'].as_string()=='registered'))
        seq.payload={**seq.payload,'steps':[{'subject':'unreviewed','body':'changed'}]};db.commit()
    with pytest.raises(m.email_pilot.EmailBlocked):run(p,lead,mode='production')
    p[3].assert_not_called()


def test_clock_records_blocked_and_successful_runs(automatic,monkeypatch):
    p,_=automatic;m=p[0]
    from app.onboarding import OnboardingScheduler,operational_status
    clock=OnboardingScheduler(m)
    monkeypatch.setattr(m.email_pilot,'readiness',Mock(side_effect=m.email_pilot.EmailBlocked('Pending source captures')))
    assert clock.tick()['blocked']=='Pending source captures'
    with m.SessionLocal() as db:
        status=operational_status(m,db)
        assert status['last_run']['blocked']=='Pending source captures'
        assert status['state']=='blocked'


def test_full_welcome_series_finishes_and_optout_stops(automatic,monkeypatch):
    p,_=automatic;m=p[0];lead=add(p,index=28);initial=m.now()
    for day in [0,2,4,8]:
        monkeypatch.setattr(m,'now',lambda day=day:initial+timedelta(days=day))
        make_due(m,lead)
        result=run(p,lead,mode='production')
        assert result['sent']==1, json.dumps({'day':day,**result})
    assert get_lead(m,lead).next_follow_up_at is None
    make_due(m,lead)
    assert run(p,lead,mode='production')['sent']==0
    assert p[3].call_count==4


def test_prod_mode_does_not_enable_legacy_or_pilot(automatic,monkeypatch):
    p,_=automatic;lead=add(p,index=22)
    monkeypatch.setenv('MARKETING_EMAIL_PILOT_ENABLED','false')
    assert run(p,lead)['sent']==0
    assert run(p,lead,mode='production')['sent']==1


def test_unmatched_delivery_is_durable_without_creating_lead(service):
    m,client,headers=service
    body={'event_id':'guest-receipt-1','email':'guest-only@example.com','event':'delivered','provider_id':'guest-message'}
    first=client.post('/api/marketing/internal/delivery',headers=headers,json=body)
    assert first.json()=={'recorded':True,'unmatched':True}
    assert client.post('/api/marketing/internal/delivery',headers=headers,json=body).json()=={'recorded':True,'duplicate':True}
    with m.SessionLocal() as db:
        assert db.get(m.IngestReceipt,'guest-receipt-1') is not None
        assert not db.scalars(select(m.Lead)).all()


def test_first_event_transitions_to_setup_without_more_creation_reminders(automatic,monkeypatch):
    p,state=automatic;m=p[0];lead=add(p,index=26)
    assert run(p,lead,mode='production')['sent']==1
    initial=m.now();state['events']=1
    response=p[1].post('/api/marketing/internal/ingest',headers=p[2],json={'email':'fixture-26@example.com','festio_user_id':'account-26','event_id':'new-first-event','lifecycle_event':'event_created','stage':'event_created','occurred_at':m.now().isoformat()})
    assert response.status_code==200
    assert get_lead(m,lead).stage=='event_created'
    monkeypatch.setattr(m,'now',lambda:initial+timedelta(hours=25))
    make_due(m,lead)
    assert run(p,lead,mode='production')['sent']==1
    assert p[3].call_args.kwargs['json']['subject']=='Your event is taking shape'
    assert p[3].call_count==2


def test_unsubscribe_stops_automatic_followups(automatic):
    p,_=automatic;lead=add(p,index=27)
    response=p[1].post('/api/marketing/unsubscribe/'+lead)
    assert response.status_code==200
    assert run(p,lead,mode='production')['sent']==0
    p[3].assert_not_called()
