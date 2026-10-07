"""The public welcome layout is opt-in and independent of GuestHub selection."""
import pytest
from conftest import _Session
from app.models import Event
from app.schemas import InviteSettingsUpdate


def test_landing_layout_validation():
    for value in ('current', 'welcome'):
        assert InviteSettingsUpdate(rsvp_landing_layout=value).rsvp_landing_layout == value
    with pytest.raises(ValueError):
        InviteSettingsUpdate(rsvp_landing_layout='app')
    assert InviteSettingsUpdate().rsvp_landing_layout is None


@pytest.mark.asyncio
async def test_landing_selection_persists_is_public_and_reversible(ctx):
    ctx.login(ctx.ids['user_a'])
    event_id = ctx.ids['event_a']
    url = f'/api/events/{event_id}/invite-settings'
    async with _Session() as db:
        event = await db.get(Event, event_id)
        event.guest_hub_layout = 'app'
        await db.commit()
    result = await ctx.client.put(url, json={'rsvp_landing_layout': 'welcome'})
    assert result.status_code == 200, result.text
    assert result.json()['rsvp_landing_layout'] == 'welcome'
    assert result.json()['guest_hub_layout'] == 'app'
    public = await ctx.client.get(f'/api/invite/link/{result.json()["rsvp_token"]}')
    assert public.status_code == 200, public.text
    assert public.json()['rsvp_landing_layout'] == 'welcome'
    assert public.json()['guest_hub_layout'] == 'app'
    # Unrelated settings writes must not reset the landing choice.
    assert (await ctx.client.put(url, json={'invite_message': 'A new welcome'})).status_code == 200
    async with _Session() as db:
        event = await db.get(Event, event_id)
        assert event.rsvp_landing_layout == 'welcome'
        assert event.guest_hub_layout == 'app'
    assert (await ctx.client.put(url, json={'rsvp_landing_layout': 'current'})).json()['rsvp_landing_layout'] == 'current'
    assert (await ctx.client.put(url, json={'rsvp_landing_layout': 'invalid'})).status_code == 422
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.put(url, json={'rsvp_landing_layout': 'welcome'})).status_code in (403, 404)
