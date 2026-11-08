from datetime import datetime,timedelta
from urllib.parse import urlparse
import copy
import hashlib
import pytest
from sqlalchemy import select
from conftest import _Session
from app.models import CertificateWorkflowLink,EventCertificate,EventCertificateTemplate,Guest,Event
from app.routers.live_content import _certificate_html,auto_issue_eligible_certificates

STROKES=[[[40,180],[80,60],[120,160],[170,100],[220,180]]]

def token(result):return urlparse(result['url']).path.rsplit('/',1)[1]
def admin(ctx,suffix):return f"/api/events/{ctx.ids['event_a']}/{suffix}"

async def setup(ctx,key='royal'):
    ctx.login(ctx.ids['user_a'])
    response=await ctx.client.post(admin(ctx,'certificate-presets/'+key))
    assert response.status_code==201,response.text
    return response.json()

async def signature(ctx,t,slot=1):
    r=await ctx.client.post(admin(ctx,f"certificate-templates/{t['id']}/signature-requests"),json={'slot':slot,'label':'Conference president','expected_email':'signer@example.test'})
    assert r.status_code==201,r.text
    return r.json()

async def sign(ctx,request,**overrides):
    return await ctx.client.post('/api/certificate-workflow/signatures/'+token(request),json={
        'name':'Ada Signatory','title':'Conference President','email':'signer@example.test','consent':True,'strokes':STROKES,**overrides})

async def approve(ctx,r):
    response=await ctx.client.post(admin(ctx,f"certificate-workflow/{r['id']}/approve"))
    assert response.status_code==200,response.text

@pytest.mark.asyncio
async def test_catalog_and_event_owned_presets_are_idempotent(ctx):
    for key in ['royal','heritage','midnight','ivory']:
        t=await setup(ctx,key)
        assert t['design']['layout']==key
        assert (await setup(ctx,key))['id']==t['id']
        assert not t['eligibility'].get('auto_issue')
    rows=(await ctx.client.get(admin(ctx,'certificate-workflow'))).json()
    assert len(rows['presets'])==4 and not rows['links']
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(admin(ctx,'certificate-workflow'))).status_code in (403,404)
    assert (await ctx.client.post(admin(ctx,'certificate-presets/royal'))).status_code in (403,404)

@pytest.mark.asyncio
async def test_client_choice_persists_and_cannot_silently_change(ctx):
    a,b=await setup(ctx),await setup(ctx,'midnight')
    r=await ctx.client.post(admin(ctx,'certificate-reviews'),json={'template_ids':[a['id'],b['id']]})
    assert r.status_code==201
    r=r.json();ctx.login(None)
    public=await ctx.client.get('/api/certificate-workflow/reviews/'+token(r));assert public.status_code==200
    assert public.headers['cache-control']=='no-store'
    assert 'sign' not in public.text and len(public.json()['options'])==2
    body={'template_id':b['id'],'reviewer_name':'Client Lead','note':'Choose navy'}
    path='/api/certificate-workflow/reviews/'+token(r)
    assert (await ctx.client.post(path,json=body)).status_code==200
    assert (await ctx.client.post(path,json=body)).status_code==200
    assert (await ctx.client.post(path,json={**body,'template_id':a['id']})).status_code==409
    assert (await ctx.client.post(path,json={**body,'template_id':'foreign-template'})).status_code==422
    ctx.login(ctx.ids['user_a'])
    saved=(await ctx.client.get(admin(ctx,'certificate-workflow'))).json()['links'][0]
    assert saved['submission']==body and saved['status']=='selected'
    assert 'url' not in saved and 'token_hash' not in saved
    async with _Session() as db:
        link=await db.get(CertificateWorkflowLink,r['id'])
        assert link.token_hash==hashlib.sha256(token(r).encode()).hexdigest()
        assert token(r) not in str(vars(link))

@pytest.mark.asyncio
async def test_reviews_do_not_share_uploaded_or_collected_signatures(ctx):
    t=await setup(ctx)
    async with _Session() as db:
        row=await db.get(EventCertificateTemplate,t['id'])
        row.design={**row.design,'signature_url':'https://example.test/private.png','signature_name':'Private Name','signatories':[{'signature_png':'SECRET'}]}
        await db.commit()
    r=(await ctx.client.post(admin(ctx,'certificate-reviews'),json={'template_ids':[t['id']]})).json()
    ctx.login(None)
    proof=await ctx.client.get(f"/api/certificate-workflow/reviews/{token(r)}/preview/{t['id']}")
    assert proof.status_code==200 and 'DESIGN PREVIEW' in proof.text
    assert 'private.png' not in proof.text and 'Private Name' not in proof.text and 'SECRET' not in proof.text
    assert "class='qr'" not in proof.text
    assert 'frame-ancestors' in proof.headers['content-security-policy']
    assert (await ctx.client.get(f"/api/certificate-workflow/reviews/{token(r)}/preview/foreign")).status_code==404

@pytest.mark.asyncio
async def test_signature_consent_bounds_identity_and_single_submission(ctx):
    t=await setup(ctx);r=await signature(ctx,t);ctx.login(None)
    for change in [{'consent':False},{'strokes':[]},{'strokes':[[[0,0],[1,1],[2,2]]]},{'strokes':[[[0,0],[1001,10],[40,50]]]},{'email':'other@example.test'}]:
        response=await sign(ctx,r,**change);assert response.status_code==422,response.text
    response=await sign(ctx,r);assert response.status_code==200,response.text
    assert 'signature_png' not in response.text
    assert (await sign(ctx,r)).status_code==409
    response=await ctx.client.get('/api/certificate-workflow/signatures/'+token(r))
    assert 'signature_png' not in response.text and 'signer@example.test' not in response.text
    assert response.json()['status']=='submitted'
    ctx.login(ctx.ids['user_a']);saved=(await ctx.client.get(admin(ctx,'certificate-workflow'))).json()['links'][0]
    assert saved['submission']['signature_png'].startswith('data:image/png;base64,')
    assert saved['submission']['identity_method']=='private-link-possession'
    assert saved['submission']['consent'] is True

@pytest.mark.asyncio
async def test_approval_is_required_and_is_immutable_in_issued_certificate(ctx):
    t=await setup(ctx)
    async with _Session() as db:
        template=await db.get(EventCertificateTemplate,t['id']);template.eligibility={'minimum_sessions':0,'require_event_checkin':False};await db.commit()
        guest=await db.scalar(select(Guest).where(Guest.event_id==ctx.ids['event_a']));gid=guest.id
    r=await signature(ctx,t)
    issue={'template_id':t['id'],'guest_ids':[gid],'eligible_only':True,'send_email':False}
    assert (await ctx.client.post(admin(ctx,'certificates/issue'),json=issue)).status_code==409
    assert (await sign(ctx,r)).status_code==200
    assert (await ctx.client.post(admin(ctx,'certificates/issue'),json=issue)).status_code==409
    await approve(ctx,r)
    result=await ctx.client.post(admin(ctx,'certificates/issue'),json=issue);assert result.status_code==200,result.text
    assert result.json()['issued']==1
    async with _Session() as db:
        cert=await db.scalar(select(EventCertificate).where(EventCertificate.template_id==t['id']))
        snapshot=copy.deepcopy(cert.snapshot)
        assert snapshot['signatories'][0]['name']=='Ada Signatory'
        html=_certificate_html(cert);assert 'data:image/png;base64,' in html and 'Conference President' in html
    assert (await ctx.client.post(admin(ctx,f"certificate-workflow/{r['id']}/revoke"))).status_code==200
    async with _Session() as db:
        cert=await db.scalar(select(EventCertificate).where(EventCertificate.template_id==t['id']))
        assert cert.snapshot==snapshot

@pytest.mark.asyncio
async def test_design_changes_require_new_signature_and_replacement_revokes_old_link(ctx):
    t=await setup(ctx);r=await signature(ctx,t)
    assert (await sign(ctx,r)).status_code==200
    await approve(ctx,r)
    async with _Session() as db:
        row=await db.get(EventCertificateTemplate,t['id']);row.design={**row.design,'body':'New wording'};await db.commit()
    rows=(await ctx.client.get(admin(ctx,'certificate-workflow'))).json()['links'];assert rows[0]['current_design'] is False
    assert (await ctx.client.post(admin(ctx,f"certificate-workflow/{r['id']}/approve"))).status_code==409
    fresh=await signature(ctx,t)
    assert (await sign(ctx,r)).status_code==410
    assert (await sign(ctx,fresh)).status_code==200

@pytest.mark.asyncio
async def test_expired_revoked_and_foreign_links(ctx):
    t=await setup(ctx);r=await signature(ctx,t)
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.post(admin(ctx,f"certificate-workflow/{r['id']}/approve"))).status_code in (403,404)
    assert (await ctx.client.post(admin(ctx,f"certificate-workflow/{r['id']}/revoke"))).status_code in (403,404)
    async with _Session() as db:
        row=await db.get(CertificateWorkflowLink,r['id']);row.expires_at=datetime.utcnow()-timedelta(seconds=1);await db.commit()
    ctx.login(None)
    assert (await sign(ctx,r)).status_code==410
    assert (await ctx.client.get('/api/certificate-workflow/signatures/'+token(r))).status_code==410
    assert (await ctx.client.get('/api/certificate-workflow/signatures/unknown')).status_code==404

@pytest.mark.asyncio
async def test_auto_issue_waits_for_signatories(ctx):
    t=await setup(ctx);await signature(ctx,t)
    async with _Session() as db:
        row=await db.get(EventCertificateTemplate,t['id']);row.eligibility={'auto_issue':True,'minimum_sessions':0,'require_event_checkin':False};await db.commit()
        guest=await db.scalar(select(Guest).where(Guest.event_id==ctx.ids['event_a']));event=await db.get(Event,ctx.ids['event_a'])
        assert await auto_issue_eligible_certificates(event,guest,db)==[]

@pytest.mark.asyncio
async def test_two_signatories_required_and_both_are_snapshotted(ctx):
    t=await setup(ctx)
    async with _Session() as db:
        row=await db.get(EventCertificateTemplate,t['id']);row.eligibility={'minimum_sessions':0,'require_event_checkin':False};await db.commit()
        guest=await db.scalar(select(Guest).where(Guest.event_id==ctx.ids['event_a']));gid=guest.id
    first,second=await signature(ctx,t,1),await signature(ctx,t,2)
    assert (await sign(ctx,first)).status_code==200
    await approve(ctx,first)
    issue={'template_id':t['id'],'guest_ids':[gid],'send_email':False}
    assert (await ctx.client.post(admin(ctx,'certificates/issue'),json=issue)).status_code==409
    assert (await sign(ctx,second,name='Second Signatory',title='Conference Secretary')).status_code==200
    await approve(ctx,second)
    assert (await ctx.client.post(admin(ctx,'certificates/issue'),json=issue)).json()['issued']==1
    async with _Session() as db:
        cert=await db.scalar(select(EventCertificate).where(EventCertificate.template_id==t['id']))
        assert [s['name'] for s in cert.snapshot['signatories']]==['Ada Signatory','Second Signatory']

@pytest.mark.asyncio
async def test_review_selection_detects_changed_template_and_other_event_templates_rejected(ctx):
    t=await setup(ctx)
    r=(await ctx.client.post(admin(ctx,'certificate-reviews'),json={'template_ids':[t['id']]})).json()
    assert (await ctx.client.post('/api/certificate-workflow/reviews/'+token(r),json={'template_id':t['id'],'reviewer_name':'Client'})).status_code==200
    async with _Session() as db:
        row=await db.get(EventCertificateTemplate,t['id']);row.name='Changed design';await db.commit()
    assert not (await ctx.client.get(admin(ctx,'certificate-workflow'))).json()['links'][0]['current_design']
    async with _Session() as db:
        other=Event(id='event-b',org_id=ctx.ids['org_b'],name='Other',couples_name='Other',event_date=datetime(2026,11,11),checkin_base_url='https://example.test')
        db.add(other);await db.flush();foreign=EventCertificateTemplate(event_id=other.id,name='Foreign');db.add(foreign);await db.commit();fid=foreign.id
    assert (await ctx.client.post(admin(ctx,'certificate-reviews'),json={'template_ids':[t['id'],fid]})).status_code==404

@pytest.mark.asyncio
async def test_changed_event_details_also_require_fresh_sign_off(ctx):
    t=await setup(ctx);r=await signature(ctx,t)
    async with _Session() as db:
        e=await db.get(Event,ctx.ids['event_a']);e.venue_name='New venue';await db.commit()
    assert (await sign(ctx,r)).status_code==409
    assert not (await ctx.client.get(admin(ctx,'certificate-workflow'))).json()['links'][0]['current_design']
