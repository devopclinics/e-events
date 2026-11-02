import pytest
from sqlalchemy import select,func
from app.models import Event,Guest
from app.routers.invite import _external_registration_url
from types import SimpleNamespace
from conftest import _Session

@pytest.mark.parametrize('url',[None,'javascript:alert(1)','https://user:secret@example.com','https://example.com/\nother','//example.com'])
def test_invalid_registration_targets_are_not_exposed(url):
    assert _external_registration_url(SimpleNamespace(setup_preferences={'external_registration_url':url})) is None

@pytest.mark.asyncio
async def test_external_registration_blocks_creation_preserves_edit(ctx):
    ctx.login(ctx.ids['superadmin'])
    eid=ctx.ids['event_a'];url='https://www.pamannigeria.com.ng/contact/'
    async with _Session() as db:
        e=await db.get(Event,eid);e.status='active';e.rsvp_enabled=True;e.invite_mode='open';e.setup_preferences={'external_registration_url':url}
        g=await db.scalar(select(Guest).where(Guest.event_id==eid));g.rsvp_status='confirmed';g.whatsapp_consent=True;g.sms_consent=False
        gid=g.id;token=g.qr_token;before=await db.scalar(select(func.count(Guest.id)).where(Guest.event_id==eid));await db.commit()
    public=await ctx.client.get(f'/api/invite/{eid}')
    assert public.status_code==200 and public.json()['external_registration_url']==url
    blocked=await ctx.client.post(f'/api/invite/{eid}/rsvp',json={'first_name':'New','last_name':'Person'})
    assert blocked.status_code==409 and blocked.json()['detail']['registration_url']==url
    updated=await ctx.client.patch(f'/api/events/{eid}/guests/{gid}',json={'first_name':'Corrected','email':'','phone':''})
    assert updated.status_code==200,updated.text
    async with _Session() as db:
        g=await db.get(Guest,gid)
        assert g.first_name=='Corrected' and not g.email and not g.phone
        assert g.qr_token==token and g.rsvp_status=='confirmed' and g.whatsapp_consent and not g.sms_consent
        assert await db.scalar(select(func.count(Guest.id)).where(Guest.event_id==eid))==before
