"""Versioned event forms, explicit parental signing authority and entry requirements."""
from types import SimpleNamespace
from sqlalchemy import select
from ..models import EventForm, EventFormRevision, EventFormSubmission, EventConsentAuthority, Guest, GuestTag, GuestTagLink, TicketType
from .experience import guest_age_group, step_applies_to_guest


def is_junior(event, guest):
    return bool(getattr(guest, 'is_junior', False)) or guest.id in (event.guardian_authorizations or {}) or (guest.rsvp_guest_type or '').strip().casefold() in {'child', 'junior', 'minor'}


async def context_for(guest, db):
    notes = (guest.rsvp_notes or '').strip()
    age = notes[len('Age group: '):].split(' | ', 1)[0].strip() if notes.startswith('Age group: ') else None
    ticket = await db.get(TicketType, guest.ticket_type_id) if guest.ticket_type_id else None
    tags = (await db.execute(select(GuestTag.id, GuestTag.name).join(GuestTagLink, GuestTag.id == GuestTagLink.tag_id).where(GuestTagLink.guest_id == guest.id))).all()
    return {'age_group': age or await guest_age_group(guest, db), 'ticket_name': ticket.name if ticket else '', 'tags': {str(v).lower() for row in tags for v in row if v}}


async def applies(definition, event, guest, db, context=None):
    if definition.get('audience_kind') == 'juniors' and not is_junior(event, guest):
        return False
    if definition.get('audience_kind') == 'adults' and is_junior(event, guest):
        return False
    return await step_applies_to_guest(SimpleNamespace(conditions=definition.get('conditions') or {}), guest, db, audience_context=context or await context_for(guest, db))


async def published(event_id, db):
    return (await db.execute(select(EventForm, EventFormRevision).join(EventFormRevision, (EventFormRevision.form_id == EventForm.id) & (EventFormRevision.version == EventForm.published_version)).where(EventForm.event_id == event_id, EventForm.archived.is_(False)))).all()


async def subjects(event, viewer, db):
    grants = (await db.scalars(select(EventConsentAuthority).where(EventConsentAuthority.event_id == event.id, EventConsentAuthority.signer_guest_id == viewer.id, EventConsentAuthority.active.is_(True)))).all() if not is_junior(event, viewer) else []
    ids = [viewer.id] + [g.guest_id for g in grants]
    people = (await db.scalars(select(Guest).where(Guest.event_id == event.id, Guest.id.in_(ids)))).all()
    return sorted(people, key=lambda g: (g.id != viewer.id, g.first_name, g.last_name)), {g.guest_id: g for g in grants}


def signing_reason(definition, event, subject, viewer, grants):
    if subject.id == viewer.id and (is_junior(event, subject) or definition.get('signer_policy') == 'guardian'):
        return 'A parent or legal guardian with consent-signing permission must complete this form.'
    if subject.id != viewer.id and (subject.id not in grants or is_junior(event, viewer)):
        return 'Consent-signing permission is required. Pickup permission alone does not allow signing.'
    if definition.get('timing') == 'after_admission' and not subject.admitted:
        return 'Check in with event staff before completing this form.'
    if subject.rsvp_status in ('declined', 'waitlisted', 'pending') or (event.rsvp_enabled and subject.rsvp_status != 'confirmed' and not subject.admitted):
        return 'Registration must be confirmed before completing this form.'
    return None


async def missing_requirements(event, guest, db, *, zone_id=None, step_id=None):
    if not event.experience_enabled or not (zone_id or step_id):
        return []
    forms = await published(event.id, db)
    relevant = [(form, rev) for form, rev in forms if rev.definition.get('required') and ((zone_id and rev.definition.get('zone_id') == zone_id) or (step_id and rev.definition.get('step_id') == step_id))]
    if not relevant:
        return []
    done = set((await db.scalars(select(EventFormSubmission.revision_id).where(EventFormSubmission.guest_id == guest.id, EventFormSubmission.revision_id.in_([r.id for _, r in relevant])))).all())
    context = await context_for(guest, db)
    return [r.definition['title'] for _, r in relevant if r.id not in done and await applies(r.definition, event, guest, db, context)]
