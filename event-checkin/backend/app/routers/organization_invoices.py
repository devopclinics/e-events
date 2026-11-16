"""Organization-owned invoice creation, versioned edits and issued snapshots."""
import json
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, select
from sqlalchemy.orm import defer
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth import get_current_user
from ..database import get_db
from ..models import Membership, Organization, OrganizationInvoice, User

router = APIRouter()

class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')
    payload: dict
    version: int = Field(default=1, ge=1)

async def organizations(user, db):
    q = select(Organization).where(Organization.is_active.is_(True))
    if not user.is_platform_superadmin:
        q = q.join(Membership, Membership.org_id == Organization.id).where(Membership.user_id == user.id, Membership.role.in_(['owner','admin']))
    rows = (await db.scalars(q.order_by(Organization.created_at, Organization.id))).all()
    owned = await db.scalar(select(Membership.org_id).join(Organization, Organization.id == Membership.org_id).where(Membership.user_id == user.id, Membership.role.in_(['owner','admin']), Organization.is_active.is_(True)).order_by(case((Membership.role == 'owner', 0), else_=1), case((Organization.id == '00000000-0000-0000-0000-000000000001', 1), else_=0), Organization.created_at, Organization.id).limit(1))
    return rows, owned or (rows[0].id if rows else None)

async def scope(org_id, user, db):
    if not org_id:
        _, org_id = await organizations(user, db)
    org = await db.get(Organization, org_id) if org_id else None
    if not org or not org.is_active:
        raise HTTPException(404, 'Organization not found')
    if not user.is_platform_superadmin:
        role = await db.scalar(select(Membership.role).where(Membership.org_id == org.id, Membership.user_id == user.id))
        if role not in ('owner', 'admin'):
            raise HTTPException(403, 'Organization owner or admin access is required for invoices')
    return org

def minor(value):
    try:
        n = Decimal(str(value))
        if not n.is_finite() or n < 0 or n > 1_000_000_000 or n*100 != (n*100).to_integral_value():
            raise ValueError()
        return int(n*100)
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(400, 'Use non-negative amounts with at most two decimal places')

def validated(payload, org, issuing=False):
    try:
        if len(json.dumps(payload, allow_nan=False).encode()) > 100_000:
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(400, 'Invoice data is too large or invalid')
    d = dict(payload)
    limits = {'client':120,'title':140,'issuerName':150,'issuerContact':200,'bank':120,'accountName':150,'accountNumber':60,'exclusions':850}
    for key, limit in limits.items():
        if not isinstance(d.get(key,''),str) or len(d.get(key,'')) > limit:
            raise HTTPException(400, 'Check invoice text lengths')
    d['issuerName'] = d.get('issuerName') or org.name
    if d.get('currency') not in ('NGN','USD','GBP','EUR'):
        raise HTTPException(400, 'Choose a supported currency')
    for key in ('issuedDate','date','dueDate'):
        if key == 'issuedDate' or d.get(key):
            try: date.fromisoformat(d[key])
            except (KeyError,ValueError,TypeError): raise HTTPException(400, 'Choose valid invoice, due and event dates')
    fees = d.get('fees')
    if not isinstance(fees,list) or not 1 <= len(fees) <= 8:
        raise HTTPException(400, 'Include one to eight service rows')
    subtotal = 0
    for row in fees:
        if not isinstance(row,dict) or not isinstance(row.get('label'),str) or not row['label'].strip() or len(row['label']) > 140 or not isinstance(row.get('complimentary'),bool) or not isinstance(row.get('description',''),str) or len(row.get('description','')) > 200:
            raise HTTPException(400, 'Check service labels, descriptions and included selections')
        amount = minor(row.get('amount'))
        if not row['complimentary']: subtotal += amount
    discount = minor(d.get('discount',0))
    if discount > subtotal: raise HTTPException(400, 'Discount cannot exceed the subtotal')
    deposit = d.get('deposit',0)
    if not isinstance(deposit,int) or isinstance(deposit,bool) or not 0 <= deposit <= 100:
        raise HTTPException(400, 'Deposit must be a whole percentage from 0 to 100')
    if issuing and (not all(d.get(k,'').strip() for k in ['client','title','issuerName','bank','accountName','accountNumber']) or subtotal-discount <= 0):
        raise HTTPException(400, 'Add client, title, issuer, payment details and a positive total before issuing')
    d['total_minor'] = subtotal-discount
    d['deposit_minor'] = int((Decimal(subtotal-discount)*deposit/100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
    return d

def output(row):
    return dict(id=row.id,org_id=row.org_id,reference=row.reference,payload=row.payload,status=row.status,version=row.version,has_pdf=row.has_pdf,filename=row.filename,created_at=row.created_at,issued_at=row.issued_at,locked=row.status!='draft')

async def find(invoice_id, org, db):
    row = await db.scalar(select(OrganizationInvoice).where(OrganizationInvoice.id == invoice_id, OrganizationInvoice.org_id == org.id).with_for_update())
    if not row: raise HTTPException(404, 'Invoice not found')
    return row

@router.get('/organizations')
async def context(user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    rows, default = await organizations(user,db)
    return {'organizations':[dict(id=r.id,name=r.name,currency=r.currency) for r in rows],'default_org_id':default}

@router.get('')
async def list_invoices(response:Response,org_id:str|None=None,user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    org=await scope(org_id,user,db)
    response.headers['Cache-Control']='private, no-store'
    rows=(await db.scalars(select(OrganizationInvoice).options(defer(OrganizationInvoice.pdf_bytes)).where(OrganizationInvoice.org_id==org.id).order_by(OrganizationInvoice.created_at.desc()).limit(200))).all()
    return [output(r) for r in rows]

@router.post('',status_code=201)
async def create(data:Input,org_id:str|None=None,user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    org=await scope(org_id,user,db)
    row=OrganizationInvoice(org_id=org.id,reference='INV-'+str(date.today().year)+'-'+uuid.uuid4().hex[:10].upper(),payload=validated(data.payload,org),created_by=user.id)
    db.add(row);await db.commit();await db.refresh(row);return output(row)

@router.get('/{invoice_id}')
async def get(invoice_id:str,response:Response,org_id:str|None=None,user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    org=await scope(org_id,user,db);response.headers['Cache-Control']='private, no-store';return output(await find(invoice_id,org,db))

@router.put('/{invoice_id}')
async def update(invoice_id:str,data:Input,org_id:str|None=None,user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    org=await scope(org_id,user,db);row=await find(invoice_id,org,db)
    if row.status!='draft':raise HTTPException(409,'Issued or archived invoices cannot be edited')
    if row.version!=data.version:raise HTTPException(409,'Invoice changed. Reopen it before saving')
    row.payload=validated(data.payload,org);row.version+=1;row.updated_at=datetime.utcnow();await db.commit();await db.refresh(row);return output(row)

@router.post('/{invoice_id}/issue')
async def issue(invoice_id:str,version:int=Form(...),file:UploadFile=File(...),org_id:str|None=None,user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    org=await scope(org_id,user,db);row=await find(invoice_id,org,db)
    if row.status!='draft' or row.version!=version:raise HTTPException(409,'Invoice changed or has already been issued. Reopen it')
    payload=validated(row.payload,org,issuing=True)
    data=await file.read(5*1024*1024+1)
    if file.content_type!='application/pdf' or len(data)>5*1024*1024 or not data.startswith(b'%PDF-') or b'%%EOF' not in data[-1024:]:raise HTTPException(400,'Choose a valid PDF up to 5 MB')
    row.payload=payload;row.has_pdf=True;row.pdf_bytes=data;row.filename=row.reference+'.pdf';row.status='issued';row.version+=1;row.issued_at=datetime.utcnow();row.updated_at=row.issued_at
    await db.commit();await db.refresh(row);return output(row)

@router.get('/{invoice_id}/download')
async def download(invoice_id:str,org_id:str|None=None,user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    org=await scope(org_id,user,db);row=await find(invoice_id,org,db)
    if not row.pdf_bytes:raise HTTPException(409,'Issue this invoice to save its final PDF')
    return Response(row.pdf_bytes,media_type='application/pdf',headers={'Cache-Control':'private, no-store','Content-Disposition':'attachment; filename="'+row.filename.replace('"','')+'"','X-Content-Type-Options':'nosniff'})

@router.delete('/{invoice_id}',status_code=204)
async def remove(invoice_id:str,version:int,org_id:str|None=None,user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    org=await scope(org_id,user,db);row=await find(invoice_id,org,db)
    if row.status!='draft' or row.version!=version:raise HTTPException(409,'Only unchanged drafts can be deleted')
    await db.delete(row);await db.commit();return Response(status_code=204)
