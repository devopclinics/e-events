"""Guest List owns identities. JP stores only its operational extension and policy."""
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select,func
from ..models import Guest, Event, GuestProfileAudit, EventConsentAuthority
from ..junior_models import JuniorChild,JuniorContact
from .event_forms import is_junior
from ..entitlements import assert_within_guest_cap


def person_name(guest):
    return ' '.join(x for x in (guest.first_name,guest.last_name) if x).strip()


def split_name(name):
    parts=name.strip().split(maxsplit=1)
    first=parts[0] if parts else ''
    last=parts[1] if len(parts)>1 else ''
    if not first or len(first)>100 or len(last)>100:
        raise HTTPException(400,'Name must fit the Guest List first-name and last-name fields (100 characters each)')
    return first,last


async def new_guest(event,name,db,*,junior=False,email=None,phone=None,sms_consent=False):
    count=await db.scalar(select(func.count(Guest.id)).where(Guest.event_id==event.id))
    assert_within_guest_cap(event,count or 0)
    first,last=split_name(name)
    guest=Guest(event_id=event.id,first_name=first,last_name=last,email=email,phone=phone,
        sms_consent=sms_consent,whatsapp_consent=False,is_junior=junior,rsvp_guest_type='junior' if junior else 'adult',
        admitted=False,rsvp_status='invited')
    db.add(guest)
    await db.flush()
    return guest


async def resolve_person(event,db,*,guest_id=None,name=None,junior=False,confirm_same_name=False,confirm_junior=False,**fields):
    if guest_id:
        guest=await db.scalar(select(Guest).where(Guest.id==guest_id,Guest.event_id==event.id).with_for_update())
        if not guest:raise HTTPException(404,'Guest not found in this event')
        if junior and not is_junior(event,guest):
            if not confirm_junior:raise HTTPException(409,'Confirm this guest is a child before enrolling them in Junior Platform')
            guest.is_junior=True
        return guest
    first,last=split_name(name or '')
    guests=(await db.scalars(select(Guest).where(Guest.event_id==event.id,func.lower(Guest.first_name)==first.lower(),func.lower(Guest.last_name)==last.lower()))).all()
    matches=[g for g in guests if person_name(g).casefold()==(' '.join((first,last))).strip().casefold()]
    if matches and not confirm_same_name:
        raise HTTPException(409,'This name already exists in Guest List. Select the existing guest instead of creating another record.')
    return await new_guest(event,name,db,junior=junior,**fields)


async def refresh_child(event,child,db):
    guest=await db.get(Guest,child.guest_id) if child.guest_id else None
    if not guest or guest.event_id!=event.id:
        return None
    if not is_junior(event,guest) and child.location in ('not_arrived','released'):return None
    name=person_name(guest)
    if child.name!=name:
        child.name=name;child.version+=1;child.updated_at=datetime.utcnow()
    return guest


async def refresh_contacts(event,child,db,*,contacts=None,flush=True):
    from ..routers.access import _entry_is_usable
    entries=(event.guardian_authorizations or {}).get(child.guest_id) or []
    if contacts is None:contacts=list((await db.scalars(select(JuniorContact).where(JuniorContact.child_id==child.id))).all())
    known={c.guardian_guest_id for c in contacts}
    for entry in entries:
        gid=entry.get('guardian_guest_id')
        if not gid or gid in known:continue
        guardian=await db.get(Guest,gid)
        if not guardian or guardian.event_id!=event.id or guardian.id==child.guest_id:continue
        contact=JuniorContact(child_id=child.id,guardian_guest_id=gid,name=person_name(guardian),
            relationship=entry.get('relationship') or 'parent',email=guardian.email,phone=guardian.phone,
            sms_consent=bool(guardian.sms_consent),adult_verified=False,pickup_authorized=False,
            notify=False,verified_by='guest-list-link')
        db.add(contact);contacts.append(contact);known.add(gid)
    for contact in contacts:
        await refresh_contact(event,child,contact,db)
    if flush:await db.flush()
    return contacts


async def refresh_contact(event,child,contact,db):
    from ..routers.access import _entry_is_usable
    guardian=await db.get(Guest,contact.guardian_guest_id) if contact.guardian_guest_id else None
    if not guardian or guardian.event_id!=event.id or guardian.id==child.guest_id or is_junior(event,guardian):
        contact.pickup_authorized=False;contact.notify=False
        return None
    entries=(event.guardian_authorizations or {}).get(child.guest_id) or []
    entry=next((e for e in entries if e.get('guardian_guest_id')==guardian.id),None)
    usable=bool(entry and _entry_is_usable(entry))
    if (contact.pickup_authorized and not usable) or (entry and not _entry_is_usable(entry)):
        contact.notify=False
    contact.pickup_authorized=usable
    contact.name=person_name(guardian);contact.email=guardian.email;contact.phone=guardian.phone
    contact.sms_consent=bool(guardian.sms_consent)
    if entry:contact.relationship=entry.get('relationship') or contact.relationship
    return guardian


async def roster(event,db):
    # Creating an empty operational extension has no attendance/admission or messaging side effects.
    await db.scalar(select(Event).where(Event.id==event.id).with_for_update().execution_options(populate_existing=True))
    guests=list((await db.scalars(select(Guest).where(Guest.event_id==event.id))).all())
    children=list((await db.scalars(select(JuniorChild).where(JuniorChild.event_id==event.id))).all())
    contacts_by_child={}
    for contact in (await db.scalars(select(JuniorContact).join(JuniorChild,JuniorChild.id==JuniorContact.child_id).where(JuniorChild.event_id==event.id))).all():
        contacts_by_child.setdefault(contact.child_id,[]).append(contact)
    by_guest={c.guest_id:c for c in children if c.guest_id}
    for guest in guests:
        if not is_junior(event,guest):continue
        if not guest.is_junior:
            before={'is_junior':False}
            guest.is_junior=True
            db.add(GuestProfileAudit(event_id=event.id,guest_id=guest.id,actor_user_id='system:guest-list-link',before=before,after={'is_junior':True,'source':'existing_junior_type_or_guardian_link'}))
            for authority in (await db.scalars(select(EventConsentAuthority).where(EventConsentAuthority.event_id==event.id,EventConsentAuthority.signer_guest_id==guest.id))).all():authority.active=False
        child=by_guest.get(guest.id)
        if not child:
            child=JuniorChild(id=guest.id,guest_id=guest.id,event_id=event.id,name=person_name(guest),age_group='Pending confirmation',classroom='')
            db.add(child);children.append(child)
        await refresh_child(event,child,db)
        await refresh_contacts(event,child,db,contacts=contacts_by_child.get(child.id,[]),flush=False)
    result=[]
    for child in children:
        if await refresh_child(event,child,db):result.append(child)
    await db.flush()
    return sorted(result,key=lambda c:c.name.casefold())


def set_authorization(event,child,guardian_id,relationship,authorized):
    mapping={key:list(value or []) for key,value in (event.guardian_authorizations or {}).items()}
    entries=[entry for entry in mapping.get(child.guest_id,[]) if entry.get('guardian_guest_id')!=guardian_id]
    if authorized:entries.append({'guardian_guest_id':guardian_id,'relationship':relationship,'source':'admin'})
    if entries:mapping[child.guest_id]=entries
    else:mapping.pop(child.guest_id,None)
    event.guardian_authorizations=mapping
