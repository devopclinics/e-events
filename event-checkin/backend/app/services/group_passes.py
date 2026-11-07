"""Group entry reuses personal admission rules inside one outer transaction."""
from contextvars import ContextVar
from sqlalchemy import select
from app.models import GuestGroupPass, GroupPassMember, Guest, ScanEvent, GroupPassRedemption

claim_active = ContextVar('group_pass_claim_active', default=False)

async def active_group(db, guest_id):
    return await db.scalar(select(GuestGroupPass).where(GuestGroupPass.guest_id == guest_id, GuestGroupPass.enabled.is_(True)))

async def members(db, pass_id):
    return (await db.scalars(select(GroupPassMember).where(GroupPassMember.pass_guest_id == pass_id).order_by(GroupPassMember.slot))).all()

async def used_guests(db, pass_id, zone_id=None):
    ids=select(GroupPassMember.guest_id).where(GroupPassMember.pass_guest_id == pass_id)
    history=(await db.scalars(select(GroupPassRedemption).where(GroupPassRedemption.pass_guest_id==pass_id, GroupPassRedemption.scope==(zone_id or 'event')))).all()
    recorded={m['guest_id'] for row in history for m in row.result.get('members', [])}
    if zone_id:
        return recorded | set((await db.scalars(select(ScanEvent.guest_id).where(ScanEvent.guest_id.in_(ids), ScanEvent.zone_id == zone_id, ScanEvent.denied.is_(False), ScanEvent.direction == 'in').distinct())).all())
    return recorded | set((await db.scalars(select(Guest.id).where(Guest.id.in_(ids), Guest.admitted.is_(True)))).all())
