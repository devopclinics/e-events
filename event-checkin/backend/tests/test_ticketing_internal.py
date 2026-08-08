import pytest
from sqlalchemy import select
from app.config import settings
from app.models import Guest, TicketType
from conftest import _Session


@pytest.mark.asyncio
async def test_ticketing_token_is_event_scoped(ctx, monkeypatch):
    monkeypatch.setattr(settings, "ticketing_internal_token", "x" * 40)
    ctx.login(ctx.ids["user_a"])
    response = await ctx.client.post(f"/api/auth/ticketing-token?event_id={ctx.ids['event_a']}")
    assert response.status_code == 200
    assert response.json()["token"]


@pytest.mark.asyncio
async def test_paid_order_fulfillment_is_authenticated_and_idempotent(ctx, monkeypatch):
    monkeypatch.setattr(settings, "ticketing_internal_token", "ticketing-test-secret")
    event_id = ctx.ids["event_a"]
    async with _Session() as db:
        access = TicketType(event_id=event_id, name="VIP")
        db.add(access); await db.commit(); await db.refresh(access)
        access_id = access.id
    body = {"order_id": "order-123", "event_id": event_id, "buyer_email": "buyer@example.com",
            "attendees": [{"first_name": "Ada", "last_name": "Guest", "email": "ada@example.com",
                           "access_ticket_type_id": access_id, "product_name": "VIP Admission"}]}
    denied = await ctx.client.post("/api/internal/ticketing/fulfill", json=body)
    assert denied.status_code == 401
    first = await ctx.client.post("/api/internal/ticketing/fulfill", json=body,
                                  headers={"X-Internal-Token": "ticketing-test-secret"})
    assert first.status_code == 200
    assert first.json()["already_fulfilled"] is False
    assert first.json()["passes"][0]["qr_token"]
    again = await ctx.client.post("/api/internal/ticketing/fulfill", json=body,
                                  headers={"X-Internal-Token": "ticketing-test-secret"})
    assert again.status_code == 200
    assert again.json()["already_fulfilled"] is True
    async with _Session() as db:
        rows = (await db.execute(select(Guest).where(Guest.paid_ticket_order_id == "order-123"))).scalars().all()
        assert len(rows) == 1
        assert rows[0].rsvp_status == "confirmed"
        assert rows[0].ticket_type_id == access_id
        assert rows[0].rsvp_notes is None
    voided = await ctx.client.post(f"/api/internal/ticketing/void/{event_id}/order-123",
                                   headers={"X-Internal-Token": "ticketing-test-secret"})
    assert voided.status_code == 200
    assert voided.json()["voided"] == 1
    async with _Session() as db:
        row = await db.scalar(select(Guest).where(Guest.paid_ticket_order_id == "order-123"))
        assert row.rsvp_status == "declined"
