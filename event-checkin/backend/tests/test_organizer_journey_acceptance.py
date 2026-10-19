"""Synthetic core sources -> durable outbox -> real Marketing consumer contract."""
import importlib
import importlib.util
import json
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, delete

from conftest import _Session
from app.models import Event, Guest, MarketingOutbox, Membership, Organization, Payment
from app.services import marketing_outbox
from app.routers.guests import _process_csv
from app.config import settings
from app.engagement_config import engagement_settings


@pytest.fixture(autouse=True)
def no_real_provider_transport(monkeypatch):
    def reject(*args, **kwargs):
        raise AssertionError("Real provider transport forbidden in journey acceptance")
    async def reject_async(*args, **kwargs):
        raise AssertionError("Real provider transport forbidden in journey acceptance")
    monkeypatch.setattr(httpx.HTTPTransport,"handle_request",reject)
    monkeypatch.setattr(httpx.AsyncHTTPTransport,"handle_async_request",reject_async)


def consumer(tmp_path, monkeypatch):
    package = Path(__file__).resolve().parents[2] / "marketing-service" / "app"
    # Separate package namespace; both services intentionally use app.main.
    name = "synthetic_journey_marketing"
    for key in list(sys.modules):
        if key == name or key.startswith(name+"."):
            sys.modules.pop(key)
    spec = importlib.util.spec_from_file_location(name, package/"__init__.py", submodule_search_locations=[str(package)])
    module = importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    monkeypatch.setenv("MARKETING_DATABASE_URL", "sqlite:///"+str(tmp_path/"consumer.db"))
    monkeypatch.setenv("MARKETING_INTERNAL_TOKEN", "synthetic-bridge-secret")
    monkeypatch.setenv("MARKETING_SCHEDULER_ENABLED", "false")
    m = importlib.import_module(name+".main")
    return m, TestClient(m.app)


async def test_complete_real_sources_and_synthetic_rehearsals_are_distinct(ctx,signed_resend,tmp_path,monkeypatch):
    m,crm=consumer(tmp_path,monkeypatch)
    monkeypatch.setattr(settings,"planner_internal_token","synthetic-bridge-secret")
    monkeypatch.setattr(settings,"marketing_service_url","https://crm.synthetic.invalid")
    monkeypatch.setattr(engagement_settings,"marketing_outbox_enabled",True)
    ctx.login(ctx.ids["user_a"])
    event_id=ctx.ids["event_a"]
    async with _Session() as db:
        event=await db.get(Event,event_id)
        event.is_paid=True;event.plan_tier="tier300";event.status="active";event.manual_checkin_enabled=True
        event.rsvp_enabled=True;event.invite_mode="open";event.rsvp_require_approval=False
        event.notify_email=False;event.notify_sms=False;event.notify_whatsapp=False
        await db.commit()
        await _process_csv("first_name,last_name,email,is_test\nReal,Imported,real@example.org,false\nTest,Imported,test@example.org,true\n",event_id,db)
        guests=(await db.execute(select(Guest).where(Guest.event_id==event_id,Guest.first_name=="Real"))).scalars().all()
        real=guests[0];guest_id=real.id
    # Both forms are local ASGI requests. Marking a rehearsal never creates value.
    for flag,name in [(True,"Controlled"),(False,"Actual")]:
        response=await ctx.client.post(f"/api/invite/{event_id}/rsvp",json={"first_name":name,"last_name":"Response","email":name.lower()+"@example.com","is_test":flag})
        assert response.status_code==201,response.text
    result=await ctx.client.post(f"/api/events/{event_id}/guests/{guest_id}/checkin")
    assert result.status_code==200 and result.json()["status"]=="admitted",result.text
    await ctx.client.post(f"/api/events/{event_id}/guests/{guest_id}/checkin")
    response=await signed_resend({"type":"email.delivered","created_at":datetime.now(timezone.utc).isoformat(),"data":{"email_id":"synthetic-invitation","to":["real@example.org"],"tags":{"event_id":event_id,"guest_id":guest_id,"message_kind":"invitation"}}})
    assert response.status_code==200,response.text
    assert (await ctx.client.post(f"/api/events/{event_id}/organizer-observation",json={"source_id":"scoped-check","use_case":"rsvp","result":"passed"})).status_code==200
    assert (await ctx.client.patch(f"/api/events/{event_id}/status",json={"status":"ended"})).status_code==200
    from app.routers import events
    monkeypatch.setattr(events,"_notify_operators_new_event",AsyncMock())
    monkeypatch.setattr(events,"_clone_design",AsyncMock())
    copied=await ctx.client.post(f"/api/events/{event_id}/duplicate",json={"name":"Synthetic return event","event_date":(datetime.now(timezone.utc)+timedelta(days=30)).isoformat()})
    assert copied.status_code==201,copied.text
    now=datetime.now(timezone.utc)
    token=jwt.encode(dict(sub="festio-backend",email="system@festio.events",is_platform_superadmin=True,iss="guesthub",aud="marketing",iat=now,exp=now+timedelta(minutes=5)),"synthetic-bridge-secret",algorithm="HS256")
    headers={"Authorization":"Bearer "+token}
    assert crm.post("/api/marketing/internal/ingest",headers=headers,json={"event_id":"verified-synthetic-organizer","email":"alice@a.com","email_verified":True,"festio_user_id":ctx.ids["user_a"].id}).status_code==200
    def transport(request):
        response=crm.post(request.url.path,headers=dict(request.headers),json=json.loads(request.content))
        return httpx.Response(response.status_code,json=response.json())
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(transport))>=6
    with m.SessionLocal() as db:
        journey=sys.modules[m.__package__+".organizer_journey"]
        rows=db.scalars(select(journey.Evidence)).all()
        milestones={row.milestone for row in rows}
        assert {"guest_imported","invitation_delivered","rsvp_received","checkin_succeeded","rehearsal","ready","event_completed"}<=milestones
        assert len([r for r in rows if r.milestone=="rsvp_received"])==1
        assert len([r for r in rows if r.milestone=="checkin_succeeded"])==1
        assert journey.summary(rows)["completed_events"]==1
        assert journey.summary(rows)["next_event_created"] is True
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(transport))==0


async def test_current_context_revocation_and_cancellation_fail_closed(ctx,monkeypatch):
    monkeypatch.setattr(settings,"planner_internal_token","synthetic-context-key")
    event_id=ctx.ids["event_a"];account=ctx.ids["user_a"].id
    now=datetime.now(timezone.utc);challenge="a"*32
    token=jwt.encode(dict(sub="marketing-email-readiness",iss="marketing-service",aud="marketing-email-readiness",iat=now,exp=now+timedelta(seconds=30),jti=challenge),"synthetic-context-key",algorithm="HS256")
    params={"account_id":account,"event_id":event_id,"challenge":challenge}
    headers={"Authorization":"Bearer "+token}
    response=await ctx.client.get("/api/internal/marketing/organizer-context",params=params,headers=headers)
    proof=jwt.decode(response.json()["proof"],"synthetic-context-key",algorithms=["HS256"],audience="organizer-context-response")
    assert proof["current_owner"] is True and proof["org_id"]==ctx.ids["org_a"]
    async with _Session() as db:
        await db.execute(delete(Membership).where(Membership.org_id==ctx.ids["org_a"]))
        await db.commit()
    response=await ctx.client.get("/api/internal/marketing/organizer-context",params=params,headers=headers)
    proof=jwt.decode(response.json()["proof"],"synthetic-context-key",algorithms=["HS256"],audience="organizer-context-response")
    assert proof["current_owner"] is False and proof["org_id"] is None and proof["event_date"] is None


async def test_commerce_sources_preserve_amount_proof_and_distinguish_renewals(ctx,monkeypatch):
    from types import SimpleNamespace
    from app.routers import billing,org_billing
    monkeypatch.setattr(settings,"organization_entitlements_v2",False)
    monkeypatch.setattr(billing,"get_plan",AsyncMock(return_value=SimpleNamespace(kind="tier")))
    monkeypatch.setattr(billing,"apply_purchase",Mock())
    async with _Session() as db:
        for ref,amount in [("real-pass",1000),("free-pass",0),("test-pass",1000),("unproven-pass",1000)]:
            db.add(Payment(org_id=ctx.ids["org_a"],event_id=ctx.ids["event_a"],provider="stripe",reference=ref,tier_key="tier300",amount=amount,currency="USD",status="pending"))
        org=await db.get(Organization,ctx.ids["org_a"]);org.stripe_subscription_id="synthetic-sub"
        await db.commit()
        for ref,amount,synthetic in [("real-pass",1000,False),("free-pass",0,False),("test-pass",1000,True),("unproven-pass",1000,None)]:
            await billing._fulfill(db,"stripe",ref,ctx.ids["event_a"],"tier300",synthetic=synthetic,paid_amount=amount,paid_currency="usd")
        await billing._fulfill(db,"stripe","real-pass",ctx.ids["event_a"],"tier300",synthetic=False,paid_amount=1000,paid_currency="USD")
        invoice={"subscription":"synthetic-sub","id":"synthetic-invoice","billing_reason":"subscription_cycle","amount_paid":1200,"currency":"usd"}
        await org_billing.capture_stripe_invoice(db,invoice,synthetic=False)
        await org_billing.capture_stripe_invoice(db,invoice,synthetic=False)
        rows=(await db.execute(select(MarketingOutbox).where(MarketingOutbox.endpoint=="commerce-facts"))).scalars().all()
        assert len(rows)==2
        assert {r.payload["kind"] for r in rows}=={"event_pass","subscription_renewed"}
        assert {r.payload["amount"] for r in rows}=={1000,1200}


async def test_historical_unknown_and_rehearsal_provenance_never_become_real_outcomes(ctx):
    from app.services.marketing_client import capture_organizer_outcome
    from app.db_migrate import _column_add_ddl
    for model in (Event,Guest):
        ddl=_column_add_ddl(model.__table__.c.is_test).upper()
        assert "DEFAULT" not in ddl and "NOT NULL" not in ddl
    async with _Session() as db:
        event=await db.get(Event,ctx.ids["event_a"]);event.is_test=None;await db.commit()
        assert await capture_organizer_outcome(db,event,milestone="rsvp_received",source_id="unknown",use_case="rsvp",synthetic=False) is None
        event.is_test=True;await db.commit()
        await _process_csv("first_name,last_name,email\nControlled,Rehearsal,controlled@example.org\n",event.id,db)
        assert not (await db.execute(select(MarketingOutbox).where(MarketingOutbox.endpoint=="organizer-milestones"))).scalars().all()
        cancel=Event(org_id=ctx.ids["org_a"],name="Synthetic cancellation",couples_name="",event_date=datetime(2026,12,1),checkin_base_url="http://synthetic",is_test=False)
        db.add(cancel);await db.commit();cancel_id=cancel.id
    ctx.login(ctx.ids["user_a"])
    response=await ctx.client.patch(f"/api/events/{cancel_id}/status",json={"status":"cancelled"})
    assert response.status_code==200 and response.json()["status"]=="ended" and response.json()["cancelled"] is True
    async with _Session() as db:
        kinds=[r.payload["milestone"] for r in (await db.execute(select(MarketingOutbox).where(MarketingOutbox.endpoint=="organizer-milestones"))).scalars()]
        assert kinds==["event_cancelled"]


async def test_sales_readiness_blocks_captured_unprocessed_stop(ctx,monkeypatch):
    monkeypatch.setattr(settings,"planner_internal_token","synthetic-readiness-key")
    now=datetime.now(timezone.utc);challenge="b"*32
    token=jwt.encode(dict(sub="marketing-email-readiness",iss="marketing-service",aud="marketing-email-readiness",iat=now,exp=now+timedelta(seconds=30),jti=challenge),"synthetic-readiness-key",algorithm="HS256")
    async with _Session() as db:
        db.add(MarketingOutbox(id="stop-pending",endpoint="conversations",payload={},status="pending"));await db.commit()
    response=await ctx.client.get("/api/internal/marketing/sales-readiness",params={"challenge":challenge},headers={"Authorization":"Bearer "+token})
    proof=jwt.decode(response.json()["proof"],"synthetic-readiness-key",algorithms=["HS256"],audience="sales-readiness-response")
    assert proof["ready"] is False and proof["pending"]==1


async def test_reuse_copy_starts_draft_with_own_evidence_and_no_real_outcomes(ctx,monkeypatch):
    from app.routers import events
    monkeypatch.setattr(settings,"planner_internal_token","synthetic-copy-key")
    monkeypatch.setattr(settings,"marketing_service_url","https://crm.synthetic.invalid")
    monkeypatch.setattr(settings,"organization_entitlements_v2",False)
    monkeypatch.setattr(engagement_settings,"marketing_outbox_enabled",True)
    monkeypatch.setattr(events,"_clone_design",AsyncMock())
    monkeypatch.setattr(events,"_notify_operators_new_event",AsyncMock())
    async with _Session() as db:
        event=await db.get(Event,ctx.ids["event_a"]);event.is_paid=True;event.is_test=False;await db.commit()
    ctx.login(ctx.ids["user_a"])
    response=await ctx.client.post(f'/api/events/{ctx.ids["event_a"]}/duplicate',json={"event_date":"2027-01-01T10:00:00Z","name":"Synthetic next event"})
    assert response.status_code==201,response.text
    copied=response.json()
    assert copied["id"]!=ctx.ids["event_a"] and copied["status"]=="draft" and copied["is_test"] is False
    async with _Session() as db:
        assert not (await db.execute(select(Guest).where(Guest.event_id==copied["id"]))).scalars().all()
        rows=(await db.execute(select(MarketingOutbox).where(MarketingOutbox.endpoint=="organizer-milestones"))).scalars().all()
        assert {r.payload["milestone"] for r in rows}=={"event_created","configured"}
        assert all(r.payload["organizer_event_id"]==copied["id"] for r in rows)
