import uuid
import pytest
from app.routers import media_library as media

PDF=b'%PDF-1.4\nreviewed proposal\n%%EOF'

def payload(**kw):
    return dict(recipient='client@example.com',subject='Event proposal',confirmed='true',request_id=str(uuid.uuid4()),**kw)

@pytest.mark.asyncio
async def test_review_auth_and_pdf_guard(ctx,monkeypatch):
    calls=[]
    async def sender(*a,**kw): calls.append(a);return True
    monkeypatch.setattr(media,'send_simple_email',sender)
    monkeypatch.setattr(media,'recipient_allowed',lambda *a:True)
    ctx.login(ctx.ids['user_b'])
    r=await ctx.client.post('/api/events/proposals/email',data=payload(),files={'file':('proposal.pdf',PDF,'application/pdf')})
    assert r.status_code==403
    ctx.login(ctx.ids['superadmin'])
    data=payload();data['confirmed']='false'
    r=await ctx.client.post('/api/events/proposals/email',data=data,files={'file':('proposal.pdf',PDF,'application/pdf')})
    assert r.status_code==400
    r=await ctx.client.post('/api/events/proposals/email',data=payload(),files={'file':('proposal.pdf',b'not pdf','application/pdf')})
    assert r.status_code==400 and not calls

@pytest.mark.asyncio
async def test_exact_attachment_idempotency_and_escape(ctx,monkeypatch):
    calls=[]
    async def sender(*a,**kw): calls.append((a,kw));return True
    monkeypatch.setattr(media,'send_simple_email',sender)
    monkeypatch.setattr(media,'recipient_allowed',lambda *a:True)
    ctx.login(ctx.ids['superadmin']);data=payload(message='<script>alert(1)</script>')
    for i in range(2):
        r=await ctx.client.post('/api/events/proposals/email',data=data,files={'file':('proposal.pdf',PDF,'application/pdf')})
        assert r.status_code==200,r.text
        assert r.json()['status']=='accepted' and r.json()['duplicate_prevented']==bool(i)
    assert len(calls)==1 and calls[0][1]['attachments'][0][1]==PDF
    assert '<script>' not in calls[0][0][2]
    data['recipient']='other@example.com'
    r=await ctx.client.post('/api/events/proposals/email',data=data,files={'file':('proposal.pdf',PDF,'application/pdf')})
    assert r.status_code==409 and len(calls)==1

@pytest.mark.asyncio
async def test_policy_and_unconfirmed_provider(ctx,monkeypatch):
    ctx.login(ctx.ids['superadmin'])
    monkeypatch.setattr(media,'recipient_allowed',lambda *a:False)
    r=await ctx.client.post('/api/events/proposals/email',data=payload(),files={'file':('proposal.pdf',PDF,'application/pdf')})
    assert r.status_code==403
    monkeypatch.setattr(media,'recipient_allowed',lambda *a:True)
    async def sender(*a,**kw):return False
    monkeypatch.setattr(media,'send_simple_email',sender)
    r=await ctx.client.post('/api/events/proposals/email',data=payload(),files={'file':('proposal.pdf',PDF,'application/pdf')})
    assert r.status_code==200 and r.json()['status']=='unconfirmed'
