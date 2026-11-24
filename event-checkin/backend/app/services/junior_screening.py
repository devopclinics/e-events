"""Read child-specific registration answers as screening suggestions, never desk clearance."""
import re
from datetime import datetime,timezone
from sqlalchemy import select,func
from ..models import RSVPQuestion,RSVPAnswer,EventForm,EventFormRevision,EventFormSubmission
from ..junior_models import JuniorMovement


def normal(value):return re.sub(r'[^a-z0-9]+',' ',str(value).casefold()).strip()


def category(key,label,title=''):
    key=normal(key);label=normal(label)
    allergies={'allergy','allergies','food allergies','has allergies','allergy profile','known allergies'}
    support={'accommodation','accommodations','special accommodation','special accommodations','special needs','support needs','accessibility needs'}
    # Match specific fields, not emergency contacts, diet preferences or activity restrictions.
    if key in allergies or label in allergies or label in {'do you have any allergies','does your child have any allergies','food allergies enter none if none known'}:return 'allergy'
    if key in support or label in support or label in {'does your child need special accommodation','does your child require special accommodation'}:return 'accommodation'
    if key=='support' and 'junior' in normal(title) and label=='support needs to discuss with the junior platform lead or none':return 'accommodation'
    return None


def answer(value):
    if isinstance(value,bool):return value
    if not isinstance(value,str):return None
    text=normal(value)
    if text in {'no','false','0','none','none known','no known allergies','no allergies','no known food allergies','n a','not applicable','none required','no special needs','no support needs','no special accommodation','no special accommodations','no accommodations needed'}:return False
    if text in {'','unknown','not known','maybe','not sure','unsure','tbc','pending','prefer not to say','not provided','i don t know','don t know'}:return None
    return True  # Nonempty needs/details require a desk review; never infer clearance.


def instant(value):
    if not value:return datetime.min
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


async def profile(event,child,db,*,restricted=False):
    result={};times={};details={};detail_times={}
    if restricted:
        clear_times=dict((await db.execute(select(JuniorMovement.action,func.max(JuniorMovement.occurred_at)).where(JuniorMovement.event_id==event.id,JuniorMovement.child_id==child.id,JuniorMovement.action.in_(['clear_allergy','clear_accommodation'])).group_by(JuniorMovement.action))).all())
        for key in ('allergy','accommodation'):
            if getattr(child,key+'_notes'):
                details[key]=getattr(child,key+'_notes');detail_times[key]=instant(clear_times.get('clear_'+key))
    movement=await db.scalar(select(JuniorMovement).where(JuniorMovement.event_id==event.id,JuniorMovement.child_id==child.id,JuniorMovement.action.in_(['dropoff','screening'])).order_by(JuniorMovement.occurred_at.desc()).limit(1))
    for key in ('allergy','accommodation'):
        value=getattr(child,key)
        if value is not None:
            result[key]={'value':value,'source':'previous_screening','recorded_at':movement.occurred_at if movement else None}
            times[key]=instant(movement.occurred_at if movement else None)

    def add(key,value,date,kind,label):
        if not key or value is None or isinstance(value,str) and not value.strip():return
        if restricted and isinstance(value,str) and answer(value) is True and (key not in detail_times or instant(date)>detail_times[key]):
            details[key]=value;detail_times[key]=instant(date)
        if key in times and instant(date)<=times[key]:return
        result[key]={'value':answer(value),'source':kind,'recorded_at':date,'source_label':label}
        times[key]=instant(date)
    if child.guest_id:
        rows=(await db.execute(select(EventFormSubmission,EventFormRevision).join(EventFormRevision,EventFormRevision.id==EventFormSubmission.revision_id).join(EventForm,EventForm.id==EventFormRevision.form_id).where(EventForm.event_id==event.id,EventFormSubmission.guest_id==child.guest_id,EventFormSubmission.accepted.is_(True)))).all()
        for submission,revision in rows:
            definition=revision.definition or {}
            for q in definition.get('questions',[]):
                add(category(q.get('key'),q.get('label'),definition.get('title')),submission.answers.get(q.get('key')),submission.signed_at,'registration',definition.get('title','Registration form'))
        rows=(await db.execute(select(RSVPAnswer,RSVPQuestion).join(RSVPQuestion,RSVPQuestion.id==RSVPAnswer.question_id).where(RSVPQuestion.event_id==event.id,RSVPAnswer.guest_id==child.guest_id))).all()
        for saved,q in rows:add(category('',q.question),saved.answer,saved.answered_at,'registration','Registration question')
    for key in ('allergy','accommodation'):
        if restricted and key in result:result[key]['details']=details.get(key) if result[key]['value'] is True else None
    return {key:result.get(key,{'value':None,'source':'missing','recorded_at':None}) for key in ('allergy','accommodation')}
