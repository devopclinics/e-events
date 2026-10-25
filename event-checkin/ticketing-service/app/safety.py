"""Public checkout controls and explicit organizer-only order projections."""
import hashlib,ipaddress,math
from collections import OrderedDict
from time import monotonic
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


def client_network(request: Request):
    address=request.client.host if request.client else 'unknown'
    networks=[ipaddress.ip_network(item.strip()) for item in settings.trusted_proxy_cidrs.split(',') if item.strip()]
    cloudflare=[ipaddress.ip_network(item.strip()) for item in settings.cloudflare_proxy_cidrs.split(',') if item.strip()]
    def belongs(value,ranges):
        try:return any(ipaddress.ip_address(value) in network for network in ranges)
        except ValueError:return False
    if belongs(address,networks):
        # Only the private tunnel-origin listener may supply this header. The
        # public proxy path strips it, using the physical peer rather than XFF.
        tunnel=request.headers.get('x-festio-tunnel-client-ip','')
        if tunnel:
            try:return {'client_ip':str(ipaddress.ip_address(tunnel)),'source':'cloudflare_tunnel'}
            except ValueError:pass
        chain=[value.strip() for value in request.headers.get('x-forwarded-for','').split(',') if value.strip()]+[address]
        for item in reversed(chain):
            if belongs(item,networks):continue
            try:item=str(ipaddress.ip_address(item))
            except ValueError:continue
            if belongs(item,cloudflare):
                try:
                    visitor=str(ipaddress.ip_address(request.headers.get('cf-connecting-ip','')))
                    return {'client_ip':visitor,'source':'cloudflare'}
                except ValueError:pass
            return {'client_ip':item,'source':'forwarded'}
    return {'client_ip':address,'source':'direct'}


def peer_address(request: Request):
    return client_network(request)['client_ip']


_denied = OrderedDict()


def _deny_key(scope,key):
    return hashlib.sha256((scope+'|'+key).encode()).hexdigest()


def _cached_denial(scope,key):
    digest=_deny_key(scope,key)
    expires=_denied.get(digest)
    if expires is None:return
    remaining=math.ceil(expires-monotonic())
    if remaining<=0:
        _denied.pop(digest,None);return
    _denied.move_to_end(digest)
    raise HTTPException(429,'Too many checkout attempts. Try again shortly.',headers={'Retry-After':str(remaining)})


async def _limited_bucket(db,scope,key,limit,seconds):
    _cached_denial(scope,key)
    try:await take_bucket(db,scope,key,limit,seconds)
    except HTTPException as exc:
        if exc.status_code==429:
            digest=_deny_key(scope,key)
            _denied[digest]=monotonic()+int(exc.headers['Retry-After'])
            _denied.move_to_end(digest)
            while len(_denied)>10000:_denied.popitem(last=False)
        raise


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
    if row.count>=limit:raise HTTPException(429,'Too many checkout attempts. Try again shortly.',headers={'Retry-After':str(max(1,math.ceil((start+timedelta(seconds=seconds)-now).total_seconds())))})
    row.count+=1
    await db.commit()


async def checkout_limits(db,event_id,email,peer):
    normalized=email.strip().lower()
    # Cheap, bounded per-worker denial cache shields the database once a shared
    # limit is reached; the database remains authoritative across replicas.
    _cached_denial('checkout-ip:'+event_id,peer)
    _cached_denial('checkout-email:'+event_id,normalized)
    await _limited_bucket(db,'checkout-ip:'+event_id,peer,settings.checkout_ip_per_minute,60)
    await _limited_bucket(db,'checkout-email:'+event_id,normalized,settings.checkout_email_per_hour,3600)


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
