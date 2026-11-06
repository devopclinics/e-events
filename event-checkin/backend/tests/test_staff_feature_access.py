import pytest
from sqlalchemy import select
from conftest import _Session
from app.models import User, Membership, EventUser, Guest, Event
from app.staff_permissions import validate_policy
from fastapi import HTTPException

async def staff(ctx, policy=None, role='manager', level='edit'):
    async with _Session() as db:
        u=User(name='Limited staff',email='limited@example.test',role='official')
        db.add(u); await db.flush()
        db.add(Membership(org_id=ctx.ids['org_a'],user_id=u.id,role='staff'))
        db.add(EventUser(event_id=ctx.ids['event_a'],user_id=u.id,event_role=role,access_level=level,feature_permissions=policy))
        event=await db.get(Event,ctx.ids['event_a']); event.is_paid=True
        await db.commit()
    ctx.login(u)
    return u

@pytest.mark.asyncio
async def test_view_manager_cannot_edit_guest(ctx):
    await staff(ctx,level='view')
    async with _Session() as db: g=await db.scalar(select(Guest).where(Guest.event_id==ctx.ids['event_a']))
    response=await ctx.client.patch(f"/api/events/{ctx.ids['event_a']}/guests/{g.id}",json={'first_name':'Changed'})
    assert response.status_code==403, response.text
    async with _Session() as db: assert (await db.get(Guest,g.id)).first_name=='G'

@pytest.mark.asyncio
async def test_explicit_denied_manager_cannot_read_guests_or_team(ctx):
    await staff(ctx,{})
    for suffix in ('guests','members','guests/export'):
        r=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/{suffix}")
        assert r.status_code==403,(suffix,r.text)

@pytest.mark.asyncio
async def test_view_guests_allows_read_denies_write_and_export(ctx):
    await staff(ctx,{'guests':'view'})
    r=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")
    assert r.status_code==200,r.text
    r=await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/guests",json={'first_name':'Denied'})
    assert r.status_code==403,r.text
    r=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests/export")
    assert r.status_code==403,r.text

@pytest.mark.asyncio
async def test_export_independent_of_guest_management(ctx):
    await staff(ctx,{'export':'view'},role='staff')
    r=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests/export?sections=guests")
    assert r.status_code==200,r.text
    assert 'G' in r.text
    r=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")
    assert r.status_code==403,r.text

@pytest.mark.asyncio
async def test_owner_can_save_validated_policy(ctx):
    u=await staff(ctx)
    ctx.login(ctx.ids['user_a'])
    url=f"/api/events/{ctx.ids['event_a']}/members/{u.id}/permissions"
    r=await ctx.client.patch(url,json={'feature_permissions':{'guests':'view'}})
    assert r.status_code==200,r.text
    r=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/members")
    assert r.status_code==200,r.text
    assert r.json()[0]['feature_permissions']=={'guests':'view'}
    r=await ctx.client.patch(url,json={'feature_permissions':{'madeup':'manage'}})
    assert r.status_code==422,r.text

@pytest.mark.asyncio
async def test_staff_cannot_grant_own_policy(ctx):
    u=await staff(ctx,{'team':'manage'})
    r=await ctx.client.patch(f"/api/events/{ctx.ids['event_a']}/members/{u.id}/permissions",json={'feature_permissions':{'guests':'manage'}})
    assert r.status_code==403,r.text

@pytest.mark.asyncio
async def test_tenant_boundary_not_bypassed(ctx):
    await staff(ctx,{'guests':'manage'})
    ctx.login(ctx.ids['user_b'])
    r=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests")
    assert r.status_code==404,r.text

@pytest.mark.asyncio
async def test_scanner_feature_denies_token_operation_but_public_pass_survives(ctx):
    await staff(ctx,{})
    async with _Session() as db: g=await db.scalar(select(Guest).where(Guest.event_id==ctx.ids['event_a']))
    r=await ctx.client.post(f'/api/scan/{g.qr_token}')
    assert r.status_code==403,r.text
    r=await ctx.client.get(f'/api/scan/{g.qr_token}/ticket')
    assert r.status_code==200,r.text

@pytest.mark.asyncio
async def test_view_planner_token_has_no_write_capabilities(ctx,monkeypatch):
    import jwt
    from app.config import settings
    monkeypatch.setattr(settings,'planner_internal_token','test-secret-at-least-32-characters-long')
    await staff(ctx,{'planner':'view'},level='view')
    r=await ctx.client.post(f"/api/auth/planner-token?event_id={ctx.ids['event_a']}")
    assert r.status_code==200,r.text
    claims=jwt.decode(r.json()['token'],settings.planner_internal_token,algorithms=['HS256'],audience='planner')
    assert claims['role']=='member' and claims['capabilities']==[]

@pytest.mark.asyncio
async def test_support_agent_limited_to_inbox(ctx,monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings,'support_whatsapp_enabled',True)
    u=await staff(ctx,{})
    async with _Session() as db:
        agent=await db.get(User,u.id); agent.is_support_agent=True;await db.commit()
    ctx.login(agent)
    for path in ('/api/platform/support/whatsapp/conversations','/api/platform/support/chat/management'):
        r=await ctx.client.get(path); assert r.status_code==200,r.text
    for path in ('/api/platform/support/whatsapp/staff-access','/api/platform/support/whatsapp/automation/settings','/api/admin/operators'):
        r=await ctx.client.get(path); assert r.status_code in (403,404),r.text
    r=await ctx.client.post('/api/platform/support/whatsapp/sync',json={});assert r.status_code==403,r.text
    async with _Session() as db:
        agent=await db.get(User,u.id);agent.is_support_agent=False;await db.commit()
    ctx.login(agent)
    r=await ctx.client.get('/api/platform/support/chat/management');assert r.status_code==403,r.text

@pytest.mark.asyncio
async def test_dashboard_stream_authorization_respects_allowlist(ctx):
    from app.auth import user_has_dashboard_access
    u=await staff(ctx,{})
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a'])
        assert not await user_has_dashboard_access(u,event,db)
        eu=await db.scalar(select(EventUser).where(EventUser.event_id==event.id,EventUser.user_id==u.id))
        eu.feature_permissions={'overview':'view'};await db.flush()
        assert await user_has_dashboard_access(u,event,db)

@pytest.mark.asyncio
async def test_event_manager_cannot_escalate_org_or_other_staff(ctx):
    u=await staff(ctx,{'team':'manage'})
    event_id=ctx.ids['event_a']
    r=await ctx.client.put(f'/api/events/{event_id}/org-members/{u.id}',json={'role':'admin'})
    assert r.status_code==403,r.text
    r=await ctx.client.post(f'/api/events/{event_id}/org-members',json={'email':'escalate@example.test','role':'admin'})
    assert r.status_code==403,r.text
    r=await ctx.client.patch(f'/api/events/{event_id}/members/{u.id}/permissions',json={'event_role':'manager','access_level':'edit'})
    assert r.status_code==403,r.text

@pytest.mark.asyncio
async def test_reinvite_preserves_existing_owner_role(ctx,monkeypatch):
    from app.routers import events
    async def pretend_email(*args,**kwargs):return 'accepted'
    monkeypatch.setattr(events,'_email_team_invitation',pretend_email)
    ctx.login(ctx.ids['user_a'])
    r=await ctx.client.post(f"/api/events/{ctx.ids['event_a']}/org-members",json={'email':ctx.ids['user_a'].email,'role':'staff'})
    assert r.status_code==201,r.text
    assert r.json()['role']=='owner'
    async with _Session() as db:
        membership=await db.scalar(select(Membership).where(Membership.user_id==ctx.ids['user_a'].id,Membership.org_id==ctx.ids['org_a']))
        assert membership.role=='owner'

@pytest.mark.asyncio
async def test_feature_changes_are_audited(ctx):
    from app.models import StaffAccessAudit
    u=await staff(ctx)
    ctx.login(ctx.ids['user_a'])
    r=await ctx.client.patch(f"/api/events/{ctx.ids['event_a']}/members/{u.id}/permissions",json={'feature_permissions':{'seating':'manage'}})
    assert r.status_code==200,r.text
    async with _Session() as db:
        audit=await db.scalar(select(StaffAccessAudit).where(StaffAccessAudit.subject_id==u.id))
        assert audit.actor_id==ctx.ids['user_a'].id
        assert audit.after['feature_permissions']=={'seating':'manage'}

@pytest.mark.asyncio
async def test_staff_seating_tool_read_and_write(ctx):
    await staff(ctx,{'seating':'manage'},role='staff')
    r=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/tables")
    assert r.status_code==200,r.text

@pytest.mark.asyncio
async def test_community_revocation_failure_does_not_save_policy(ctx,monkeypatch):
    from app.services import festiome_client
    from app.services.festiome_client import FestioMeUnavailable
    u=await staff(ctx,{'festiome':'manage'})
    async with _Session() as db:
        event=await db.get(Event,ctx.ids['event_a']);event.festiome_id='linked-group';await db.commit()
    class Client:
        configured=True
        async def remove_user(self,*args):raise FestioMeUnavailable('community service unavailable')
    monkeypatch.setattr(festiome_client,'get_festiome_client',lambda:Client())
    ctx.login(ctx.ids['user_a'])
    r=await ctx.client.patch(f"/api/events/{ctx.ids['event_a']}/members/{u.id}/permissions",json={'feature_permissions':{}})
    assert r.status_code==503,r.text
    async with _Session() as db:
        eu=await db.scalar(select(EventUser).where(EventUser.user_id==u.id,EventUser.event_id==ctx.ids['event_a']))
        assert eu.feature_permissions=={'festiome':'manage'}
