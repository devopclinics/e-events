import pytest
from sqlalchemy import select
from app.models import Event, GuestSpeaker, Partner
from conftest import _Session
pytestmark = pytest.mark.asyncio

async def _paid(event_id):
    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.is_paid, event.plan_tier, event.guest_cap = True, "tier50", 50
        await db.commit()

async def test_public_submission_promotes_once_to_canonical_speaker(ctx):
    await _paid(ctx.ids["event_a"]); ctx.login(ctx.ids["user_a"]); event_id=ctx.ids["event_a"]
    overview=(await ctx.client.get(f"/api/events/{event_id}/conference-center")).json(); token=overview["profile"]["public_token"]
    saved=await ctx.client.put(f"/api/events/{event_id}/conference-center/profile",json={"calls_open":True,"enabled_call_types":["speaker","abstract"],"welcome_text":"Share your proposal","deadline":None})
    assert saved.status_code==200
    submitted=await ctx.client.post(f"/api/conference-calls/{token}",json={"kind":"speaker","name":"Ada Speaker","email":"ada@example.com","organization":"Example Org","title":"A useful session","summary":"A practical session","details":{},"consent_accepted":True})
    assert submitted.status_code==201; sid=submitted.json()["id"]
    accepted=await ctx.client.patch(f"/api/events/{event_id}/conference-center/submissions/{sid}",json={"status":"accepted","review_notes":"Approved","promote":True})
    assert accepted.status_code==200 and accepted.json()["promoted_record_type"]=="speaker"
    duplicate=await ctx.client.patch(f"/api/events/{event_id}/conference-center/submissions/{sid}",json={"status":"accepted","review_notes":"Again","promote":True})
    assert duplicate.status_code==409
    async with _Session() as db:
        speakers=(await db.execute(select(GuestSpeaker).where(GuestSpeaker.event_id==event_id))).scalars().all()
        assert [x.name for x in speakers]==["Ada Speaker"]

async def test_exhibitor_reuses_partner_system_and_other_tenant_cannot_read(ctx):
    await _paid(ctx.ids["event_a"]); ctx.login(ctx.ids["user_a"]); event_id=ctx.ids["event_a"]
    overview=(await ctx.client.get(f"/api/events/{event_id}/conference-center")).json(); token=overview["profile"]["public_token"]
    await ctx.client.put(f"/api/events/{event_id}/conference-center/profile",json={"calls_open":True,"enabled_call_types":["exhibitor"],"deadline":None})
    submitted=await ctx.client.post(f"/api/conference-calls/{token}",json={"kind":"exhibitor","name":"Pat Contact","email":"pat@example.com","organization":"Community Vendor","summary":"Books and resources","website_url":"https://example.com","details":{},"consent_accepted":True})
    sid=submitted.json()["id"]
    accepted=await ctx.client.patch(f"/api/events/{event_id}/conference-center/submissions/{sid}",json={"status":"accepted","promote":True})
    assert accepted.status_code==200
    async with _Session() as db:
        partner=await db.scalar(select(Partner).where(Partner.event_id==event_id)); assert partner.name=="Community Vendor"
    ctx.login(ctx.ids["user_b"])
    assert (await ctx.client.get(f"/api/events/{event_id}/conference-center")).status_code in (403,404)
