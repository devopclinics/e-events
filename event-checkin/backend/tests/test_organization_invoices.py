import pytest
from sqlalchemy import select
from conftest import _Session
from app.models import Organization, Membership

BASE='/api/organization-invoices'
PDF=b'%PDF-1.4\ninvoice test snapshot\n%%EOF'

def payload(**patch):
    return dict(client='Client One',title='Birthday services',issuerName='Org A',issuerContact='hello@example.com',date='',dueDate='',issuedDate='2026-11-15',currency='NGN',fees=[{'id':'service','label':'Event services','amount':275000,'complimentary':False,'description':'150 guests'}],discount=0,deposit=60,bank='Bank',accountName='Business',accountNumber='12345',brand='#173f34',accent='#a96742',balanceDays=7,exclusions='',**patch)

def url(path,org):return BASE+path+'?org_id='+org

@pytest.mark.asyncio
async def test_owner_creation_and_cross_tenant_isolation(ctx):
    ctx.login(ctx.ids['user_a']);a=ctx.ids['org_a'];b=ctx.ids['org_b']
    result=await ctx.client.post(url('',a),json={'payload':payload()});assert result.status_code==201,result.text
    row=result.json();assert row['org_id']==a and row['payload']['total_minor']==27500000 and row['payload']['deposit_minor']==16500000
    assert row['status']=='draft' and not row['locked']
    assert len((await ctx.client.get(url('',a))).json())==1
    ctx.login(ctx.ids['user_b'])
    assert (await ctx.client.get(url('',a))).status_code==403
    assert (await ctx.client.post(url('',a),json={'payload':payload()})).status_code==403
    for method,path in [('get','/'+row['id']),('get','/'+row['id']+'/download')]:assert (await getattr(ctx.client,method)(url(path,b))).status_code==404
    assert (await ctx.client.put(url('/'+row['id'],b),json={'payload':payload(),'version':1})).status_code==404
    assert (await ctx.client.get(url('',b))).json()==[]

@pytest.mark.asyncio
async def test_issue_locks_payload_and_persists_pdf(ctx):
    ctx.login(ctx.ids['user_a']);a=ctx.ids['org_a']
    row=(await ctx.client.post(url('',a),json={'payload':payload()})).json();id=row['id']
    assert (await ctx.client.get(url('/'+id+'/download',a))).status_code==409
    assert (await ctx.client.put(url('/'+id,a),json={'payload':payload(),'version':99})).status_code==409
    changed=payload();changed['fees'][0]['amount']=300000
    row=(await ctx.client.put(url('/'+id,a),json={'payload':changed,'version':1})).json();assert row['version']==2
    assert (await ctx.client.post(url('/'+id+'/issue',a),data={'version':1},files={'file':('invoice.pdf',PDF,'application/pdf')})).status_code==409
    result=await ctx.client.post(url('/'+id+'/issue',a),data={'version':2},files={'file':('invoice.pdf',PDF,'application/pdf')});assert result.status_code==200,result.text
    issued=result.json();assert issued['locked'] and issued['has_pdf'] and issued['status']=='issued' and issued['payload']['total_minor']==30000000
    assert (await ctx.client.put(url('/'+id,a),json={'payload':payload(),'version':3})).status_code==409
    assert (await ctx.client.delete(url('/'+id,a)+'&version=3')).status_code==409
    assert (await ctx.client.post(url('/'+id+'/issue',a),data={'version':3},files={'file':('invoice.pdf',PDF,'application/pdf')})).status_code==409
    download=await ctx.client.get(url('/'+id+'/download',a));assert download.content==PDF and download.headers['cache-control']=='private, no-store'
    assert issued['reference']+'.pdf' in download.headers['content-disposition']

@pytest.mark.asyncio
async def test_validation_optional_dates_and_money(ctx):
    ctx.login(ctx.ids['user_a']);a=ctx.ids['org_a']
    for key,value in [('date','2026-02-31'),('dueDate','2026-02-31'),('currency','INVALID'),('deposit',True),('deposit',101),('discount',275001)]:
        data=payload();data[key]=value;assert (await ctx.client.post(url('',a),json={'payload':data})).status_code==400
    for amount in [-1,0.001,'NaN','Infinity']:
        data=payload();data['fees'][0]['amount']=amount;assert (await ctx.client.post(url('',a),json={'payload':data})).status_code==400
    row=(await ctx.client.post(url('',a),json={'payload':payload()})).json()
    assert (await ctx.client.post(url('/'+row['id']+'/issue',a),data={'version':1},files={'file':('invoice.pdf',b'not a PDF','application/pdf')})).status_code==400
    incomplete=payload();incomplete['bank']='';row=(await ctx.client.post(url('',a),json={'payload':incomplete})).json()
    assert (await ctx.client.post(url('/'+row['id']+'/issue',a),data={'version':1},files={'file':('invoice.pdf',PDF,'application/pdf')})).status_code==400

@pytest.mark.asyncio
async def test_staff_admin_and_suspended_organization(ctx):
    a=ctx.ids['org_a'];b=ctx.ids['org_b'];ctx.login(ctx.ids['user_b'])
    async with _Session() as db:
        db.add(Membership(org_id=a,user_id=ctx.ids['user_b'].id,role='staff'));await db.commit()
    context=(await ctx.client.get(BASE+'/organizations')).json();assert a not in [r['id'] for r in context['organizations']]
    assert (await ctx.client.get(url('',a))).status_code==403
    async with _Session() as db:
        m=await db.scalar(select(Membership).where(Membership.org_id==a,Membership.user_id==ctx.ids['user_b'].id));m.role='admin';await db.commit()
    assert (await ctx.client.get(url('',a))).status_code==200
    assert (await ctx.client.get(BASE+'/organizations')).json()['default_org_id']==b
    async with _Session() as db:
        org=await db.get(Organization,a);org.is_active=False;await db.commit()
    assert (await ctx.client.get(url('',a))).status_code==404

@pytest.mark.asyncio
async def test_draft_deletion_and_legacy_staff_archive_remains(ctx):
    ctx.login(ctx.ids['user_a']);a=ctx.ids['org_a'];row=(await ctx.client.post(url('',a),json={'payload':payload()})).json()
    assert (await ctx.client.delete(url('/'+row['id'],a)+'&version=99')).status_code==409
    assert (await ctx.client.delete(url('/'+row['id'],a)+'&version=1')).status_code==204
    assert (await ctx.client.get(url('',a))).json()==[]
    assert (await ctx.client.get('/api/media/invoices')).status_code==403
    ctx.login(ctx.ids['superadmin']);assert (await ctx.client.get('/api/media/invoices')).status_code==200

@pytest.mark.asyncio
async def test_reviewed_archive_import_is_scoped_idempotent_and_exact(ctx):
    from app.services.import_invoice_archive import import_archive
    from app.models import OrganizationInvoice
    from app.routers.invoice_library import FILES
    async with _Session() as db:
        a=await db.get(Organization,ctx.ids['org_a']);b=await db.get(Organization,ctx.ids['org_b'])
        first=await import_archive(db,a,ctx.ids['user_a']);assert len(first)==2 and all(not row['existing'] for row in first)
        second=await import_archive(db,a,ctx.ids['user_a']);assert all(row['existing'] for row in second)
        row=await db.get(OrganizationInvoice,'honeybols-50th-birthday-150')
        assert row.status=='issued' and row.payload['total_minor']==27500000 and row.org_id==a.id
        assert row.pdf_bytes==(FILES/'Festio-Invoice-FES-20261115-H150.pdf').read_bytes()
        with pytest.raises(ValueError):await import_archive(db,b,ctx.ids['user_b'])
