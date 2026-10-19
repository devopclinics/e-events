"""Late-review reproductions: file-backed SQLite, distinct sessions, no providers."""
import json
import threading
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import timedelta
from unittest.mock import Mock

import httpx
import jwt
import pytest
from sqlalchemy import select
from sqlalchemy.schema import CreateTable
from sqlalchemy.dialects import postgresql

from test_email_pilot import pilot, add, run
from test_engagement_reliability import service
from test_journey_workers import real_sales_fixture, enable, SimulatedProcessDeath
from test_organizer_journey import inbound
from app import organizer_journey as journey, sales_responses as sales, journey_workers as workers, retention, journey_context


def context_setup(pilot,monkeypatch,kind):
    m,_,_,sender,ready,_=pilot;lead_id=add(pilot)
    monkeypatch.setenv("MARKETING_ORGANIZER_CONTEXT_URL","http://backend:8000/api/internal/marketing/organizer-context")
    if kind=="retention":
        from app.journey_templates import retention_candidate
        monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED","true")
        monkeypatch.setenv("MARKETING_ORGANIZER_RETENTION_ENABLED","true")
        with m.SessionLocal() as db:
            seq=m.ModuleRecord(module="sequences",name="Synthetic retained review",status="active",payload=retention_candidate(),created_by="synthetic");db.add(seq);db.commit()
            monkeypatch.setenv("MARKETING_ORGANIZER_RETENTION_TEMPLATE",json.dumps({"id":seq.id,"sha256":m.email_pilot.template_fingerprint(seq)}))
    with m.SessionLocal() as db:
        db.add(journey.Evidence(id="context-event",fingerprint="synthetic",account_id="account-0",org_id="org",event_id="event",use_case="event",milestone="event_completed" if kind=="retention" else "event_created",source_id="event",occurred_at=m.now().isoformat()));db.commit()
    local=threading.local();original=journey_context.message_context
    def message(*args):
        local.last_context=True
        try:return original(*args)
        finally:local.last_context=False
    monkeypatch.setattr(journey_context,"message_context",message)
    def response(url,**kwargs):
        if not url.endswith("/organizer-context"):return ready(url,**kwargs)
        at=m.now();params=kwargs["params"]
        body=dict(sub="organizer-context-response",iss="festio-backend",aud="organizer-context-response",iat=at,exp=at+timedelta(seconds=5),jti=params["challenge"],checked_at=at.isoformat(),account_id="account-0",event_id="event",current_owner=True,org_id="org",status="ended" if kind=="retention" else "active",cancelled=False,is_test=False,attendance_mode="rsvp",invite_mode="closed",rsvp_enabled=True,event_date=(at+timedelta(days=1)).isoformat(),timezone="UTC")
        return httpx.Response(200,json={"proof":jwt.encode(body,m.TOKEN_SECRET,algorithm="HS256")})
    return m,lead_id,sender,local,response,lambda:retention.run_retention(m) if kind=="retention" else run(pilot,lead_id)


@pytest.mark.parametrize("kind",["onboarding","retention"])
@pytest.mark.parametrize("change",["unsubscribe","consent","handoff","recipient","account"])
def test_committed_change_during_final_context_http_cancels_known_unsent(pilot,monkeypatch,kind,change):
    m,lead_id,sender,local,response,execute=context_setup(pilot,monkeypatch,kind)
    entered=threading.Event();release=threading.Event()
    def blocked(url,**kwargs):
        if getattr(local,"last_context",False):
            entered.set();assert release.wait(10)
        return response(url,**kwargs)
    monkeypatch.setattr(m.httpx,"get",blocked)
    with ThreadPoolExecutor(max_workers=1) as pool:
        task=pool.submit(execute);assert entered.wait(10)
        with m.SessionLocal() as writer:
            lead=writer.get(m.Lead,lead_id)
            if change=="unsubscribe":lead.unsubscribed=True
            if change=="consent":lead.consent_email=False
            if change=="handoff":lead.automation_paused=True;lead.suppression_reason="human_handoff"
            if change=="recipient":lead.email="changed@example.test"
            if change=="account":lead.festio_user_id="other-account"
            writer.commit()
        release.set();task.result(timeout=10)
    sender.assert_not_called()
    with m.SessionLocal() as db:
        claims=db.scalars(select(m.email_pilot.EmailDispatch)).all()
        assert len(claims)==1 and claims[0].status=="cancelled"


@pytest.mark.parametrize("kind",["onboarding","retention"])
@pytest.mark.parametrize("failure",["timeout","malformed"])
def test_context_failure_after_reservation_is_known_unsent(pilot,monkeypatch,kind,failure):
    m,_,sender,local,response,execute=context_setup(pilot,monkeypatch,kind)
    def fail(url,**kwargs):
        if getattr(local,"last_context",False):
            if failure=="timeout":raise httpx.ConnectTimeout("synthetic")
            return httpx.Response(200,content=b"{")
        return response(url,**kwargs)
    monkeypatch.setattr(m.httpx,"get",fail)
    execute();sender.assert_not_called()
    with m.SessionLocal() as db:
        assert db.scalar(select(m.email_pilot.EmailDispatch)).status=="cancelled"


def prepare_pair(m,body):
    with m.SessionLocal() as db:
        one=sales.ingest(db,body);two=sales.ingest(db,{**body,"event_id":"second-reply"})
        if hasattr(sales,"DispatchGuard"):
            db.add(sales.DispatchGuard(conversation_id=one.conversation_id,hour=sales.clock().strftime("%Y-%m-%dT%H"),attempts=0));db.commit()
        return one.id,two.id,one.conversation_id


def test_distinct_reply_claims_are_serialized_across_two_connections(service,monkeypatch):
    m,_,_=service;body=real_sales_fixture(monkeypatch,"chat");one,two,key=prepare_pair(m,body)
    barrier=threading.Barrier(2);entered=threading.Event();release=threading.Event();local=threading.local()
    original=m.SessionLocal.class_.scalar
    def scalar(db,statement,*args,**kwargs):
        value=original(db,statement,*args,**kwargs)
        if "marketing_sales_replies.status IN" in str(statement) and not getattr(local,"admitted",False):
            local.admitted=True;barrier.wait(timeout=10)
        return value
    monkeypatch.setattr(m.SessionLocal.class_,"scalar",scalar)
    def submit(**kwargs):entered.set();assert release.wait(10);return {"status":"accepted","provider_id":"synthetic"}
    adapter=Mock();adapter.send.side_effect=submit
    def dispatch(identity):
        with m.SessionLocal() as db:return sales.dispatch(db,identity,adapter)
    with ThreadPoolExecutor(max_workers=2) as pool:
        tasks=[pool.submit(dispatch,identity) for identity in [one,two]]
        assert entered.wait(10)
        done,pending=wait(tasks,timeout=10,return_when=FIRST_COMPLETED)
        try:
            assert len(done)==1 and next(iter(done)).result()=="conversation_busy_or_limited"
            assert adapter.send.call_count==1
        finally:release.set()
        assert next(iter(pending)).result(timeout=10)=="accepted"
    with m.SessionLocal() as db:assert db.get(sales.DispatchGuard,key).active_reply is None


def test_process_death_and_stale_recovery_never_expire_conversation_hold(service,monkeypatch):
    m,_,_=service;body=real_sales_fixture(monkeypatch,"chat");one,two,key=prepare_pair(m,body)
    adapter=Mock();adapter.send.side_effect=SimulatedProcessDeath()
    with m.SessionLocal() as db:
        with pytest.raises(SimulatedProcessDeath):sales.dispatch(db,one,adapter)
    future=sales.clock()+timedelta(days=2);monkeypatch.setattr(sales,"clock",lambda:future)
    workers.tick(m,sales_adapter=adapter)
    with m.SessionLocal() as db:
        assert db.get(sales.Reply,one).status=="unknown"
        assert db.get(sales.DispatchGuard,key).active_reply==one
        assert sales.dispatch(db,two,adapter)=="reconciliation_required"
    assert adapter.send.call_count==1


def test_stale_worker_is_fenced_after_authoritative_reconciliation(service,monkeypatch):
    m,client,headers=service;body=real_sales_fixture(monkeypatch,"chat");one,two,key=prepare_pair(m,body)
    entered=threading.Event();release=threading.Event();checks=[];requests=[]
    def readiness(_):
        checks.append(True)
        if len(checks)==1:entered.set();assert release.wait(10)
        return True
    monkeypatch.setattr(workers,"source_ready",readiness)
    adapter=workers.SalesAdapter(m,transport=httpx.MockTransport(lambda request:(requests.append(request) or httpx.Response(200,json={"id":"new-accepted"}))))
    def old_worker():
        with m.SessionLocal() as db:return sales.dispatch(db,one,adapter)
    with ThreadPoolExecutor(max_workers=1) as pool:
        old=pool.submit(old_worker);assert entered.wait(10)
        future=sales.clock()+timedelta(minutes=3);monkeypatch.setattr(sales,"clock",lambda:future)
        workers.tick(m,sales_adapter=adapter)
        with m.SessionLocal() as db:
            assert db.get(sales.Reply,one).status=="unknown"
            sales.reconcile(db,one,definitely_not_sent=True)
            case_id=db.scalar(select(journey.Handoff)).id
        assert client.post(f"/api/marketing/handoffs/{case_id}/resolve",headers=headers).status_code==200
        assert client.post(f"/api/marketing/sales-conversations/{key}/resume",headers=headers).status_code==200
        with m.SessionLocal() as db:
            fresh=sales.ingest(db,{**body,"event_id":"post-reconciliation"})
            assert sales.dispatch(db,fresh.id,adapter)=="accepted"
        release.set();assert old.result(timeout=10)=="reconciliation_required"
    assert len(requests)==1
    with m.SessionLocal() as db:assert db.get(sales.Reply,one).status=="cancelled"


def test_queued_hours_cannot_flush_above_current_dispatch_budget(service,monkeypatch):
    m,_,_=service;body=real_sales_fixture(monkeypatch,"chat");at=sales.clock();monkeypatch.setattr(sales,"clock",lambda:at)
    ids=[]
    for hour,count in [(0,4),(1,2)]:
        at=at+timedelta(hours=hour)
        for i in range(count):
            with m.SessionLocal() as db:ids.append(sales.ingest(db,{**body,"event_id":f"queued-{hour}-{i}"}).id)
    adapter=Mock();adapter.send.return_value={"status":"accepted","provider_id":"synthetic"}
    for identity in ids:
        with m.SessionLocal() as db:sales.dispatch(db,identity,adapter)
    assert adapter.send.call_count==4
    at=at+timedelta(hours=1)
    for identity in ids[4:]:
        with m.SessionLocal() as db:assert sales.dispatch(db,identity,adapter)=="accepted"
    assert adapter.send.call_count==6


def test_blocked_reply_batch_does_not_starve_later_eligible_contact(service,monkeypatch):
    m,_,_=service;body=real_sales_fixture(monkeypatch,"chat")
    for i in range(21):
        with m.SessionLocal() as db:
            reply=sales.ingest(db,{**body,"event_id":f"{i:02}-reply","contact_id":f"contact-{i}"})
            if i<20:db.get(sales.Conversation,reply.conversation_id).status="paused";db.commit()
    adapter=Mock();adapter.send.return_value={"status":"accepted","provider_id":"synthetic"}
    workers.tick(m,sales_adapter=adapter);workers.tick(m,sales_adapter=adapter)
    assert adapter.send.call_count==1


def test_handoff_batches_are_fair_and_missing_owner_can_recover(service,monkeypatch):
    m,_,_=service;enable(monkeypatch)
    monkeypatch.setenv("MARKETING_HANDOFF_DESTINATION","https://synthetic.invalid/staff")
    monkeypatch.setenv("MARKETING_HANDOFF_NOTIFICATIONS_ENABLED","true")
    with m.SessionLocal() as db:
        db.add(m.AccessGrant(email="owner@example.test",name="Owner",role="marketer",active=True,granted_by="synthetic"))
        for i in range(21):db.add(journey.Handoff(id=f"{i:02}-case",lead_id=f"lead-{i}",owner="owner@example.test" if i==20 else None,status="open",notification="pending",history=[]))
        db.commit()
    adapter=Mock();adapter.notify.return_value=True
    workers.tick(m,notification_adapter=adapter);workers.tick(m,notification_adapter=adapter)
    assert adapter.notify.call_count==1
    with m.SessionLocal() as db:
        case=db.get(journey.Handoff,"00-case");case.owner="owner@example.test";case.notification="missing_owner"
        grant=db.scalar(select(m.AccessGrant).where(m.AccessGrant.email==case.owner));grant.active=False;db.commit()
    workers.tick(m,notification_adapter=adapter)
    with m.SessionLocal() as db:
        db.scalar(select(m.AccessGrant).where(m.AccessGrant.email=="owner@example.test")).active=True;db.commit()
    workers.tick(m,notification_adapter=adapter)
    assert adapter.notify.call_count==2


def test_repair_batch_filters_existing_cases_before_limit(service,monkeypatch):
    m,_,_=service;body=real_sales_fixture(monkeypatch,"chat");missing=None
    with m.SessionLocal() as db:
        for i in range(21):
            reply=sales.ingest(db,{**body,"event_id":f"repair-{i}","contact_id":f"repair-contact-{i}"})
            db.get(sales.Conversation,reply.conversation_id).status="paused"
            if i<20:db.add(journey.Handoff(id=f"existing-{i}",lead_id="sales:"+reply.conversation_id,status="open",notification="missing_owner",history=[]))
            else:missing=reply.conversation_id
            db.commit()
    workers.tick(m)
    with m.SessionLocal() as db:assert db.scalar(select(journey.Handoff.id).where(journey.Handoff.lead_id=="sales:"+missing))


def test_existing_inactive_owner_recovers_without_reassignment(service,monkeypatch):
    m,_,_=service;enable(monkeypatch)
    monkeypatch.setenv("MARKETING_HANDOFF_DESTINATION","https://synthetic.invalid/staff")
    monkeypatch.setenv("MARKETING_HANDOFF_NOTIFICATIONS_ENABLED","true")
    with m.SessionLocal() as db:
        db.add(m.AccessGrant(email="existing@example.com",name="Owner",role="marketer",active=False,granted_by="synthetic"))
        db.add(journey.Handoff(id="recover-owner",lead_id="lead",owner="existing@example.com",status="open",notification="pending",history=[]));db.commit()
    adapter=Mock();adapter.notify.return_value=True
    workers.tick(m,notification_adapter=adapter);adapter.notify.assert_not_called()
    with m.SessionLocal() as db:
        assert db.get(journey.Handoff,"recover-owner").notification=="missing_owner"
        db.scalar(select(m.AccessGrant).where(m.AccessGrant.email=="existing@example.com")).active=True;db.commit()
    assert workers.tick(m,notification_adapter=adapter)["notifications"]==1


def test_exhausted_notifications_do_not_consume_runnable_batch(service,monkeypatch):
    m,_,_=service;enable(monkeypatch)
    monkeypatch.setenv("MARKETING_HANDOFF_OWNER","owner@example.com")
    monkeypatch.setenv("MARKETING_HANDOFF_DESTINATION","https://synthetic.invalid/staff")
    monkeypatch.setenv("MARKETING_HANDOFF_NOTIFICATIONS_ENABLED","true")
    with m.SessionLocal() as db:
        for i in range(21):db.add(journey.Handoff(id=f"{i:02}-exhausted",lead_id=f"lead-{i}",owner="owner@example.com",status="open",notification="failed",attempts=3 if i<20 else 0,history=[]))
        db.commit()
    adapter=Mock();adapter.notify.return_value=True
    assert workers.tick(m,notification_adapter=adapter)["notifications"]==1
    assert adapter.notify.call_args.kwargs["case_id"]=="20-exhausted"


def test_retention_schema_is_postgres_bigint_and_sqlite_preserves_identity(service):
    m,_,_=service
    assert "step BIGINT" in str(CreateTable(retention.RetentionJob.__table__).compile(dialect=postgresql.dialect()))
    value=int("ffffffffffff",16)
    with m.SessionLocal() as db:
        db.add(retention.RetentionJob(id="wide-step",lead_id="lead",org_id="org",event_id="event",step=value));db.commit()
    with m.SessionLocal() as db:assert db.get(retention.RetentionJob,"wide-step").step==value
