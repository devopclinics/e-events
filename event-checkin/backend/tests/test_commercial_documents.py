import copy
import uuid
import pytest
from app.routers import media_library as media

BASE='/api/platform/commercial-documents'
PDF=b'%PDF-1.4\nreviewed invoice\n%%EOF'

def invoice():
    return dict(client='Honeybols Events',title='Birthday celebration',date='2027-05-22',issuedDate='2026-11-04',currency='NGN',fees=[dict(id='package',label='Event package',amount=600000,complimentary=False),dict(id='setup',label='Website and RSVP',amount=75000,complimentary=True)],discount=200000,deposit=60,balanceDays=7,bank='Providus Bank LTD',accountName='FOHMA INTEGRATED SOLUTIONS LTD',accountNumber='1310138643')

@pytest.mark.asyncio
async def test_management_only(ctx):
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(BASE)).status_code==403
    assert (await ctx.client.post(BASE,json={'kind':'invoice','payload':invoice()})).status_code==403

@pytest.mark.asyncio
async def test_conversion_snapshot_conflicts_and_payments(ctx):
    ctx.login(ctx.ids['superadmin'])
    proposal=(await ctx.client.post(BASE,json={'kind':'proposal','payload':invoice()})).json()
    r=await ctx.client.post(BASE,json={'kind':'invoice','payload':invoice(),'source_id':proposal['id']})
    assert r.status_code==201,r.text
    row=r.json();assert row['payload']['total_minor']==40000000 and row['payload']['deposit_minor']==24000000
    assert row['reference'].startswith('INV-')
    r=await ctx.client.put(BASE+'/'+row['id'],json={'kind':'invoice','payload':invoice(),'source_id':proposal['id'],'version':99})
    assert r.status_code==409
    r=await ctx.client.post(BASE+'/'+row['id']+'/issue',json={'version':1})
    assert r.status_code==200,r.text
    issued=r.json();assert issued['status']=='issued'
    assert (await ctx.client.put(BASE+'/'+row['id'],json={'kind':'invoice','payload':invoice(),'source_id':proposal['id'],'version':2})).status_code==409
    changed=invoice();changed['client']='Another client'
    assert (await ctx.client.put(BASE+'/'+proposal['id'],json={'kind':'proposal','payload':changed,'version':1})).status_code==200
    saved=(await ctx.client.get(BASE)).json()
    assert next(r for r in saved if r['id']==row['id'])['payload']['client']=='Honeybols Events'
    r=await ctx.client.post(BASE+'/'+row['id']+'/payment',json={'version':2,'paid_minor':24000000})
    assert r.json()['status']=='part-paid'
    assert (await ctx.client.post(BASE+'/'+row['id']+'/payment',json={'version':3,'paid_minor':40000001})).status_code==400
    assert (await ctx.client.post(BASE+'/'+row['id']+'/payment',json={'version':3,'paid_minor':40000000})).json()['status']=='paid'

@pytest.mark.asyncio
async def test_money_and_missing_details(ctx):
    ctx.login(ctx.ids['superadmin'])
    for patch in [{'discount':600001},{'discount':-1},{'deposit':101},{'date':'2027-02-31'}]:
        assert (await ctx.client.post(BASE,json={'kind':'invoice','payload':{**invoice(),**patch}})).status_code==400
    data=invoice();data['fees'][0]['amount']=1.001
    assert (await ctx.client.post(BASE,json={'kind':'invoice','payload':data})).status_code==400
    data=invoice();data['bank']=''
    row=(await ctx.client.post(BASE,json={'kind':'invoice','payload':data})).json()
    assert (await ctx.client.post(BASE+'/'+row['id']+'/issue',json={'version':1})).status_code==400

@pytest.mark.asyncio
async def test_invoice_email_is_reviewed_idempotent_and_correctly_named(ctx,monkeypatch):
    ctx.login(ctx.ids['superadmin']);calls=[]
    monkeypatch.setattr(media,'recipient_allowed',lambda *a:True)
    async def sender(*a,**kw):calls.append(kw);return True
    monkeypatch.setattr(media,'send_simple_email',sender)
    row=(await ctx.client.post(BASE,json={'kind':'invoice','payload':invoice()})).json()
    form=dict(document_id=row['id'],recipient='client@example.com',subject='Your invoice',request_id=str(uuid.uuid4()),confirmed='true')
    assert (await ctx.client.post('/api/events/proposals/email',data=form,files={'file':('invoice.pdf',PDF,'application/pdf')})).status_code==400
    await ctx.client.post(BASE+'/'+row['id']+'/issue',json={'version':1})
    for i in range(2):
        r=await ctx.client.post('/api/events/proposals/email',data=form,files={'file':('invoice.pdf',PDF,'application/pdf')})
        assert r.status_code==200,r.text
    assert len(calls)==1
    assert calls[0]['message_kind']=='client_invoice'
    assert calls[0]['attachments'][0][0]==row['reference']+'.pdf'
    assert next(x for x in (await ctx.client.get(BASE)).json() if x['id']==row['id'])['status']=='sent'
