import pytest

from app.models import Event
from conftest import _Session


@pytest.mark.asyncio
async def test_create_table_rejects_duplicate_name_for_event(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        await s.commit()

    ctx.login(ctx.ids["user_a"])

    first = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/tables",
        json={"name": "Table 1", "capacity": 8, "category": None},
    )
    assert first.status_code == 201

    duplicate = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/tables",
        json={"name": "  table   1  ", "capacity": 10, "category": None},
    )
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["detail"]


@pytest.mark.asyncio
async def test_update_table_rejects_duplicate_name_for_event(ctx):
    async with _Session() as s:
        ev = await s.get(Event, ctx.ids["event_a"])
        ev.is_paid = True
        await s.commit()

    ctx.login(ctx.ids["user_a"])

    first = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/tables",
        json={"name": "Head Table", "capacity": 8, "category": None},
    )
    second = await ctx.client.post(
        f"/api/events/{ctx.ids['event_a']}/tables",
        json={"name": "Family Table", "capacity": 8, "category": None},
    )
    assert first.status_code == 201
    assert second.status_code == 201

    duplicate = await ctx.client.put(
        f"/api/events/{ctx.ids['event_a']}/tables/{second.json()['id']}",
        json={"name": "head table", "capacity": 8, "category": None},
    )
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["detail"]

@pytest.mark.asyncio
async def test_floor_table_guards(ctx):
    from sqlalchemy import select
    from app.models import Guest, TableGroup, TableGroupTable
    async with _Session() as db:
        e = await db.get(Event, ctx.ids['event_a']); e.is_paid = True
        await db.commit()
    ctx.login(ctx.ids['user_a'])
    base = f"/api/events/{ctx.ids['event_a']}/tables"
    made = await ctx.client.post(base, json={'name': 'Planner table', 'capacity': 10, 'category': 'VIP', 'service_section': 'North'})
    assert made.status_code == 201
    tid = made.json()['id']
    async with _Session() as db:
        guest = await db.scalar(select(Guest).where(Guest.event_id == ctx.ids['event_a']))
        guest.table_id = tid; guest.seat_number = '9'; guest.held_seat = '10'; gid = guest.id
        await db.commit()
    body = {'name': 'Renamed', 'capacity': 9, 'category': 'VIP', 'service_section': 'North'}
    r = await ctx.client.put(f'{base}/{tid}?protect_assigned=true', json=body)
    assert r.status_code == 409 and '10' in r.json()['detail']
    assert (await ctx.client.delete(f'{base}/{tid}?require_empty=true')).status_code == 409
    body['capacity'] = 12
    saved = await ctx.client.put(f'{base}/{tid}?protect_assigned=true', json=body)
    assert saved.status_code == 200 and saved.json()['name'] == 'Renamed' and saved.json()['service_section'] == 'North'
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.delete(f'{base}/{tid}?require_empty=true')).status_code in (403,404)
    ctx.login(ctx.ids['user_a'])
    async with _Session() as db:
        g = await db.get(Guest, gid); assert g.table_id == tid and g.seat_number == '9' and g.held_seat == '10'
        g.table_id = None; g.seat_number = None; g.held_seat = None
        group = TableGroup(event_id=ctx.ids['event_a'], name='Community', tag='community')
        db.add(group); await db.flush(); db.add(TableGroupTable(table_group_id=group.id, table_id=tid)); link_group = group.id
        await db.commit()
    blocked = await ctx.client.delete(f'{base}/{tid}?require_empty=true')
    assert blocked.status_code == 409 and 'group' in blocked.json()['detail']
    async with _Session() as db:
        from sqlalchemy import delete
        await db.execute(delete(TableGroupTable).where(TableGroupTable.table_group_id == link_group)); await db.commit()
    assert (await ctx.client.delete(f'{base}/{tid}?require_empty=true')).status_code == 204

@pytest.mark.asyncio
async def test_planner_assignment_respects_partner_reservations(ctx):
    from sqlalchemy import select
    from app.models import Guest
    async with _Session() as db:
        e = await db.get(Event, ctx.ids['event_a']); e.is_paid = True
        await db.commit()
    ctx.login(ctx.ids['user_a'])
    event_id = ctx.ids['event_a']
    table = (await ctx.client.post(f'/api/events/{event_id}/tables', json={'name':'Reserved', 'capacity':10})).json()
    async with _Session() as db:
        holder = await db.scalar(select(Guest).where(Guest.event_id == event_id))
        partner = Guest(event_id=event_id, first_name='Partner', last_name='Guest', email='partner@example.test')
        other = Guest(event_id=event_id, first_name='Other', last_name='Guest', email='other@example.test')
        db.add_all([partner, other]); await db.flush()
        holder.table_id = table['id']; holder.seat_number = '1'; holder.held_seat = '2'; holder.partner_guest_id = partner.id
        partner_id, other_id = partner.id, other.id
        await db.commit()
    chart = (await ctx.client.get(f'/api/events/{event_id}/seating')).json()
    reserved = next(s for s in chart[0]['seats'] if s['seat']=='2')
    assert reserved['reserved'] and reserved['reserved_for_guest_id']==partner_id
    body = {'table_id':table['id'],'seat_number':'2'}
    rejected = await ctx.client.patch(f'/api/events/{event_id}/guests/{other_id}/seat?respect_reserved=true',json=body)
    assert rejected.status_code == 409
    allowed = await ctx.client.patch(f'/api/events/{event_id}/guests/{partner_id}/seat?respect_reserved=true',json=body)
    assert allowed.status_code == 200, allowed.text
