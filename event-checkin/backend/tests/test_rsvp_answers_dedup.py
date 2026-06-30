"""RSVP improvements: duplicate-RSVP guard (email OR phone) and the organizer's
read-only view of guests' answers to custom questions."""
import pytest
from sqlalchemy import delete

from app.models import Event, Guest, RSVPQuestion
from conftest import _Session


async def _open_event(ev):
    async with _Session() as s:
        e = await s.get(Event, ev)
        e.rsvp_enabled = True
        e.invite_mode = "open"
        e.rsvp_require_approval = False
        e.is_paid = True
        await s.execute(delete(Guest).where(Guest.event_id == ev))
        await s.commit()


@pytest.mark.asyncio
async def test_rsvp_blocks_duplicate_by_email(ctx):
    ev = ctx.ids["event_a"]
    await _open_event(ev)
    body = {"first_name": "A", "last_name": "B", "email": "dup@example.com"}
    first = await ctx.client.post(f"/api/invite/{ev}/rsvp", json=body)
    assert first.status_code == 201
    again = await ctx.client.post(f"/api/invite/{ev}/rsvp", json=body)
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_rsvp_blocks_duplicate_by_phone_no_email(ctx):
    """The gap that was reported: a phone-only RSVP could be submitted over and
    over. It must now be blocked the second time."""
    ev = ctx.ids["event_a"]
    await _open_event(ev)
    body = {"first_name": "P", "last_name": "Q", "phone": "+14155550123"}
    first = await ctx.client.post(f"/api/invite/{ev}/rsvp", json=body)
    assert first.status_code == 201, first.text
    again = await ctx.client.post(f"/api/invite/{ev}/rsvp", json=body)
    assert again.status_code == 409, again.text


@pytest.mark.asyncio
async def test_rsvp_answers_visible_to_organizer(ctx):
    ev = ctx.ids["event_a"]
    await _open_event(ev)
    async with _Session() as s:
        s.add(RSVPQuestion(event_id=ev, question="Dietary?", question_type="text", sort_order=0))
        s.add(RSVPQuestion(event_id=ev, question="Plus one?", question_type="boolean", sort_order=1))
        await s.commit()
        qs = {q.question: q.id for q in (await s.execute(
            __import__("sqlalchemy").select(RSVPQuestion).where(RSVPQuestion.event_id == ev)
        )).scalars()}

    r = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Ada", "last_name": "Lovelace", "email": "ada@example.com",
        "answers": {qs["Dietary?"]: "Vegetarian", qs["Plus one?"]: "yes"},
    })
    assert r.status_code == 201
    gid = r.json()["id"]

    ctx.login(ctx.ids["superadmin"])
    ans = await ctx.client.get(f"/api/events/{ev}/guests/{gid}/rsvp-answers")
    assert ans.status_code == 200, ans.text
    by_q = {a["question"]: a["answer"] for a in ans.json()}
    assert by_q == {"Dietary?": "Vegetarian", "Plus one?": "yes"}
    # Ordered by the question sort_order.
    assert [a["question"] for a in ans.json()] == ["Dietary?", "Plus one?"]


@pytest.mark.asyncio
async def test_guest_export_includes_answers(ctx):
    import sqlalchemy
    ev = ctx.ids["event_a"]
    await _open_event(ev)
    async with _Session() as s:
        s.add(RSVPQuestion(event_id=ev, question="Meal?", question_type="text", sort_order=0))
        await s.commit()
        qid = (await s.execute(
            sqlalchemy.select(RSVPQuestion.id).where(RSVPQuestion.event_id == ev)
        )).scalar_one()
    r = await ctx.client.post(f"/api/invite/{ev}/rsvp", json={
        "first_name": "Mo", "last_name": "Khan", "email": "mo@example.com",
        "answers": {qid: "Fish"},
    })
    assert r.status_code == 201

    ctx.login(ctx.ids["superadmin"])
    exp = await ctx.client.get(f"/api/events/{ev}/guests/export?fmt=csv")
    assert exp.status_code == 200, exp.text
    assert exp.headers["content-type"].startswith("text/csv")
    body = exp.text
    assert "Meal?" in body          # the question becomes a column header
    assert "Fish" in body           # the guest's answer is in their row
    assert "Mo" in body and "Khan" in body
