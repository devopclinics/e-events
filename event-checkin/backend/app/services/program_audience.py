"""Programme preferences using existing guest conditions, not admission grants."""
from sqlalchemy import select, or_
from ..models import Guest, GuestTag, GuestTagLink, TicketType
from .experience import guest_age_group

async def programme_audiences(event, viewer, db):
    # Same family scope as GuestHub passes, but return no credentials/contact data.
    from ..routers.access import _entry_is_usable
    authorizations = event.guardian_authorizations or {}
    scopes = [Guest.id == viewer.id]
    if viewer.id not in authorizations:
        scopes.append(Guest.rsvp_submitter_guest_id == viewer.id)
        if event.junior_guardian_handoff_enabled:
            children = [key for key, entries in authorizations.items() if any(
                e.get('guardian_guest_id') == viewer.id and _entry_is_usable(e) for e in (entries or []))]
            if children:
                scopes.append(Guest.id.in_(children))
    people = (await db.scalars(select(Guest).where(Guest.event_id == event.id, or_(*scopes)))).all()
    people.sort(key=lambda p: (p.id != viewer.id, p.first_name, p.last_name))
    profiles, contexts = [], {}
    for person in people:
        # Invite registration stores each additional attendee's age group here;
        # custom RSVP answers can be shared from the party submitter instead.
        notes = (person.rsvp_notes or '').strip()
        age = notes[len('Age group: '):].split(' | ', 1)[0].strip() if notes.startswith('Age group: ') else None
        age = age or await guest_age_group(person, db)
        tags = (await db.execute(select(GuestTag.id, GuestTag.name).join(
            GuestTagLink, GuestTagLink.tag_id == GuestTag.id).where(GuestTagLink.guest_id == person.id))).all()
        ticket = await db.get(TicketType, person.ticket_type_id) if person.ticket_type_id else None
        contexts[person.id] = {'age_group': age, 'ticket_name': ticket.name if ticket else '',
            'tags': {str(v).lower() for row in tags for v in row if v}}
        profiles.append({'guest_id': person.id, 'name': f'{person.first_name} {person.last_name}'.strip(),
                         'age_group': age, 'is_self': person.id == viewer.id})
    return people, profiles, contexts
