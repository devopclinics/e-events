"""Database round trips and real settings routes; no real outcomes/providers."""
from datetime import datetime
from unittest.mock import AsyncMock
import pytest
from sqlalchemy import select
from conftest import _Session
from app.models import Event, Guest, MarketingOutbox
from app.config import settings
from app.engagement_config import engagement_settings
from app.services.marketing_client import capture_event_outcome


async def test_inserted_unknown_provenance_survives_round_trip(ctx):
    async with _Session() as db:
        unknown=Event(org_id=ctx.ids["org_a"],name="Unknown",couples_name="",event_date=datetime(2027,1,1),checkin_base_url="http://synthetic",is_test=None)
        real=Event(org_id=ctx.ids["org_a"],name="New",couples_name="",event_date=datetime(2027,1,1),checkin_base_url="http://synthetic")
        db.add_all([unknown,real]);await db.flush()
        guests=[Guest(event_id=unknown.id,first_name="Unknown",last_name="Guest",is_test=None),Guest(event_id=real.id,first_name="New",last_name="Guest")]
        db.add_all(guests);await db.commit()
        unknown_id,real_id=unknown.id,real.id;guest_ids=[g.id for g in guests]
    async with _Session() as reader:
        assert (await reader.get(Event,unknown_id)).is_test is None
        assert (await reader.get(Event,real_id)).is_test is False
        assert (await reader.get(Guest,guest_ids[0])).is_test is None
        assert (await reader.get(Guest,guest_ids[1])).is_test is False


async def test_copy_of_unknown_event_does_not_emit_real_evidence(ctx,monkeypatch):
    from app.routers import events
    monkeypatch.setattr(events,"_clone_design",AsyncMock());monkeypatch.setattr(events,"_notify_operators_new_event",AsyncMock())
    monkeypatch.setattr(settings,"organization_entitlements_v2",False)
    monkeypatch.setattr(engagement_settings,"marketing_outbox_enabled",True)
    async with _Session() as db:
        event=await db.get(Event,ctx.ids["event_a"]);event.is_test=None;event.is_paid=True;await db.commit()
    ctx.login(ctx.ids["user_a"])
    response=await ctx.client.post(f'/api/events/{ctx.ids["event_a"]}/duplicate',json={"event_date":"2027-01-01T10:00:00Z","name":"Unknown copy"})
    assert response.status_code==201,response.text
    copied=response.json()["id"]
    async with _Session() as db:
        assert (await db.get(Event,copied)).is_test is None
        rows=(await db.execute(select(MarketingOutbox).where(MarketingOutbox.endpoint=="organizer-milestones"))).scalars().all()
        assert not any(row.payload.get("organizer_event_id")==copied for row in rows)


@pytest.mark.parametrize("field,value",[("checkout_enabled",True),("menu_selection_timing","during_rsvp"),("invite_mode","closed"),("rsvp_token","changed"),("rsvp_deadline",datetime(2027,1,1)),("junior_guardian_handoff_enabled",True),("guardian_authorizations",{"synthetic":True})])
async def test_configuration_revision_changes_for_recorded_check_settings(ctx,monkeypatch,field,value):
    monkeypatch.setattr(engagement_settings,"marketing_outbox_enabled",True)
    monkeypatch.setattr(settings,"planner_internal_token","synthetic")
    monkeypatch.setattr(settings,"marketing_service_url","https://synthetic.invalid")
    async with _Session() as db:
        event=await db.get(Event,ctx.ids["event_a"]);event.is_test=False
        await capture_event_outcome(db,event,"configured","before");await db.flush()
        before=(await db.execute(select(MarketingOutbox).where(MarketingOutbox.endpoint=="organizer-milestones"))).scalars().all()[-1].payload["config_revision"]
        setattr(event,field,value)
        await capture_event_outcome(db,event,"configured","after");await db.flush()
        revisions={row.payload["config_revision"] for row in (await db.execute(select(MarketingOutbox).where(MarketingOutbox.endpoint=="organizer-milestones"))).scalars()}
        assert before in revisions and len(revisions)==2


async def test_invite_settings_and_token_rotation_publish_new_configuration(ctx,monkeypatch):
    monkeypatch.setattr(engagement_settings,"marketing_outbox_enabled",True)
    monkeypatch.setattr(settings,"planner_internal_token","synthetic")
    monkeypatch.setattr(settings,"marketing_service_url","https://synthetic.invalid")
    ctx.login(ctx.ids["user_a"]);event_id=ctx.ids["event_a"]
    async with _Session() as db:
        event=await db.get(Event,event_id);event.is_test=False;await db.commit()
    assert (await ctx.client.put(f"/api/events/{event_id}/invite-settings",json={"invite_mode":"closed"})).status_code==200
    assert (await ctx.client.post(f"/api/events/{event_id}/rsvp-link",json={"regenerate":True})).status_code==200
    async with _Session() as db:
        revisions={row.payload["config_revision"] for row in (await db.execute(select(MarketingOutbox).where(MarketingOutbox.endpoint=="organizer-milestones"))).scalars()}
        assert len(revisions)==2
