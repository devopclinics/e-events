from datetime import datetime,timedelta
import uuid
import pytest
from sqlalchemy import select
from conftest import _Session
from test_junior_programme import setup,child,drop
from test_junior_permissions import invite
from app.models import EventForm,EventFormRevision,EventFormSubmission,RSVPQuestion,RSVPAnswer
from app.junior_models import JuniorChild

async def form_answer(ctx,root,c,answers,*,date=None,event_id=None,guest_id=None,accepted=True):
    async with _Session() as db:
        form=EventForm(event_id=event_id or ctx.ids['event_a']);db.add(form);await db.flush()
        revision=EventFormRevision(form_id=form.id,version=1,definition={'title':'Junior Platform participation consent','questions':[{'key':'allergies','label':'Food allergies (enter None if none known)','type':'textarea'},{'key':'support','label':'Support needs to discuss with the Junior Platform lead (or None)','type':'textarea'},{'key':'restrictions','label':'Participation restrictions','type':'textarea'}]});db.add(revision);await db.flush()
        db.add(EventFormSubmission(revision_id=revision.id,guest_id=guest_id or c['guest_id'],signer_name='Test parent',relationship='parent',answers=answers,accepted=accepted,signed_at=date or datetime.utcnow()));await db.commit()

@pytest.mark.asyncio
async def test_missing_answers_stay_unknown_and_do_not_create_attendance(ctx):
    root=await setup(ctx);c=await child(ctx,root);r=(await ctx.client.get(root+'/children/'+c['id'])).json()
    assert all(r['screening_profile'][key]['value'] is None and r['screening_profile'][key]['source']=='missing' for key in ['allergy','accommodation'])
    assert r['location']=='not_arrived' and not r['screening_wristband_assigned']

@pytest.mark.asyncio
async def test_child_registration_prefills_yes_and_no_without_clearing_desks(ctx):
    root=await setup(ctx);c=await child(ctx,root);await form_answer(ctx,root,c,{'allergies':'Peanuts','support':'None','restrictions':'Do not infer accommodations from sports restrictions'})
    r=(await ctx.client.get(root+'/children/'+c['id'])).json();p=r['screening_profile'];assert p['allergy']['value'] is True and p['allergy']['details']=='Peanuts' and p['accommodation']['value'] is False
    assert r['allergy'] is None and not r['allergy_cleared'] and not r['screening_wristband_assigned'] and r['location']=='not_arrived'
    c=await drop(ctx,root,c);assert c['allergy'] is False  # Suggestions do not silently override a volunteer's explicitly confirmed answers.

@pytest.mark.asyncio
async def test_medical_details_redacted_for_checkin_volunteer(ctx):
    root=await setup(ctx);c=await child(ctx,root);await form_answer(ctx,root,c,{'allergies':'RESTRICTED peanut details','support':'Quiet room requested'})
    user,_=await invite(ctx,root,permissions=['checkin']);ctx.login(user);r=await ctx.client.get(root+'/children/'+c['id']);assert r.status_code==200
    assert r.json()['screening_profile']['allergy']['value'] is True and 'details' not in r.json()['screening_profile']['allergy'] and 'RESTRICTED' not in r.text and 'Quiet room' not in r.text

@pytest.mark.asyncio
async def test_does_not_take_guardians_or_other_events_answers(ctx):
    root=await setup(ctx);c=await child(ctx,root)
    from app.junior_models import JuniorContact
    async with _Session() as db:guardian=await db.scalar(select(JuniorContact).where(JuniorContact.child_id==c['id']));gid=guardian.guardian_guest_id
    await form_answer(ctx,root,c,{'allergies':'Peanuts'},guest_id=gid)
    from app.models import Event
    async with _Session() as db:
        other=Event(org_id=ctx.ids['org_b'],name='Other event',couples_name='Other',event_date=datetime.utcnow(),checkin_base_url='http://test');db.add(other);await db.flush();other_id=other.id;await db.commit()
    await form_answer(ctx,root,c,{'support':'Needs assistance'},event_id=other_id)
    await form_answer(ctx,root,c,{'allergies':'Not accepted'},accepted=False)
    r=(await ctx.client.get(root+'/children/'+c['id'])).json();assert r['screening_profile']['allergy']['value'] is None and r['screening_profile']['accommodation']['value'] is None

@pytest.mark.asyncio
async def test_latest_saved_answers_and_unknown_values(ctx):
    root=await setup(ctx);c=await child(ctx,root);await form_answer(ctx,root,c,{'allergies':'Peanuts','support':'Wheelchair'},date=datetime.utcnow()-timedelta(days=1));await form_answer(ctx,root,c,{'allergies':'None','support':'Not sure'})
    p=(await ctx.client.get(root+'/children/'+c['id'])).json()['screening_profile'];assert p['allergy']['value'] is False and p['accommodation']['value'] is None

@pytest.mark.asyncio
async def test_previous_day_prefill_does_not_carry_clearance_or_wristbands(ctx):
    root=await setup(ctx);c=await child(ctx,root);c=await drop(ctx,root,c)
    async with _Session() as db:
        row=await db.get(JuniorChild,c['id']);row.location='released';row.programme_date='2020-01-01';await db.commit()
    r=(await ctx.client.get(root+'/children/'+c['id'])).json();assert r['location']=='not_arrived' and r['allergy'] is None and not r['screening_wristband_assigned'] and not r['allergy_cleared'];assert r['screening_profile']['allergy']['value'] is False and r['screening_profile']['allergy']['source']=='previous_screening'

@pytest.mark.asyncio
async def test_rsvp_custom_questions_and_newer_registration_override_older_screening(ctx):
    root=await setup(ctx);c=await child(ctx,root);c=await drop(ctx,root,c)
    async with _Session() as db:
        q=RSVPQuestion(event_id=ctx.ids['event_a'],question='Does your child have any allergies?',question_type='boolean');db.add(q);await db.flush();db.add(RSVPAnswer(guest_id=c['guest_id'],question_id=q.id,answer='Yes',answered_at=datetime.utcnow()+timedelta(seconds=1)));await db.commit()
    p=(await ctx.client.get(root+'/children/'+c['id'])).json()['screening_profile'];assert p['allergy']['value'] is True and p['allergy']['source']=='registration' and p['accommodation']['value'] is False

@pytest.mark.asyncio
async def test_confirming_registration_at_dropoff_keeps_details_for_the_support_desk(ctx):
    from test_junior_programme import act
    root=await setup(ctx);c=await child(ctx,root);await form_answer(ctx,root,c,{'allergies':'Peanuts','support':'Quiet room'},date=datetime.utcnow()-timedelta(hours=1))
    c=await act(ctx,root,c,'dropoff',adult_name='Parent',relationship='parent',identity_checked=True,allergy=True,accommodation=True,screening_wristband_assigned=True)
    r=(await ctx.client.get(root+'/children/'+c['id'])).json();assert r['screening_profile']['allergy']['details']=='Peanuts' and r['screening_profile']['accommodation']['details']=='Quiet room';assert not r['allergy_cleared'] and not r['accommodation_cleared']

@pytest.mark.asyncio
async def test_registration_screening_does_not_leak_to_another_child_in_same_event(ctx):
    root=await setup(ctx);first=await child(ctx,root);second=await child(ctx,root,guardian=False,name='Other junior')
    await form_answer(ctx,root,first,{'allergies':'Peanuts','support':'Quiet room'})
    profile=(await ctx.client.get(root+'/children/'+second['id'])).json()['screening_profile'];assert profile['allergy']['value'] is None and profile['accommodation']['value'] is None
