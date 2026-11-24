import pytest
from sqlalchemy import select
from conftest import _Session
from app.models import Event
from app.junior_models import JuniorConfig,JuniorNotification
from app.services import junior_outbox
from test_junior_programme import setup,child,drop
from test_junior_volunteers import prepare

async def mark(ctx):
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);e.is_test=True;e.setup_preferences={'junior_practice_source':'original-event'};await db.commit()

@pytest.mark.asyncio
async def test_practice_is_explicit_and_blocks_guardian_enable(ctx):
    root=await setup(ctx)
    assert not (await ctx.client.get(root+'/config')).json()['practice_mode']
    await mark(ctx)
    cfg=(await ctx.client.get(root+'/config')).json();assert cfg['practice_mode'] and cfg['practice_source_event_id']=='original-event'
    r=await ctx.client.put(root+'/config',json={'enabled':True,'classrooms':cfg['classrooms'],'notifications_enabled':True});assert r.status_code==409
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);e.is_test=False;await db.commit()
    assert not (await ctx.client.get(root+'/config')).json()['practice_mode']

@pytest.mark.asyncio
async def test_practice_never_queues_or_sends_even_with_misconfigured_flag(ctx):
    root=await setup(ctx);await mark(ctx);c=await child(ctx,root)
    async with _Session() as db:
        cfg=await db.get(JuniorConfig,ctx.ids['event_a']);cfg.notifications_enabled=True;await db.commit()
    await drop(ctx,root,c)
    async with _Session() as db:
        rows=(await db.scalars(select(JuniorNotification))).all();assert rows and all(r.status=='paused' for r in rows)
        row=rows[0];row.status='queued';rid=row.id;await db.commit()
    async def forbidden(row):raise AssertionError('Practice must not send')
    await junior_outbox.deliver(rid,sessions=_Session,sender=forbidden)
    async with _Session() as db:
        row=await db.get(JuniorNotification,rid);assert row.status=='setup_required' and 'Practice events' in row.error

@pytest.mark.asyncio
async def test_practice_cannot_enable_volunteer_sending(ctx):
    root,*_=await prepare(ctx);await mark(ctx)
    r=await ctx.client.put(root+'/volunteers/sending/state',json={'enabled':True});assert r.status_code==409

@pytest.mark.asyncio
async def test_practice_worker_refuses_volunteer_delivery_even_if_flag_changed(ctx):
    from app.junior_models import JuniorVolunteerNotice as Notice
    from app.services import junior_volunteers as service
    root,*_=await prepare(ctx);await mark(ctx)
    async with _Session() as db:
        cfg=await db.get(JuniorConfig,ctx.ids['event_a']);cfg.volunteer_reminders_enabled=True
        row=await db.scalar(select(Notice));rid=row.id;due=row.due_at;await db.commit()
    async def forbidden(*args):raise AssertionError('Practice must not send')
    await service.deliver(rid,sessions=_Session,sender=forbidden,now=due)
    async with _Session() as db:
        row=await db.get(Notice,rid);assert row.status=='paused' and 'Practice events' in row.error

@pytest.mark.asyncio
async def test_practice_link_is_tenant_scoped(ctx):
    from datetime import datetime
    root=await setup(ctx)
    async with _Session() as db:
        practice=Event(org_id=ctx.ids['org_a'],name='Practice',couples_name='Practice',event_date=datetime.utcnow(),checkin_base_url='http://test',is_test=True,junior_program_enabled=True,setup_preferences={'junior_practice_source':ctx.ids['event_a']});db.add(practice);await db.flush();pid=practice.id
        other=Event(org_id=ctx.ids['org_b'],name='Foreign practice',couples_name='Practice',event_date=datetime.utcnow(),checkin_base_url='http://test',is_test=True,junior_program_enabled=True,setup_preferences={'junior_practice_source':ctx.ids['event_a']});db.add(other);await db.commit()
    cfg=(await ctx.client.get(root+'/config')).json();assert cfg['practice_event_id']==pid and not cfg['practice_mode']
