from app.models import Event, Organization
from app.config import settings
from app.main import available_credits, build_alerts

async def test_health_route_still_checks_database(ctx):
    response=await ctx.client.get('/health')
    assert response.status_code==200,response.text
    assert response.json()['service']=='dashboard-service'

async def test_org_balance_and_contact_exemptions_control_alerts(ctx,monkeypatch):
    monkeypatch.setattr(settings,'organization_entitlements_v2',True)
    async with ctx.session_factory() as db:
        event=await db.get(Event,ctx.event_id);event.message_credits=0;event.rsvp_invitee_contact_exempt_types=['Child']
        org=await db.get(Organization,ctx.org_id);org.message_credit_units=30099
        await ctx.add_guest(db,id='child',rsvp_guest_type='child',email=None,phone=None)
        await db.commit()
        assert await available_credits(db,event)==3009.9
        alerts=await build_alerts(db,event)
        assert not any(a['type'] in ('low_credits','missing_contact') for a in alerts)
        await ctx.add_guest(db,id='unreachable',rsvp_guest_type='Adult',email=None,phone=None)
        await db.commit()
        alerts=await build_alerts(db,event)
        contact=[a for a in alerts if 'contact' in a['type']]
        assert len(contact)==1 and contact[0]['count']==1
