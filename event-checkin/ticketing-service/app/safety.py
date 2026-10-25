"""Public checkout controls and explicit organizer-only order projections."""
import hashlib,ipaddress
from datetime import datetime,timedelta
from time import time
from fastapi import HTTPException,Request
from sqlalchemy import select,delete
from sqlalchemy.exc import IntegrityError
from .config import settings
from .models import CheckoutRateBucket


def csv_safe(value):
    text=str(value if value is not None else '')
    return "'"+text if text.lstrip().startswith(('=','+','-','@')) else text


def payment_kind(order):
    return 'complimentary' if order.provider=='manual' else 'free' if order.total==0 else 'paid'


def order_view(order):
    fields=('id','event_id','buyer_name','buyer_email','currency','subtotal','discount','platform_fee','tax_amount','total',
            'status','provider','created_at','paid_at','fulfilled_at','delivery_status','delivery_attempts','delivery_queued_at',
            'email_delivery_status','email_delivered_at')
    result={key:getattr(order,key,None) for key in fields}
    kind=payment_kind(order)
    result.update(payment_kind=kind,provider_label={'free':'Free','complimentary':'Complimentary'}.get(kind,order.provider.title()))
    return result


def peer_address(request: Request):
    address=request.client.host if request.client else 'unknown'
    networks=[ipaddress.ip_network(item.strip()) for item in settings.trusted_proxy_cidrs.split(',') if item.strip()]
    def trusted(value):
        try:return any(ipaddress.ip_address(value) in network for network in networks)
        except ValueError:return False
    if trusted(address):
        chain=[value.strip() for value in request.headers.get('x-forwarded-for','').split(',') if value.strip()]+[address]
        for item in reversed(chain):
            if not trusted(item):return item
    return address


async def take_bucket(db,scope,key,limit,seconds):
    now=datetime.utcnow();start=datetime.utcfromtimestamp(int(time())//seconds*seconds)
    digest=hashlib.sha256((scope+'|'+key+'|'+start.isoformat()).encode()).hexdigest()
    # Savepoint handles two workers inserting a new bucket simultaneously.
    row=await db.scalar(select(CheckoutRateBucket).where(CheckoutRateBucket.id==digest).with_for_update())
    if not row:
        try:
            async with db.begin_nested():
                db.add(CheckoutRateBucket(id=digest,count=0,expires_at=start+timedelta(seconds=seconds*2)));await db.flush()
        except IntegrityError:pass
        row=await db.scalar(select(CheckoutRateBucket).where(CheckoutRateBucket.id==digest).with_for_update())
    if row.count>=limit:raise HTTPException(429,'Too many checkout attempts. Try again shortly.',headers={'Retry-After':str(seconds)})
    row.count+=1
    await db.commit()


async def checkout_limits(db,event_id,email,peer):
    await take_bucket(db,'checkout-ip:'+event_id,peer,settings.checkout_ip_per_minute,60)
    await take_bucket(db,'checkout-email:'+event_id,email.strip().lower(),settings.checkout_email_per_hour,3600)


async def clean_buckets(db):
    await db.execute(delete(CheckoutRateBucket).where(CheckoutRateBucket.expires_at<datetime.utcnow()))

async def lock_buyer(db,event_id,email):
    digest=hashlib.sha256(('pending-lock|'+event_id+'|'+email.strip().lower()).encode()).hexdigest()
    row=await db.scalar(select(CheckoutRateBucket).where(CheckoutRateBucket.id==digest).with_for_update())
    if row is None:
        try:
            async with db.begin_nested():
                db.add(CheckoutRateBucket(id=digest,count=0,expires_at=datetime.utcnow()+timedelta(days=2)));await db.flush()
        except IntegrityError:pass
        row=await db.scalar(select(CheckoutRateBucket).where(CheckoutRateBucket.id==digest).with_for_update())
    row.expires_at=datetime.utcnow()+timedelta(days=2)
