"""Event deletion must honor real FK constraints and preserve other tenants."""
from datetime import datetime

import pytest
from sqlalchemy import select, text

from app.models import (
    Event, EventGuestMessagingSettings, EventMessageThread, EventMessage,
    EventMessageRead, EventMessageDeliveryLog, Guest, Payment, QuickInviteAlias,
    Task, TaskActivity, Subtask, OrganizationInvoice, EmailDeliveryEvent,
)
from conftest import _Session, _engine


@pytest.mark.asyncio
async def test_delete_configured_event_with_foreign_keys(ctx):
    ctx.login(ctx.ids['user_a'])
    event_id = ctx.ids['event_a']
    if _engine.dialect.name == 'sqlite':
        async with _engine.connect() as conn:
            await conn.execute(text('PRAGMA foreign_keys=ON'))
            assert (await conn.scalar(text('PRAGMA foreign_keys'))) == 1
    try:
        async with _Session() as db:
            other = Event(org_id=ctx.ids['org_b'], name='Keep event', couples_name='Keep', event_date=datetime(2027, 1, 1), checkin_base_url='https://example.test')
            db.add(other)
            await db.flush()
            keep_id = other.id
            guest_id = await db.scalar(select(Guest.id).where(Guest.event_id == event_id))
            settings = EventGuestMessagingSettings(event_id=event_id)
            keep_settings = EventGuestMessagingSettings(event_id=keep_id)
            thread = EventMessageThread(event_id=event_id, guest_id=guest_id, thread_type='direct')
            task = Task(event_id=event_id, title='Delete task')
            payment = Payment(event_id=event_id, org_id=ctx.ids['org_a'], provider='stripe', reference='preserved-payment', tier_key='tier150', amount=200000, currency='NGN')
            alias = QuickInviteAlias(code='reserved-alias', event_id=event_id)
            invoice = OrganizationInvoice(org_id=ctx.ids['org_a'], reference='keep-invoice', payload={'event_id': event_id}, created_by=ctx.ids['user_a'].id)
            db.add_all([settings, keep_settings, thread, task, payment, alias, invoice])
            await db.flush()
            message = EventMessage(event_id=event_id, thread_id=thread.id, guest_id=guest_id, sender_type='system', message_type='direct', body='Test message')
            db.add(message)
            await db.flush()
            db.add_all([
                EventMessageRead(event_id=event_id, message_id=message.id, guest_id=guest_id),
                EventMessageDeliveryLog(event_id=event_id, message_id=message.id, guest_id=guest_id),
                EmailDeliveryEvent(guest_id=guest_id, event_id=None, event_type='delivered', status='delivered'),
                TaskActivity(task_id=task.id, body='Test task activity'),
                Subtask(task_id=task.id, title='Test subtask'),
            ])
            await db.commit()
            payment_id = payment.id
        response = await ctx.client.delete(f'/api/events/{event_id}')
        assert response.status_code == 204, response.text
        async with _Session() as db:
            assert await db.get(Event, event_id) is None
            assert await db.get(Event, keep_id) is not None
            assert await db.scalar(select(EventGuestMessagingSettings.id).where(EventGuestMessagingSettings.event_id == keep_id))
            assert await db.scalar(select(OrganizationInvoice.id).where(OrganizationInvoice.reference == 'keep-invoice'))
            assert (await db.get(Payment, payment_id)).event_id is None
            assert (await db.get(QuickInviteAlias, 'reserved-alias')).event_id is None
            for model in (Guest, EventGuestMessagingSettings, EventMessageThread, EventMessage, EventMessageRead, EventMessageDeliveryLog, Task):
                assert await db.scalar(select(model.id).where(model.event_id == event_id)) is None
            assert await db.scalar(select(EmailDeliveryEvent.id)) is None
            assert await db.scalar(select(TaskActivity.id)) is None
            assert await db.scalar(select(Subtask.id)) is None
        assert (await ctx.client.delete(f'/api/events/{event_id}')).status_code == 404
    finally:
        if _engine.dialect.name == 'sqlite':
            async with _engine.connect() as conn:
                await conn.execute(text('PRAGMA foreign_keys=OFF'))


@pytest.mark.asyncio
async def test_other_organization_cannot_delete_event(ctx):
    ctx.login(ctx.ids['user_b'])
    response = await ctx.client.delete(f"/api/events/{ctx.ids['event_a']}")
    assert response.status_code in (403, 404)
    async with _Session() as db:
        assert await db.get(Event, ctx.ids['event_a']) is not None


@pytest.mark.asyncio
async def test_failure_rolls_back_all_event_cleanup(ctx, monkeypatch):
    from app.services import event_deletion
    original = event_deletion.delete_event_data

    async def fail_after_cleanup(db, event_id):
        await original(db, event_id)
        raise RuntimeError('Simulated failure before commit')

    monkeypatch.setattr(event_deletion, 'delete_event_data', fail_after_cleanup)
    ctx.login(ctx.ids['user_a'])
    with pytest.raises(RuntimeError, match='Simulated failure'):
        await ctx.client.delete(f"/api/events/{ctx.ids['event_a']}")
    async with _Session() as db:
        assert await db.get(Event, ctx.ids['event_a']) is not None
        assert await db.scalar(select(Guest.id).where(Guest.event_id == ctx.ids['event_a']))
