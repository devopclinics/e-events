from copy import deepcopy
from types import SimpleNamespace
import pytest
from sqlalchemy import select
from app.certificate_layouts import certificate_layout
from app.models import EventCertificate, Guest
from app.routers.live_content import _certificate_html
from conftest import _Session

@pytest.mark.parametrize('layout', ['classic','modern','editorial',None,'unknown'])
def test_document_uses_saved_layout_and_preserves_snapshot(layout):
    snapshot={'participant_name':'Amina <Guest>','event_name':'Academy event','design':{'layout':layout,'kind':'completion','title':'Certificate of Completion','primary_color':'#194e3d','accent_color':'#dfbf75','logo_url':'https://example.test/logo.png'}}
    before=deepcopy(snapshot)
    document=_certificate_html(SimpleNamespace(snapshot=snapshot,verification_token='synthetic',certificate_number='TEST-1'))
    expected=layout if layout in ['classic','modern','editorial'] else 'classic'
    assert f"data-layout='{expected}'" in document
    assert 'Amina &lt;Guest&gt;' in document and 'Certificate of Completion' in document
    assert "class='qr'" in document and 'https://example.test/logo.png' in document
    assert snapshot==before
    if expected=='modern': assert 'border-left:40px' in document
    elif expected=='editorial': assert 'padding:80px' in document
    else: assert certificate_layout(layout,'#194e3d','#dfbf75')==('classic','')

@pytest.mark.asyncio
async def test_template_layout_is_saved_into_issued_snapshot(ctx):
    ctx.login(ctx.ids['user_a']);event_id=ctx.ids['event_a']
    created=await ctx.client.post(f'/api/events/{event_id}/certificate-templates',json={'name':'Completion modern','design':{'kind':'completion','layout':'modern','title':'Certificate of Completion'},'eligibility':{'minimum_sessions':0,'require_event_checkin':False},'active':True})
    assert created.status_code==201
    template=created.json()
    async with _Session() as db:
        guest=await db.scalar(select(Guest).where(Guest.event_id==event_id));guest_id=guest.id
    issued=await ctx.client.post(f'/api/events/{event_id}/certificates/issue',json={'template_id':template['id'],'guest_ids':[guest_id],'eligible_only':True,'send_email':False})
    assert issued.status_code==200 and issued.json()['issued']==1
    updated=await ctx.client.put(f"/api/events/{event_id}/certificate-templates/{template['id']}",json={'name':'Changed future design','design':{'kind':'appreciation','layout':'editorial','title':'Certificate of Appreciation'},'eligibility':{'minimum_sessions':0,'require_event_checkin':False},'active':True})
    assert updated.status_code==200
    async with _Session() as db:
        cert=await db.scalar(select(EventCertificate).where(EventCertificate.event_id==event_id))
        assert cert.snapshot['design']['layout']=='modern'
        assert cert.snapshot['design']['kind']=='completion'
        assert "data-layout='modern'" in _certificate_html(cert)
