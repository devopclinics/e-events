"""Private, versioned proposal drafts and immutable issued invoice snapshots."""
import json
import uuid
from datetime import datetime, date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth import require_superadmin
from ..database import get_db
from ..models import CommercialDocument, User

router = APIRouter(dependencies=[Depends(require_superadmin)])

class DocumentInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['proposal', 'invoice']
    payload: dict
    source_id: str | None = None
    version: int = Field(default=1, ge=1)

class VersionInput(BaseModel):
    version: int = Field(ge=1)

class PaymentInput(VersionInput):
    paid_minor: int = Field(ge=0)

def minor(value):
    try:
        number = Decimal(str(value))
        if not number.is_finite() or number < 0 or number > 1_000_000_000 or number * 100 != (number * 100).to_integral_value():
            raise ValueError()
        return int(number * 100)
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(400, 'Use non-negative amounts with at most two decimal places.')

def validate_payload(kind, payload, issuing=False):
    if len(json.dumps(payload).encode()) > 4_000_000:
        raise HTTPException(413, 'Document is too large. Use a smaller logo.')
    if kind == 'proposal':
        return
    if payload.get('currency') not in ('NGN','USD','GBP','EUR'):
        raise HTTPException(400, 'Choose a supported currency.')
    for key, limit in [('client',120),('title',140),('bank',120),('accountName',150),('accountNumber',60),('exclusions',850)]:
        if not isinstance(payload.get(key,''), str) or len(payload.get(key,'')) > limit:
            raise HTTPException(400, 'Check the document text lengths.')
    try:
        date.fromisoformat(payload['date'])
        date.fromisoformat(payload['issuedDate'])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(400, 'Choose valid event and invoice dates.')
    fees = payload.get('fees')
    if not isinstance(fees, list) or not 1 <= len(fees) <= 8:
        raise HTTPException(400, 'Include one to eight service rows.')
    total = 0
    for row in fees:
        if not isinstance(row, dict) or not isinstance(row.get('label'),str) or not row['label'].strip() or len(row['label']) > 140 or not isinstance(row.get('complimentary'),bool):
            raise HTTPException(400, 'Check service labels and complimentary selections.')
        amount = minor(row.get('amount'))
        if not row['complimentary']:
            total += amount
    discount = minor(payload.get('discount',0))
    if discount > total:
        raise HTTPException(400, 'The discount cannot exceed chargeable services.')
    deposit = payload.get('deposit')
    days = payload.get('balanceDays',7)
    if not isinstance(deposit,int) or isinstance(deposit,bool) or not 0 <= deposit <= 100 or not isinstance(days,int) or isinstance(days,bool) or not 0 <= days <= 365:
        raise HTTPException(400, 'Check deposit percentage and balance due days.')
    if issuing and (not all(payload.get(k,'').strip() for k in ['client','title','bank','accountName','accountNumber']) or total-discount <= 0):
        raise HTTPException(400, 'Add the client, event title, bank details and a positive total before issuing.')
    payload['total_minor'] = total - discount
    payload['deposit_minor'] = int((Decimal(total-discount)*deposit/100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))

def output(row):
    return {k:getattr(row,k) for k in ['id','kind','reference','source_id','payload','status','version','paid_minor','payment_history','created_at','issued_at']}

async def find(document_id, db):
    row = await db.scalar(select(CommercialDocument).where(CommercialDocument.id==document_id).with_for_update())
    if not row:
        raise HTTPException(404, 'Document not found.')
    return row

@router.get('')
async def list_documents(db: AsyncSession=Depends(get_db)):
    rows = (await db.scalars(select(CommercialDocument).order_by(CommercialDocument.created_at.desc()).limit(200))).all()
    result=[]
    for row in rows:
        item=output(row)
        item['payload']={k:row.payload.get(k,'') for k in ['client','title','currency','total_minor','bank','accountName','accountNumber']}
        item.pop('payment_history',None)
        result.append(item)
    return result

@router.get('/{document_id}')
async def get_document(document_id:str,db:AsyncSession=Depends(get_db)):
    row=await db.get(CommercialDocument,document_id)
    if not row: raise HTTPException(404,'Document not found.')
    return output(row)

@router.post('', status_code=201)
async def create_document(data:DocumentInput, db:AsyncSession=Depends(get_db), user:User=Depends(require_superadmin)):
    validate_payload(data.kind,data.payload)
    if data.source_id:
        source=await db.get(CommercialDocument,data.source_id)
        if not source or source.kind!='proposal' or data.kind!='invoice':
            raise HTTPException(400,'Choose a saved proposal as the source.')
    row=CommercialDocument(kind=data.kind,reference=('INV' if data.kind=='invoice' else 'PROP')+'-'+str(datetime.utcnow().year)+'-'+uuid.uuid4().hex[:12].upper(),source_id=data.source_id,payload=data.payload,created_by=user.id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return output(row)

@router.put('/{document_id}')
async def update_document(document_id:str,data:DocumentInput,db:AsyncSession=Depends(get_db)):
    row=await find(document_id,db)
    if row.status!='draft' or row.version!=data.version or row.kind!=data.kind or row.source_id!=data.source_id:
        raise HTTPException(409,'This document changed or is already issued. Reopen it before continuing.')
    validate_payload(row.kind,data.payload)
    row.payload=data.payload
    row.version+=1
    await db.commit()
    return output(row)

@router.post('/{document_id}/issue')
async def issue_document(document_id:str,data:VersionInput,db:AsyncSession=Depends(get_db)):
    row=await find(document_id,db)
    if row.kind!='invoice' or row.status!='draft' or row.version!=data.version:
        raise HTTPException(409,'Only the current invoice draft can be issued.')
    payload=dict(row.payload)
    validate_payload('invoice',payload,issuing=True)
    row.payload=payload
    row.status='issued'
    row.issued_at=datetime.utcnow()
    row.version+=1
    await db.commit()
    return output(row)

@router.post('/{document_id}/payment')
async def record_payment(document_id:str,data:PaymentInput,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    row=await find(document_id,db)
    if row.kind!='invoice' or row.status=='draft' or row.version!=data.version:
        raise HTTPException(409,'Reopen the issued invoice before recording payment.')
    if data.paid_minor > row.payload['total_minor']:
        raise HTTPException(400,'Payment cannot exceed the invoice total.')
    row.payment_history=[*(row.payment_history or []),{'at':datetime.utcnow().isoformat()+'Z','actor_id':user.id,'previous_minor':row.paid_minor,'paid_minor':data.paid_minor}]
    row.paid_minor=data.paid_minor
    row.status='paid' if data.paid_minor==row.payload['total_minor'] else 'part-paid' if data.paid_minor else 'issued'
    row.version+=1
    await db.commit()
    return output(row)
