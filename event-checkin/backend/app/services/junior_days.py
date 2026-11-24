"""Event-local JP days; read views never erase prior custody or convention entry."""
from datetime import datetime,timezone
from zoneinfo import ZoneInfo

ACTIVE_LOCATIONS={'reception','support_desk','classroom','clinic','other','outing'}


def utcnow():return datetime.utcnow()


def day(event,instant=None):
    instant=instant or utcnow()
    if instant.tzinfo is None:instant=instant.replace(tzinfo=timezone.utc)
    return instant.astimezone(ZoneInfo(event.timezone or 'UTC')).date().isoformat()


def view(child,event=None):
    today=day(event) if event else getattr(child,'_programme_today',None)
    programme_date=child.programme_date
    stale=bool(today and programme_date!=today)
    unresolved=bool(stale and child.location in ACTIVE_LOCATIONS)
    fresh=bool(stale and child.location in ('not_arrived','released'))
    return {'programme_date':programme_date,'today':today,'started_today':bool(programme_date and programme_date==today),
        'prior_day_unresolved':unresolved,'location':'not_arrived' if fresh else child.location,
        **({'allergy':None,'accommodation':None,'allergy_cleared':False,'accommodation_cleared':False,'screening_wristband_assigned':False} if fresh else {})}
