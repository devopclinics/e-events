"""Explicit, idempotent import of reviewed invoices into their issuer's organization."""
import json
from datetime import datetime
from sqlalchemy import select
from ..models import OrganizationInvoice
from ..routers.invoice_library import FILES, catalog
from ..routers.organization_invoices import validated

async def import_archive(db,org,user):
    payloads=json.loads((FILES/'organization-payloads.json').read_text())
    result=[]
    for item in catalog():
        existing=await db.scalar(select(OrganizationInvoice).where(OrganizationInvoice.reference==item['reference']))
        if existing:
            if existing.org_id!=org.id:raise ValueError('Invoice already belongs to another organization')
            result.append({'id':existing.id,'reference':existing.reference,'existing':True});continue
        issued=item.get('issued_date')
        row=OrganizationInvoice(id=item['id'],org_id=org.id,reference=item['reference'],payload=validated(payloads[item['id']],org),status=item['status'].lower(),version=1,has_pdf=True,pdf_bytes=(FILES/item['filename']).read_bytes(),filename=item['filename'],created_by=user.id,created_at=datetime.fromisoformat(item['prepared']+'T00:00:00'),issued_at=datetime.fromisoformat(issued+'T00:00:00') if issued else None)
        db.add(row);result.append({'id':row.id,'reference':row.reference,'existing':False})
    await db.commit();return result
