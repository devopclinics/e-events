"""Public pass wording derived from guest roles and current session decisions."""
from sqlalchemy import select
from app.models import Guest, GuestGroupPass, GroupPassMember, GuestSessionAccess, Zone
from app.services.session_access import restricted_sessions, session_decision

async def pass_labels(db, event, guest):
    labels=[]
    config=await db.get(GuestGroupPass,guest.id)
    parent=await db.scalar(select(GroupPassMember).where(GroupPassMember.guest_id==guest.id,GroupPassMember.pass_guest_id!=guest.id))
    group=await db.get(Guest,parent.pass_guest_id) if parent else None
    role=(guest.rsvp_guest_type or '').strip()
    if role:labels.append(role[:100])
    if config and config.enabled:
        name=f'{guest.first_name} {guest.last_name}'.strip()
        if name and name not in labels:labels.append(name)
        if config.admission_limit:labels.append(f'Admits up to {config.admission_limit} people')
    elif group:
        name=f'{group.first_name} {group.last_name}'.strip()
        if name and name not in labels:labels.append(name)
    rules=(await db.scalars(select(GuestSessionAccess).where(GuestSessionAccess.guest_id==guest.id))).all()
    relevant=set(restricted_sessions(event))|{row.zone_id for row in rules}
    zones=(await db.scalars(select(Zone).where(Zone.event_id==event.id,Zone.is_active.is_(True),Zone.id.in_(relevant)).order_by(Zone.sort_order,Zone.created_at,Zone.id))).all() if relevant else []
    allowed=[]
    for zone in zones:
        ok,_=await session_decision(event,guest,zone.id,db)
        if ok:allowed.append(zone.name)
    if allowed:
        labels.append(' + '.join(allowed)+(' only' if len(allowed)==1 and len(zones)>1 else ''))
    elif zones:labels.append('Session access needs approval')
    return list(dict.fromkeys(labels))
