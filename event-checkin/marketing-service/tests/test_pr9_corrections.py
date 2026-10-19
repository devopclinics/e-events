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


@pytest.mark.parametrize("provider_state",["sending","unknown"])
def test_stale_suppressed_worker_cannot_cancel_owned_or_unknown_reply(service,monkeypatch,provider_state):
    m,_,_=service;body=real_sales_fixture(monkeypatch,"chat")
    with m.SessionLocal() as db:
        reply=sales.ingest(db,body);identity=reply.id;key=reply.conversation_id
    read=threading.Event();resume_reader=threading.Event();provider_entered=threading.Event();provider_release=threading.Event();local=threading.local()
    get=m.SessionLocal.class_.get;dispatch=sales.dispatch
    def paused_get(db,entity,*args,**kwargs):
        row=get(db,entity,*args,**kwargs)
        if entity is sales.Reply and getattr(local,"inside",False) and not getattr(local,"waited",False):
            local.waited=True;read.set();assert resume_reader.wait(10)
        return row
    monkeypatch.setattr(m.SessionLocal.class_,"get",paused_get)
    def provider(**kwargs):
        provider_entered.set()
        if provider_state=="sending":assert provider_release.wait(10)
        return {"status":"accepted","provider_id":"synthetic-accepted"} if provider_state=="sending" else {"status":"unknown"}
    adapter=Mock();adapter.send.side_effect=provider
    def wrapped(db,*args,**kwargs):
        if getattr(local,"reader",False):local.inside=True
        try:return dispatch(db,*args,**kwargs)
        finally:local.inside=False
    monkeypatch.setattr(sales,"dispatch",wrapped)
    def reader():local.reader=True;return workers.tick(m,sales_adapter=adapter)
    def sender():
        with m.SessionLocal() as db:return dispatch(db,identity,adapter)
    with ThreadPoolExecutor(max_workers=2) as pool:
        stale=pool.submit(reader);assert read.wait(10)
        owner=pool.submit(sender);assert provider_entered.wait(10)
        if provider_state=="unknown":assert owner.result(timeout=10)=="unknown"
        with m.SessionLocal() as writer:sales.ingest(writer,{**body,"event_id":"stop-between-worker-reads","intent":"opt_out"})
        resume_reader.set()
        try:
            assert stale.result(timeout=10)["sent"]==0
            with m.SessionLocal() as db:
                assert db.get(sales.Reply,identity).status==provider_state
                assert db.get(sales.DispatchGuard,key).active_reply==identity
        finally:provider_release.set()
        if provider_state=="sending":assert owner.result(timeout=10)=="accepted"
    with m.SessionLocal() as db:
        if provider_state=="unknown":sales.reconcile(db,identity,provider_id="authoritatively-confirmed")
        assert db.get(sales.DispatchGuard,key).active_reply is None
        assert db.get(sales.Conversation,key).status=="opted_out"
    assert adapter.send.call_count==1


@pytest.mark.parametrize("notification",["accepted","uncertain"])
def test_stale_missing_owner_snapshot_cannot_reset_completed_notification(service,monkeypatch,notification):
    m,client,headers=service;enable(monkeypatch)
    monkeypatch.setenv("MARKETING_HANDOFF_DESTINATION","https://synthetic.invalid/staff")
    monkeypatch.setenv("MARKETING_HANDOFF_NOTIFICATIONS_ENABLED","true")
    with m.SessionLocal() as db:
        lead=m.Lead(email="synthetic@example.com",automation_paused=True);db.add(lead);db.flush();lead_id=lead.id
        db.add(m.AccessGrant(email="operator@example.com",name="Operator",role="marketer",active=True,granted_by="synthetic"))
        db.add(journey.Handoff(id="stale-owner-case",lead_id=lead.id,status="open",notification="pending",history=[]));db.commit()
    entered=threading.Event();release=threading.Event();local=threading.local()
    original=getattr(workers,"schedule_work",None);merge=m.SessionLocal.class_.merge
    def pause():
        if getattr(local,"stale",False) and not getattr(local,"waited",False):
            local.waited=True;entered.set();assert release.wait(10)
    if original:
        def schedule(db,*args):pause();return original(db,*args)
        monkeypatch.setattr(workers,"schedule_work",schedule)
    else:
        def stale_merge(db,instance,*args,**kwargs):pause();return merge(db,instance,*args,**kwargs)
        monkeypatch.setattr(m.SessionLocal.class_,"merge",stale_merge)
    adapter=Mock()
    if notification=="accepted":adapter.notify.return_value=True
    else:adapter.notify.side_effect=TimeoutError("synthetic unknown outcome")
    def stale_worker():local.stale=True;return workers.tick(m,notification_adapter=adapter)
    with ThreadPoolExecutor(max_workers=1) as pool:
        stale=pool.submit(stale_worker);assert entered.wait(10)
        assert client.post('/api/marketing/handoffs/stale-owner-case/assign-owner',headers=headers,json={"owner":"operator@example.com"}).status_code==200
        workers.tick(m,notification_adapter=adapter)
        release.set();stale.result(timeout=10)
    with m.SessionLocal() as db:
        case=db.get(journey.Handoff,"stale-owner-case")
        assert case.notification==notification and case.generation==2
        assert db.get(m.Lead,lead_id).automation_paused
    workers.tick(m,notification_adapter=adapter)
    assert adapter.notify.call_count==1


@pytest.mark.parametrize("kind",["reply","case"])
def test_concurrent_first_schedule_writes_do_not_abort_either_tick(service,monkeypatch,kind):
    m,_,_=service;body=real_sales_fixture(monkeypatch,"chat")
    if kind=="reply":
        with m.SessionLocal() as db:sales.ingest(db,body)
    else:
        monkeypatch.setenv("MARKETING_HANDOFF_OWNER","operator@example.com")
        monkeypatch.setenv("MARKETING_HANDOFF_DESTINATION","https://synthetic.invalid/staff")
        monkeypatch.setenv("MARKETING_HANDOFF_NOTIFICATIONS_ENABLED","true")
        with m.SessionLocal() as db:
            db.add(journey.Handoff(id="concurrent-schedule",lead_id="lead",owner="operator@example.com",status="open",notification="pending",history=[]));db.commit()
    barrier=threading.Barrier(2);local=threading.local();execute=m.SessionLocal.class_.execute;merge=m.SessionLocal.class_.merge
    def synchronize():
        if not getattr(local,"waited",False):local.waited=True;barrier.wait(timeout=10)
    def atomic_write(db,statement,*args,**kwargs):
        if getattr(statement,"is_insert",False) and statement.table.name==sales.QueueSchedule.__tablename__:synchronize()
        return execute(db,statement,*args,**kwargs)
    def old_merge(db,instance,*args,**kwargs):
        result=merge(db,instance,*args,**kwargs)
        if isinstance(instance,sales.QueueSchedule):synchronize()
        return result
    monkeypatch.setattr(m.SessionLocal.class_,"execute",atomic_write)
    monkeypatch.setattr(m.SessionLocal.class_,"merge",old_merge)
    sender=Mock();sender.send.return_value={"status":"accepted","provider_id":"synthetic"}
    notifier=Mock();notifier.notify.return_value=True
    def tick():return workers.tick(m,sales_adapter=sender,notification_adapter=notifier)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(tick) for _ in range(2)]
        for future in futures:future.result(timeout=15)
    assert (sender.send.call_count if kind=="reply" else notifier.notify.call_count)==1
    with m.SessionLocal() as db:assert len(db.scalars(select(sales.QueueSchedule)).all())==1


def test_reservation_crossing_an_hour_is_cancelled_unsent_before_transport(service,monkeypatch):
    m,_,_=service;body=real_sales_fixture(monkeypatch,"chat")
    at=sales.clock().replace(minute=59,second=59,microsecond=0);monkeypatch.setattr(sales,"clock",lambda:at)
    with m.SessionLocal() as db:reply=sales.ingest(db,body);identity=reply.id;key=reply.conversation_id
    def crossed(_):
        nonlocal at
        at=at+timedelta(seconds=2);return True
    monkeypatch.setattr(workers,"source_ready",crossed)
    requests=[]
    adapter=workers.SalesAdapter(m,transport=httpx.MockTransport(lambda request:(requests.append(request) or httpx.Response(200,json={"id":"synthetic"}))))
    with m.SessionLocal() as db:
        assert sales.dispatch(db,identity,adapter)=="unconfigured"
        assert db.get(sales.Reply,identity).status=="prepared"
        assert db.get(sales.DispatchGuard,key).active_reply is None
        assert db.get(sales.DispatchGuard,key).attempts==0
    assert requests==[]
    monkeypatch.setattr(workers,"source_ready",lambda _:True)
    with m.SessionLocal() as db:assert sales.dispatch(db,identity,adapter)=="accepted"
    for i in range(4):
        with m.SessionLocal() as db:
            next_reply=sales.ingest(db,{**body,"event_id":f"new-hour-{i}"})
            sales.dispatch(db,next_reply.id,adapter)
    assert len(requests)==4

@pytest.mark.parametrize("stage",["before_claim","after_claim"])
def test_resolved_case_is_not_notified_by_already_selected_worker(service,monkeypatch,stage):
    m,_,_=service;enable(monkeypatch)
    monkeypatch.setenv("MARKETING_HANDOFF_OWNER","operator@example.com")
    monkeypatch.setenv("MARKETING_HANDOFF_DESTINATION","https://synthetic.invalid/staff")
    monkeypatch.setenv("MARKETING_HANDOFF_NOTIFICATIONS_ENABLED","true")
    with m.SessionLocal() as db:
        db.add(journey.Handoff(id="resolved-race",lead_id="lead",owner="operator@example.com",status="open",notification="pending",history=[]));db.commit()
    entered=threading.Event();release=threading.Event();schedule=workers.schedule_work;refresh=m.SessionLocal.class_.refresh
    def wait():entered.set();assert release.wait(10)
    def scheduled(db,*args):
        if stage=="before_claim":wait()
        return schedule(db,*args)
    def refreshed(db,instance,*args,**kwargs):
        if stage=="after_claim" and isinstance(instance,journey.Handoff) and not entered.is_set():wait()
        return refresh(db,instance,*args,**kwargs)
    monkeypatch.setattr(workers,"schedule_work",scheduled);monkeypatch.setattr(m.SessionLocal.class_,"refresh",refreshed)
    adapter=Mock();adapter.notify.return_value=True
    with ThreadPoolExecutor(max_workers=1) as pool:
        task=pool.submit(workers.tick,m,notification_adapter=adapter);assert entered.wait(10)
        with m.SessionLocal() as writer:
            case=writer.get(journey.Handoff,"resolved-race");case.status="resolved";writer.commit()
        release.set();task.result(timeout=10)
    adapter.notify.assert_not_called()
    with m.SessionLocal() as db:assert db.get(journey.Handoff,"resolved-race").status=="resolved"


@pytest.mark.parametrize("notification",["accepted","uncertain"])
def test_repeated_handoff_inbound_and_configuration_loss_preserve_terminal_notification(service,monkeypatch,notification):
    m,_,_=service;enable(monkeypatch)
    monkeypatch.setenv("MARKETING_HANDOFF_OWNER","operator@example.com")
    monkeypatch.setenv("MARKETING_HANDOFF_DESTINATION","https://synthetic.invalid/staff")
    monkeypatch.setenv("MARKETING_HANDOFF_NOTIFICATIONS_ENABLED","true")
    with m.SessionLocal() as db:
        lead=m.Lead(email="synthetic@example.com",automation_paused=True);db.add(lead);db.flush();lead_id=lead.id
        case=journey.open_handoff(m,db,lead,"email","initial");case.notification=notification;db.commit();case_id=case.id
    monkeypatch.delenv("MARKETING_HANDOFF_DESTINATION")
    with m.SessionLocal() as db:
        case=journey.open_handoff(m,db,db.get(m.Lead,lead_id),"email","repeat")
        db.commit();assert case.notification==notification;assert case.generation==1
    monkeypatch.setenv("MARKETING_HANDOFF_DESTINATION","https://synthetic.invalid/staff")
    adapter=Mock();workers.tick(m,notification_adapter=adapter);adapter.notify.assert_not_called()
    # A genuinely reopened case is a new generation and can notify once.
    with m.SessionLocal() as db:
        db.get(journey.Handoff,case_id).status="resolved";db.commit()
        case=journey.open_handoff(m,db,db.get(m.Lead,lead_id),"email","new-question");db.commit()
        assert case.generation==2 and case.notification=="pending"
    adapter.notify.return_value=True
    assert workers.tick(m,notification_adapter=adapter)["notifications"]==1

@pytest.mark.parametrize("notification",["accepted","uncertain"])
def test_open_handoff_refreshes_cached_case_before_availability_write(service,monkeypatch,notification):
    m,_,_=service;enable(monkeypatch)
    monkeypatch.setenv("MARKETING_HANDOFF_OWNER","operator@example.com")
    monkeypatch.setenv("MARKETING_HANDOFF_DESTINATION","https://synthetic.invalid/staff")
    with m.SessionLocal() as db:
        lead=m.Lead(email="synthetic@example.com",automation_paused=True);db.add(lead);db.flush();lead_id=lead.id
        case=journey.open_handoff(m,db,lead,"email","initial");db.commit();case_id=case.id
    with m.SessionLocal() as stale:
        cached=stale.get(journey.Handoff,case_id)
        with m.SessionLocal() as writer:
            writer.get(journey.Handoff,case_id).notification=notification;writer.commit()
        monkeypatch.delenv("MARKETING_HANDOFF_DESTINATION")
        case=journey.open_handoff(m,stale,stale.get(m.Lead,lead_id),"email","repeated")
        stale.commit()
        assert case is cached and case.notification==notification and case.generation==1
    with m.SessionLocal() as reader:assert reader.get(journey.Handoff,case_id).notification==notification

@pytest.mark.parametrize("channel",["chat","whatsapp"])
@pytest.mark.parametrize("receipt",[False,True])
def test_post_check_submission_cannot_be_revoked_or_reassigned(service,monkeypatch,channel,receipt):
    from sqlalchemy import text
    from fastapi import HTTPException
    m,_,_=service;body=real_sales_fixture(monkeypatch,channel);one,two,key=prepare_pair(m,body)
    entered=threading.Event();release=threading.Event();requests=[];post=httpx.Client.post
    def paused_post(client,*args,**kwargs):
        entered.set();assert release.wait(10)
        return post(client,*args,**kwargs)
    monkeypatch.setattr(httpx.Client,"post",paused_post)
    adapter=workers.SalesAdapter(m,transport=httpx.MockTransport(lambda request:(requests.append(request) or httpx.Response(200,json={"id":"synthetic-accepted"}))))
    def submit():
        with m.SessionLocal() as db:return sales.dispatch(db,one,adapter)
    with ThreadPoolExecutor(max_workers=1) as pool:
        task=pool.submit(submit);assert entered.wait(10)
        try:
            assert requests==[] # Paused after final validation, before transport.
            with m.SessionLocal() as other:
                other.execute(text("PRAGMA busy_timeout=0"))
                with pytest.raises(HTTPException) as busy:sales.reconcile(other,one,**({"provider_id":"authenticated-receipt"} if receipt else {"definitely_not_sent":True}))
                assert busy.value.status_code==409
                other.rollback()
            with m.SessionLocal() as other:
                assert other.get(sales.DispatchGuard,key).active_reply==one
                assert sales.dispatch(other,two,adapter)=="reconciliation_required"
            assert requests==[]
        finally:release.set()
        assert task.result(timeout=10)=="accepted"
    assert len(requests)==1


@pytest.mark.parametrize("channel",["chat","whatsapp"])
def test_durable_armed_attempt_survives_lost_transaction_and_unknown_receipt(service,monkeypatch,channel):
    from fastapi import HTTPException
    m,_,_=service;body=real_sales_fixture(monkeypatch,channel);one,two,key=prepare_pair(m,body)
    local=threading.local();lock=getattr(sales,"lock_dispatch",None);post=httpx.Client.post;requests=[]
    if lock:
        def capture(db,key):local.db=db;return lock(db,key)
        monkeypatch.setattr(sales,"lock_dispatch",capture)
    def lost_transaction(client,*args,**kwargs):
        # Simulate losing coordination after the final check. The durable arm
        # must still prevent a not-found observation from granting reassignment.
        if lock:local.db.rollback()
        with m.SessionLocal() as other:
            with pytest.raises(HTTPException) as error:sales.reconcile(other,one,definitely_not_sent=True)
            assert error.value.status_code==409
        return post(client,*args,**kwargs)
    monkeypatch.setattr(httpx.Client,"post",lost_transaction)
    adapter=workers.SalesAdapter(m,transport=httpx.MockTransport(lambda request:(requests.append(request) or httpx.Response(503))))
    with m.SessionLocal() as db:assert sales.dispatch(db,one,adapter)=="unknown"
    assert len(requests)==1
    with m.SessionLocal() as db:
        assert db.get(sales.DispatchGuard,key).submission_state=="armed"
        with pytest.raises(HTTPException):sales.reconcile(db,one,definitely_not_sent=True)
        assert sales.dispatch(db,two,adapter)=="reconciliation_required"
        assert sales.reconcile(db,one,provider_id="authenticated-provider-receipt")=="accepted"
        assert db.get(sales.DispatchGuard,key).active_reply is None
        assert db.get(sales.Conversation,key).status=="paused" # Never auto-resume.


@pytest.mark.parametrize("change",["gate","hour","window","consent"])
def test_submission_rechecks_policy_after_coordination_wait(service,monkeypatch,change):
    m,_,_=service;body={**real_sales_fixture(monkeypatch,"whatsapp"),"consent":True}
    at=sales.clock().replace(minute=59,second=59,microsecond=0);monkeypatch.setattr(sales,"clock",lambda:at)
    template=None
    if change=="consent":
        content={"text":"Reviewed synthetic template","cta_url":sales.CTA}
        template={"id":"synthetic-approved","approved":True,"content":content}
        monkeypatch.setenv("MARKETING_SALES_WHATSAPP_TEMPLATE",template["id"])
        monkeypatch.setenv("MARKETING_SALES_WHATSAPP_TEMPLATE_SHA256",journey.fingerprint(content))
        monkeypatch.setenv("MARKETING_SALES_WHATSAPP_APPROVED_TEMPLATE",json.dumps(template))
    with m.SessionLocal() as db:
        reply=sales.ingest(db,body);identity=reply.id;key=reply.conversation_id
        if change=="consent":db.get(sales.Conversation,key).inbound_at=(at-timedelta(hours=25)).isoformat();db.commit()
    entered=threading.Event();release=threading.Event();local=threading.local();lock=sales.lock_dispatch;requests=[]
    def delayed(db,key):
        if not getattr(local,"waited",False):local.waited=True;entered.set();assert release.wait(10)
        return lock(db,key)
    monkeypatch.setattr(sales,"lock_dispatch",delayed)
    adapter=workers.SalesAdapter(m,transport=httpx.MockTransport(lambda request:(requests.append(request) or httpx.Response(200,json={"id":"synthetic"}))))
    def submit():
        with m.SessionLocal() as db:return sales.dispatch(db,identity,adapter,template=template)
    with ThreadPoolExecutor(max_workers=1) as pool:
        task=pool.submit(submit);assert entered.wait(10)
        if change=="gate":monkeypatch.setenv("MARKETING_OUTBOUND_ENABLED","false")
        elif change=="hour":at=at+timedelta(seconds=2)
        elif change=="window":at=at+timedelta(hours=25)
        else:
            with m.SessionLocal() as db:db.get(sales.Conversation,key).consent=0;db.commit()
        release.set();assert task.result(timeout=10)=="unconfigured"
    assert requests==[]
    with m.SessionLocal() as db:
        guard=db.get(sales.DispatchGuard,key)
        assert guard.active_reply is None and guard.submission_state is None and guard.attempts==0



def test_submission_and_reconciliation_finish_use_consistent_guard_first_order(service,monkeypatch):
    m,_,_=service;body=real_sales_fixture(monkeypatch,"chat");one,two,key=prepare_pair(m,body)
    entered=threading.Event();release=threading.Event();local=threading.local();lock=sales.lock_dispatch
    def finish_wait(db,key):
        if getattr(local,"sender",False) and not getattr(local,"waited",False):
            local.waited=True;entered.set();assert release.wait(10)
        return lock(db,key)
    monkeypatch.setattr(sales,"lock_dispatch",finish_wait)
    adapter=Mock();adapter.send.return_value={"status":"unknown"}
    def send():
        local.sender=True
        with m.SessionLocal() as db:return sales.dispatch(db,one,adapter)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(send);assert entered.wait(10)
        with m.SessionLocal() as other:assert sales.reconcile(other,one,provider_id="authenticated-receipt")=="accepted"
        release.set();assert future.result(timeout=10)=="reconciliation_required"
    with m.SessionLocal() as db:
        assert db.get(sales.Reply,one).status=="accepted"
        assert db.get(sales.DispatchGuard,key).active_reply is None
    assert adapter.send.call_count==1


def test_submission_phase_upgrade_preserves_legacy_unknown_hold(service):
    from sqlalchemy import text,inspect
    from fastapi import HTTPException
    m,_,_=service
    with m.engine.begin() as connection:
        connection.execute(text("DROP TABLE marketing_sales_dispatch_guards"))
        connection.execute(text("CREATE TABLE marketing_sales_dispatch_guards (conversation_id VARCHAR(64) PRIMARY KEY, active_reply VARCHAR(128),token VARCHAR(36),hour VARCHAR(20) NOT NULL,attempts INTEGER NOT NULL)"))
        connection.execute(text("INSERT INTO marketing_sales_dispatch_guards VALUES ('legacy','legacy-reply','preserved-token','2026-01-01T00',1)"))
    journey.install(m);journey.install(m)
    assert "submission_state" in {c["name"] for c in inspect(m.engine).get_columns(sales.DispatchGuard.__tablename__)}
    with m.SessionLocal() as db:
        guard=db.get(sales.DispatchGuard,"legacy")
        assert guard.active_reply=="legacy-reply" and guard.token=="preserved-token" and guard.submission_state is None
        db.add(sales.Reply(id="legacy-reply",fingerprint="synthetic",conversation_id="legacy",status="unknown",payload={},attempts=1));db.commit()
        with pytest.raises(HTTPException) as error:sales.reconcile(db,"legacy-reply",definitely_not_sent=True)
        assert error.value.status_code==409
        assert db.get(sales.DispatchGuard,"legacy").active_reply=="legacy-reply"



def test_owner_precontact_rejection_after_stale_recovery_can_be_reconciled_unsent(service,monkeypatch):
    m,_,_=service;body=real_sales_fixture(monkeypatch,"chat");one,two,key=prepare_pair(m,body)
    entered=threading.Event();release=threading.Event();local=threading.local();lock=sales.lock_dispatch;requests=[]
    def wait_before_lock(db,key):
        if not getattr(local,"waited",False):local.waited=True;entered.set();assert release.wait(10)
        return lock(db,key)
    monkeypatch.setattr(sales,"lock_dispatch",wait_before_lock)
    adapter=workers.SalesAdapter(m,transport=httpx.MockTransport(lambda request:(requests.append(request) or httpx.Response(200,json={"id":"synthetic"}))))
    def send():
        with m.SessionLocal() as db:return sales.dispatch(db,one,adapter)
    with ThreadPoolExecutor(max_workers=1) as pool:
        old=pool.submit(send);assert entered.wait(10)
        with m.SessionLocal() as writer:
            writer.get(sales.Reply,one).status="unknown";sales.hold_conversation(writer,key);writer.commit()
        release.set();assert old.result(timeout=10)=="reconciliation_required"
    assert requests==[]
    with m.SessionLocal() as db:
        assert db.get(sales.Reply,one).status=="unknown"
        assert db.get(sales.DispatchGuard,key).submission_state=="preparing"
        assert sales.reconcile(db,one,definitely_not_sent=True)=="rejected"
        assert db.get(sales.Conversation,key).status=="paused"
