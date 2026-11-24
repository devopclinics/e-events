import uuid
import pytest
from sqlalchemy import select
from conftest import _Session
from test_junior_programme import setup,child,act,drop
from app.models import User,EventUser,Membership
from app.junior_models import JuniorConfig,JuniorVolunteerProfile,JuniorChild
from app.services.junior_permissions import ALL

def key():return str(uuid.uuid4())
async def invite(ctx,root,role='volunteer',permissions=None):
    body={'request_id':key(),'notify_email':False,'rows':[{'name':'Permission test','email':key()+'@example.com','role':role,'permissions':['checkin'] if permissions is None else permissions}]}
    r=await ctx.client.post(root+'/team/bulk',json=body);assert r.status_code==201,r.text;eid=r.json()['event_user_ids'][0]
    async with _Session() as db:eu=await db.get(EventUser,eid);user=await db.get(User,eu.user_id)
    return user,eid

@pytest.mark.asyncio
async def test_admin_is_juniors_only_not_organization_or_guest_list_admin(ctx):
    root=await setup(ctx);user,eid=await invite(ctx,root,'admin');ctx.login(user)
    cfg=(await ctx.client.get(root+'/config')).json();assert cfg['simple_role']=='admin' and cfg['can_configure'] and set(cfg['permissions'])==ALL and not cfg['can_open_guest_list']
    assert (await ctx.client.get(root+'/team')).json()['can_manage']
    r=await ctx.client.put(root+'/classrooms',json={'classrooms':['Group A','Group B','Admin room'],'expected_classrooms':['Group A','Group B']});assert r.status_code==200,r.text
    r=await ctx.client.get(f"/api/events/{ctx.ids['event_a']}/guests");assert r.status_code in (403,404),r.text
    async with _Session() as db:
        eu=await db.get(EventUser,eid);membership=await db.scalar(select(Membership).where(Membership.user_id==user.id));assert eu.event_role=='staff' and eu.feature_permissions=={} and membership.role=='staff'
    _,_=await invite(ctx,root,permissions=['inventory'])

@pytest.mark.asyncio
@pytest.mark.parametrize('rights,allowed,denied',[
 (['inventory'],['/inventory'],['/children','/notifications','/outings','/team']),
 (['checkin'],['/children','/outings'],['/inventory','/notifications','/team']),
 (['messages'],['/children','/notifications'],['/inventory','/team']),
 (['volunteers'],['/team','/team/dashboard'],['/children','/inventory','/notifications']),
 ([],[],['/children','/inventory','/notifications','/outings','/team']),
])
async def test_permission_matrix_enforced_by_api(ctx,rights,allowed,denied):
    root=await setup(ctx);user,eid=await invite(ctx,root,permissions=rights);ctx.login(user)
    cfg=(await ctx.client.get(root+'/config')).json();assert cfg['simple_role']=='volunteer' and set(cfg['permissions'])==set(rights) and not cfg['can_configure']
    for path in allowed:assert (await ctx.client.get(root+path)).status_code==200,path
    for path in denied:assert (await ctx.client.get(root+path)).status_code==403,path
    assert (await ctx.client.get(root+'/team/mine')).status_code==200
    assert (await ctx.client.post(root+'/team/access',json={'request_id':key(),'role':'admin','event_user_ids':[eid],'expected_versions':{eid:1}})).status_code==403
    assert (await ctx.client.put(root+'/classrooms',json={'classrooms':['Group A','Group B'],'expected_classrooms':['Group A','Group B']})).status_code==403

@pytest.mark.asyncio
async def test_identity_support_and_movement_permissions_are_independent(ctx):
    root=await setup(ctx);c=await child(ctx,root);c=await act(ctx,root,c,'dropoff',adult_name='Maryam Yusuf',relationship='parent',identity_checked=True,allergy=True,accommodation=False,screening_wristband_assigned=True)
    support,_=await invite(ctx,root,permissions=['support']);ctx.login(support)
    await act(ctx,root,c,'classroom',expected=403)
    c=await act(ctx,root,c,'clear_allergy',notes='Restricted clinical note',wristband_assigned=True)
    ctx.login(ctx.ids['user_a']);scanner,_=await invite(ctx,root,permissions=['checkin']);ctx.login(scanner)
    detail=(await ctx.client.get(root+'/children/'+c['id'])).json();assert 'allergy_notes' not in detail and 'email' not in detail['contacts'][0]
    c=await act(ctx,root,c,'classroom')
    assert (await ctx.client.post(root+'/children',json={'name':'Forbidden child'})).status_code==403
    ctx.login(ctx.ids['user_a']);editor,_=await invite(ctx,root,permissions=['children']);ctx.login(editor)
    await act(ctx,root,c,'clinic',expected=403,adult_name='Someone')
    detail=(await ctx.client.get(root+'/children/'+c['id'])).json();assert 'email' in detail['contacts'][0] and 'allergy_notes' not in detail

@pytest.mark.asyncio
async def test_access_updates_scoped_idempotent_versioned_and_do_not_change_classes_or_phone(ctx):
    root=await setup(ctx);user,eid=await invite(ctx,root);roster=(await ctx.client.get(root+'/team')).json();p=next(p for p in roster['people'] if p['event_user_id']==eid)
    body={'request_id':key(),'role':'volunteer','permissions':['inventory','messages'],'event_user_ids':[eid],'expected_versions':{eid:p['version']},'notify_email':False}
    r=await ctx.client.post(root+'/team/access',json=body);assert r.status_code==200,r.text;assert (await ctx.client.post(root+'/team/access',json=body)).json()==r.json()
    bad={**body,'request_id':key()};assert (await ctx.client.post(root+'/team/access',json=bad)).status_code==409
    async with _Session() as db:profile=await db.get(JuniorVolunteerProfile,eid);assert profile.phone==p['phone'] and profile.classrooms==p['classrooms']
    ctx.login(user);assert (await ctx.client.get(root+'/inventory')).status_code==200;assert (await ctx.client.post(root+'/team/access',json={**body,'role':'admin'})).status_code==403
    ctx.login(ctx.ids['user_b']);assert (await ctx.client.post(root+'/team/access',json=body)).status_code==404

@pytest.mark.asyncio
async def test_legacy_grants_are_preserved_and_readonly_caps_admin(ctx):
    root=await setup(ctx)
    body={'request_id':key(),'notify_email':False,'rows':[{'name':'Legacy support','email':key()+'@example.com','role':'support'}]};r=await ctx.client.post(root+'/team/bulk',json=body);assert r.status_code==201,r.text
    p=next(p for p in (await ctx.client.get(root+'/team')).json()['people'] if p['event_user_id']==r.json()['event_user_ids'][0]);assert p['role']=='volunteer' and set(p['permissions'])=={'checkin','support'}
    user,eid=await invite(ctx,root,'admin')
    async with _Session() as db:eu=await db.get(EventUser,eid);eu.access_level='view';await db.commit()
    ctx.login(user);cfg=(await ctx.client.get(root+'/config')).json();assert cfg['read_only'] and not cfg['can_configure'];assert (await ctx.client.get(root+'/inventory')).status_code==200
    assert (await ctx.client.post(root+'/inventory',json={'name':'Denied','total':1})).status_code==403

@pytest.mark.asyncio
async def test_legacy_settings_cannot_silently_erase_new_permission_grants(ctx):
    root=await setup(ctx);user,eid=await invite(ctx,root,permissions=['inventory'])
    r=await ctx.client.put(root+'/config',json={'enabled':True,'staff':{},'classrooms':['Group A','Group B']});assert r.status_code==409,r.text
    ctx.login(user);assert (await ctx.client.get(root+'/inventory')).status_code==200

@pytest.mark.asyncio
async def test_active_shift_permissions_cannot_change_until_handover(ctx):
    from test_junior_team import shifts
    root=await setup(ctx);user,eid=await invite(ctx,root)
    assigned,_=await shifts(ctx,root,[eid],classroom=None)
    ctx.login(user);assert (await ctx.client.post(root+'/team/shifts/'+assigned[0]['id']+'/checkin',json={'version':1,'physically_present':True})).status_code==200
    ctx.login(ctx.ids['user_a']);p=next(p for p in (await ctx.client.get(root+'/team')).json()['people'] if p['event_user_id']==eid)
    r=await ctx.client.post(root+'/team/access',json={'request_id':key(),'event_user_ids':[eid],'role':'volunteer','permissions':['inventory'],'expected_versions':{eid:p['version']},'notify_email':False});assert r.status_code==409,r.text
    ctx.login(user);assert (await ctx.client.get(root+'/children')).status_code==200

@pytest.mark.asyncio
async def test_new_admin_cannot_manage_wider_event_or_organization_team(ctx):
    root=await setup(ctx);user,eid=await invite(ctx,root,'admin');ctx.login(user)
    assert (await ctx.client.put('/api/events/'+ctx.ids['event_a'],json={'name':'Forbidden rename'})).status_code==403
    assert (await ctx.client.get('/api/events/'+ctx.ids['event_a']+'/members')).status_code==403

@pytest.mark.asyncio
async def test_revocation_blocks_action_and_old_request_replay(ctx):
    root=await setup(ctx);c=await child(ctx,root);user,eid=await invite(ctx,root);ctx.login(user)
    body={'request_id':key(),'version':c['version'],'action':'dropoff','adult_name':'Maryam Yusuf','relationship':'parent','identity_checked':True,'allergy':False,'accommodation':False,'screening_wristband_assigned':True}
    r=await ctx.client.post(root+'/children/'+c['id']+'/actions',json=body);assert r.status_code==200,r.text
    ctx.login(ctx.ids['user_a']);p=next(p for p in (await ctx.client.get(root+'/team')).json()['people'] if p['event_user_id']==eid)
    r=await ctx.client.post(root+'/team/access',json={'request_id':key(),'role':'volunteer','permissions':['messages'],'event_user_ids':[eid],'expected_versions':{eid:p['version']},'notify_email':False});assert r.status_code==200,r.text
    ctx.login(user);assert (await ctx.client.get(root+'/children/'+c['id'])).status_code==200
    assert (await ctx.client.post(root+'/children/'+c['id']+'/actions',json=body)).status_code==403
