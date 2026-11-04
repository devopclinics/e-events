"""Organization-scoped reusable uploads, selected through an authorized event."""
import asyncio
import html as html_module
import hashlib
import io
import uuid
import warnings
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from PIL import Image, ImageOps, UnidentifiedImageError
from ..auth import get_current_user, require_superadmin
from ..database import get_db
from ..models import Event, Membership, Organization, OrganizationMediaAsset, User, EmailDeliveryEvent, CommercialDocument
from ..ratelimit import rate_limit
from services.email_service import send_simple_email
from services.outbound_safety import recipient_allowed
from .. import storage

router = APIRouter()
MAX_FILE = 20 * 1024 * 1024
TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}

class MediaTitle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=255)

async def media_org(event_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    event = await db.get(Event, event_id)
    org = await db.get(Organization, event.org_id) if event else None
    if not org or (not org.is_active and not user.is_platform_superadmin):
        raise HTTPException(404, "Event not found")
    if not user.is_platform_superadmin:
        role = await db.scalar(select(Membership.role).where(Membership.org_id == org.id, Membership.user_id == user.id))
        if role not in ("owner", "admin"):
            raise HTTPException(403, "Organization owner or admin access is required for shared media")
    return org

def output(asset):
    return {key: getattr(asset, key) for key in ("id", "org_id", "title", "filename", "url", "content_type", "byte_size", "width", "height", "created_at")}

def validate_file(data, content_type):
    if content_type not in TYPES:
        raise HTTPException(400, "Choose a JPG, PNG, WebP image or PDF file")
    if not data or len(data) > MAX_FILE:
        raise HTTPException(400, "Choose a file up to 20 MB")
    if content_type == "application/pdf":
        if not data.startswith(b"%PDF-"):
            raise HTTPException(400, "The file is not a valid PDF")
        return data, None, None
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Images must be 5 MB or smaller")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format != {"image/jpeg":"JPEG", "image/png":"PNG", "image/webp":"WEBP"}[content_type]:
                    raise ValueError("Image type mismatch")
                if image.width * image.height > 25_000_000:
                    raise ValueError("Image exceeds 25 megapixels")
                image.load()
                image_format = image.format
                normalized = ImageOps.exif_transpose(image)
                clean = io.BytesIO()
                normalized.save(clean, format=image_format)
                if clean.tell() > 5 * 1024 * 1024:
                    raise ValueError("Processed image is too large")
                return clean.getvalue(), normalized.width, normalized.height
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise HTTPException(400, "Choose a valid image up to 25 megapixels")

@router.get("/{event_id}/media-library")
async def list_media(org=Depends(media_org), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(OrganizationMediaAsset).where(OrganizationMediaAsset.org_id == org.id, OrganizationMediaAsset.archived.is_(False)).order_by(OrganizationMediaAsset.created_at.desc()).limit(500))).scalars().all()
    return {"organization": {"id": org.id, "name": org.name}, "assets": [output(row) for row in rows]}

@router.post("/{event_id}/media-library", status_code=201)
async def upload_media(file: UploadFile = File(...), org=Depends(media_org), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    content_type = (file.content_type or "").lower()
    data, width, height = await asyncio.to_thread(validate_file, await file.read(MAX_FILE + 1), content_type)
    await db.scalar(select(Organization).where(Organization.id == org.id).with_for_update())
    digest = hashlib.sha256(data).hexdigest()
    existing = await db.scalar(select(OrganizationMediaAsset).where(OrganizationMediaAsset.org_id == org.id, OrganizationMediaAsset.sha256 == digest, OrganizationMediaAsset.archived.is_(False)).limit(1))
    if existing:
        return output(existing)
    size = await db.scalar(select(func.coalesce(func.sum(OrganizationMediaAsset.byte_size), 0)).where(OrganizationMediaAsset.org_id == org.id))
    count = await db.scalar(select(func.count()).select_from(OrganizationMediaAsset).where(OrganizationMediaAsset.org_id == org.id))
    if size + len(data) > 500 * 1024 * 1024 or count >= 500:
        raise HTTPException(400, "This organization’s shared media library has reached its storage limit")
    aid = str(uuid.uuid4())
    filename = (file.filename or f"file.{TYPES[content_type]}").replace('\\', '/').split('/')[-1][:255]
    path = f"shared-media/{org.id}/{aid}.{TYPES[content_type]}"
    url = await asyncio.to_thread(storage.save, path, data, content_type)
    asset = OrganizationMediaAsset(id=aid, org_id=org.id, title=filename, filename=filename, url=url, content_type=content_type, byte_size=len(data), sha256=digest, width=width, height=height, uploaded_by=user.id)
    db.add(asset)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        await asyncio.to_thread(storage.delete, path)
        raise
    await db.refresh(asset)
    return output(asset)

async def find_asset(asset_id, org, db):
    asset = await db.get(OrganizationMediaAsset, asset_id)
    if not asset or asset.org_id != org.id or asset.archived:
        raise HTTPException(404, "Media file not found")
    return asset

@router.patch("/{event_id}/media-library/{asset_id}")
async def rename_media(asset_id: str, data: MediaTitle, org=Depends(media_org), db: AsyncSession = Depends(get_db)):
    asset = await find_asset(asset_id, org, db)
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "Enter a file name")
    asset.title = title
    await db.commit()
    return output(asset)

@router.delete("/{event_id}/media-library/{asset_id}")
async def archive_media(asset_id: str, org=Depends(media_org), db: AsyncSession = Depends(get_db)):
    asset = await find_asset(asset_id, org, db)
    asset.archived = True
    await db.commit()
    return {"ok": True, "existing_links_preserved": True}

# Proposal documents are operator-reviewed sales material, not guest invitations.
@router.post('/proposals/email', dependencies=[Depends(rate_limit(limit=20, window=60, scope='proposal-email'))])
async def email_proposal(
    file: UploadFile = File(...),
    recipient: EmailStr = Form(...),
    subject: str = Form(..., min_length=1, max_length=180),
    message: str = Form('', max_length=3000),
    request_id: str = Form(...),
    confirmed: bool = Form(False),
    document_id: str | None = Form(None),
    event_id: str | None = Form(None),
    user: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    invoice = None
    if document_id:
        invoice = await db.get(CommercialDocument, document_id)
        if not invoice or invoice.kind != 'invoice': raise HTTPException(404,'Invoice not found.')
        if invoice.status == 'draft': raise HTTPException(400,'Issue the invoice before emailing it.')
    document_kind = 'invoice' if invoice else 'proposal'
    if not confirmed: raise HTTPException(400,'Review the recipient and proposal before confirming the send.')
    if '\r' in subject or '\n' in subject: raise HTTPException(400,'Use a single-line email subject.')
    try: uuid.UUID(request_id)
    except (ValueError,TypeError): raise HTTPException(400,'Invalid send reference.')
    recipient = str(recipient).lower()
    if not recipient_allowed('email',recipient): raise HTTPException(403,'This recipient is blocked by the environment email safety policy.')
    if event_id and not await db.get(Event,event_id): raise HTTPException(404,'Event not found')
    content = await file.read(5*1024*1024+1)
    if len(content)>5*1024*1024: raise HTTPException(413,'Choose a proposal PDF up to 5 MB.')
    if file.content_type!='application/pdf' or not content.startswith(b'%PDF-') or b'%%EOF' not in content[-1024:]:
        raise HTTPException(400,'Attach a valid proposal PDF.')
    digest=hashlib.sha256(content+recipient.encode()+subject.encode()+message.encode()+str(event_id).encode()+str(document_id).encode()).hexdigest()
    key='proposal:'+hashlib.sha256((str(user.id)+request_id).encode()).hexdigest()
    existing=await db.scalar(select(EmailDeliveryEvent).where(EmailDeliveryEvent.provider_event_id==key))
    if existing:
        if (existing.tags or {}).get('request_digest')!=digest: raise HTTPException(409,'This send reference belongs to a different proposal or recipient. Start a new reviewed email.')
        return {'status':existing.status,'request_id':request_id,'duplicate_prevented':True,'note':'Existing send status returned. No additional email was submitted.'}
    row=EmailDeliveryEvent(provider='internal',provider_event_id=key,event_id=event_id,recipient=recipient,subject=subject,message_kind='client_'+document_kind,event_type='proposal.requested',status='sending',tags={'request_digest':digest,'actor_user_id':str(user.id),'request_id':request_id})
    db.add(row)
    try: await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409,'This proposal send is already being processed. Check its status before sending again.')
    body='<p>'+html_module.escape(message or ('Please find your Festio invoice attached.' if invoice else 'Thank you for considering Festio. Please find your event proposal attached.')).replace('\n','<br>')+'</p><p>The attached PDF contains the reviewed event scope, quotation and payment terms.</p>'
    try:
        accepted=await send_simple_email(recipient,subject,body,attachments=[((invoice.reference+'.pdf') if invoice else 'Festio-Event-Proposal.pdf',content,'application/pdf')],event_id=event_id,message_kind='client_'+document_kind)
        row.status='accepted' if accepted else 'unconfirmed'
    except Exception:
        row.status='unconfirmed'
    if invoice and row.status=='accepted':
        invoice=await db.scalar(select(CommercialDocument).where(CommercialDocument.id==document_id).with_for_update().execution_options(populate_existing=True))
        if invoice.status=='issued':
            invoice.status='sent'
            invoice.version+=1
    row.event_type=document_kind+'.'+row.status
    await db.commit()
    return {'status':row.status,'request_id':request_id,'duplicate_prevented':False,'note':'Email accepted for sending. Delivery is not yet confirmed.' if row.status=='accepted' else 'Provider acceptance could not be confirmed. Check delivery history before starting another send to avoid duplicates.'}
