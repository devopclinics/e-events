import pytest
from sqlalchemy import select
from app.models import Event, Guest, MenuCategory, MenuItem, GuestMenuChoice
from app.routers.scanner import _load_menu
from conftest import _Session

@pytest.mark.asyncio
async def test_hidden_menu_preserves_history_but_cannot_be_seen_or_selected(ctx):
    async with _Session() as db:
        event = await db.get(Event, ctx.ids['event_a'])
        event.is_paid = True; event.menu_enabled = True; event.status = 'active'
        guest = (await db.scalars(select(Guest).where(Guest.event_id == event.id))).first()
        guest.admitted = True; guest.meal_served = False
        hidden = MenuCategory(event_id=event.id, name='Rehearsal', guest_visible=False, is_required=True, selection_type='single')
        visible = MenuCategory(event_id=event.id, name='Dinner', display_only=True)
        db.add_all([hidden, visible]); await db.flush()
        item = MenuItem(event_id=event.id, category_id=hidden.id, name='Rehearsal option')
        db.add(item); await db.flush()
        choice = GuestMenuChoice(guest_id=guest.id, category_id=hidden.id, menu_item_id=item.id)
        db.add(choice); await db.commit()
        token, hidden_id, item_id, choice_id = guest.qr_token, hidden.id, item.id, choice.id
        cats, choices = await _load_menu(event.id, guest.id, db)
        assert [c.name for c in cats] == ['Dinner']
        assert choices == {'single': {}, 'multi': {}, 'combo': {}}
        assert await db.get(GuestMenuChoice, choice_id) is not None
    response = await ctx.client.post(f'/api/scan/{token}/menu', json={'single': {hidden_id: item_id}})
    assert response.status_code == 400
    async with _Session() as db:
        assert await db.get(GuestMenuChoice, choice_id) is not None
    ctx.login(ctx.ids['user_a'])
    response = await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/menu-categories")
    assert response.status_code == 200
    assert next(c for c in response.json() if c['id'] == hidden_id)['guest_visible'] is False

@pytest.mark.asyncio
async def test_menu_visibility_update_is_reversible_and_older_edits_preserve_it(ctx):
    async with _Session() as db:
        event = await db.get(Event, ctx.ids['event_a']); event.is_paid = True; event.menu_enabled = True
        category = MenuCategory(event_id=event.id, name='Lunch', guest_visible=False)
        db.add(category); await db.commit(); category_id = category.id
    ctx.login(ctx.ids['user_a'])
    url = f"/api/events/{ctx.ids['event_a']}/menu-categories/{category_id}"
    response = await ctx.client.put(url, json={'name':'Lunch'})
    assert response.status_code == 200, response.text
    assert response.json()['guest_visible'] is False
    response = await ctx.client.put(url, json={'name':'Lunch', 'guest_visible':True})
    assert response.status_code == 200 and response.json()['guest_visible'] is True
