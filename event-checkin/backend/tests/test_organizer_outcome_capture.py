"""Only temporary SQLite data and HTTP mocks; no live account/provider access."""
import httpx
from sqlalchemy import delete, select

from app.models import Event, Membership, MarketingOutbox
from app.services import marketing_client, marketing_outbox
from app.engagement_config import engagement_settings
from app.config import settings
from conftest import _Session


async def test_outcome_capture_requires_explicit_real_provenance_and_current_owner(ctx):
    async with _Session() as db:
        event = await db.get(Event, ctx.ids["event_a"])
        for provenance in (None, True, "false", 0):
            assert await marketing_client.capture_organizer_outcome(db, event, milestone="rsvp_received",
                source_id="guest-source", use_case="rsvp", synthetic=provenance) is None
        assert (await db.execute(select(MarketingOutbox))).scalars().all() == []
        identity = await marketing_client.capture_organizer_outcome(db, event, milestone="rsvp_received",
            source_id="guest-source", use_case="rsvp", synthetic=False)
        await db.commit()
        row = await db.get(MarketingOutbox, identity)
        assert row.endpoint == "organizer-milestones"
        assert row.payload["organizer_event_id"] == event.id and row.payload["event_id"] == identity
        assert row.payload["account_id"] == ctx.ids["user_a"].id
        assert "email" not in row.payload and "consent_email" not in row.payload


async def test_revoked_ownership_cancels_queued_evidence_without_transport(ctx, monkeypatch):
    async with _Session() as db:
        event = await db.get(Event, ctx.ids["event_a"])
        identity = await marketing_client.capture_organizer_outcome(db, event, milestone="guest_imported",
            source_id="import-source", use_case="guest_list", synthetic=False)
        await db.execute(delete(Membership).where(Membership.org_id == event.org_id))
        await db.commit()
    monkeypatch.setattr(engagement_settings, "marketing_outbox_enabled", True)
    monkeypatch.setattr(settings, "marketing_service_url", "https://synthetic.invalid")
    monkeypatch.setattr(settings, "planner_internal_token", "synthetic-token")
    def reject(request):
        raise AssertionError("Revoked owner must not reach transport")
    assert await marketing_outbox.process_due(transport=httpx.MockTransport(reject)) == 0
    async with _Session() as db:
        assert (await db.get(MarketingOutbox, identity)).status == "cancelled"
