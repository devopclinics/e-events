"""Exercise the real GuestHub response without production DB or app lifespan."""
import importlib.util
import sys
from datetime import datetime
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.mark.asyncio
@pytest.mark.parametrize("rsvp_enabled,status", [(True, "confirmed"), (False, "invited")])
async def test_guesthub_festiome_link_matches_adult_approval(monkeypatch, rsvp_enabled, status):
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite://")
    module_name = "messaging_festiome_access_test"
    spec = importlib.util.spec_from_file_location(module_name, Path(__file__).parents[1] / "app/main.py")
    service = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = service
    spec.loader.exec_module(service)
    engine = create_async_engine("sqlite+aiosqlite://")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(service.Base.metadata.create_all)
    async with sessions() as db:
        db.add(service.Organization(id="org", is_active=True))
        db.add(service.Event(
            id="event", org_id="org", name="Adult community", event_date=datetime(2026, 12, 24),
            rsvp_enabled=rsvp_enabled, festiome_addon_enabled=True, festiome_enabled=True,
            festiome_access_policy={"mode": "approved_adults", "adult_guest_ids": ["adult"]},
        ))
        for guest_id in ["adult", "unapproved"]:
            db.add(service.Guest(id=guest_id, event_id="event", first_name=guest_id,
                                 last_name="Guest", qr_token=guest_id + "-pass", rsvp_status=status))
        db.add(service.EventGuestMessagingSettings(
            event_id="event", guest_hub_enabled=True, announcements_enabled=False,
            direct_host_messages_enabled=False, guest_chat_enabled=False,
        ))
        await db.commit()

    async def test_db():
        async with sessions() as db:
            yield db

    service.app.dependency_overrides[service.get_db] = test_db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=service.app), base_url="http://test") as client:
            async def hub(guest_id):
                response = await client.get("/api/messaging/events/event/guest-hub",
                                            headers={"Authorization": "Bearer " + guest_id + "-pass"})
                assert response.status_code == 200, response.text
                return response.json()

            assert (await hub("adult"))["capabilities"]["festiome"] is True
            denied_hub = await hub("unapproved")
            assert denied_hub["capabilities"]["festiome"] is False
            assert denied_hub["guest"]["qr_token"] == "unapproved-pass"

            async with sessions() as db:
                event = await db.get(service.Event, "event")
                event.festiome_access_policy = {"mode": "approved_adults", "adult_guest_ids": ["adult", "unapproved"]}
                await db.commit()
            assert (await hub("unapproved"))["capabilities"]["festiome"] is True

            async with sessions() as db:
                event = await db.get(service.Event, "event")
                event.festiome_access_policy = None
                event.blocked_comm_features = ["festiome"]
                await db.commit()
            assert (await hub("adult"))["capabilities"]["festiome"] is False
    finally:
        service.app.dependency_overrides.clear()
        await engine.dispose()
        await service.engine.dispose()
        await service.redis_client.aclose()
        sys.modules.pop(module_name, None)
