"""Private Bird support adapter. No guest mutations and no automated replies."""
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import SupportConversation, SupportMessage

log = logging.getLogger(__name__)
BASE = 'https://api.bird.com'


def phone(value):
    digits = re.sub(r'\D', '', str(value or ''))
    return '+' + digits if 7 <= len(digits) <= 15 else None


def timestamp(value):
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).astimezone(timezone.utc).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def verify_signature(raw, headers):
    """Legacy Channels JWT and current Standard Webhooks; fail closed."""
    key = settings.support_whatsapp_signing_key
    url = settings.support_whatsapp_webhook_url
    if not key or not url:
        raise HTTPException(503, 'Support webhook is not configured')
    def check(condition):
        if not condition: raise ValueError('Invalid signature')
    try:
        token = headers.get('messagebird-signature-jwt')
        if token:
            a, b, sig = token.split('.')
            decode = lambda v: base64.urlsafe_b64decode(v + '=' * (-len(v) % 4))
            check(json.loads(decode(a)).get('alg') == 'HS256')
            check(hmac.compare_digest(hmac.new(key.encode(), (a+'.'+b).encode(), hashlib.sha256).digest(), decode(sig)))
            claims = json.loads(decode(b)); now = time.time()
            check(claims.get('iss') == 'MessageBird' and claims.get('jti'))
            check(abs(now - float(claims['iat'])) <= 300 and float(claims['exp']) > now)
            check(hmac.compare_digest(claims['url_hash'], hashlib.sha256(url.encode()).hexdigest()))
            check(hmac.compare_digest(claims['payload_hash'], hashlib.sha256(raw).hexdigest()))
        elif headers.get('messagebird-signature'):
            # Legacy MessageBird SDK RequestValidator::buildPayloadFromRequest:
            # timestamp + newline + sorted query + newline + binary SHA256(body).
            # This receiver's configured URL has no query string.
            stamp = headers['messagebird-request-timestamp']
            if abs(time.time()-int(stamp))>300:log.warning('Support webhook retry outside freshness window: age_seconds=%s',round(time.time()-int(stamp)))
            check(abs(time.time()-int(stamp))<=300)
            signed = stamp.encode()+b'\n\n'+hashlib.sha256(raw).digest()
            expected=base64.b64encode(hmac.new(key.encode(),signed,hashlib.sha256).digest()).decode()
            if not hmac.compare_digest(expected,headers['messagebird-signature']):
                # Channels has a different signing envelope from the retired
                # SDK. Diagnose matching envelopes without logging signatures,
                # keys, request bodies, phone numbers or message text.
                matches=[]
                for label,prefix in [('url',stamp+url),('url-lines',stamp+'\n'+url+'\n'),('sdk',stamp+'\n\n')]:
                    for encoding,body_hash in [('binary',hashlib.sha256(raw).digest()),('hex',hashlib.sha256(raw).hexdigest().encode())]:
                        candidate=base64.b64encode(hmac.new(key.encode(),prefix.encode()+body_hash,hashlib.sha256).digest()).decode()
                        if hmac.compare_digest(candidate,headers['messagebird-signature']):matches.append(label+'-'+encoding)
                log.warning('Support legacy signature envelope match=%s age_seconds=%s',matches,round(time.time()-int(stamp)))
            check(hmac.compare_digest(expected,headers['messagebird-signature']))
        else:
            stamp = headers['webhook-timestamp']; ident = headers['webhook-id']
            check(abs(time.time() - int(stamp)) <= 300 and ident)
            secret = base64.b64decode(key.removeprefix('whsec_'))
            signed = ident.encode()+b'.'+stamp.encode()+b'.'+raw
            expected = base64.b64encode(hmac.new(secret, signed, hashlib.sha256).digest()).decode()
            check(any(hmac.compare_digest(v, 'v1,'+expected) for v in headers.get('webhook-signature', '').split()))
    except (AssertionError, ValueError, KeyError, TypeError):
        log.warning('Support webhook signature rejected (JWT=%s, legacy=%s, standard=%s)',bool(headers.get('messagebird-signature-jwt')),bool(headers.get('messagebird-signature')),bool(headers.get('webhook-signature')))
        raise HTTPException(401, 'Invalid support webhook signature')


async def bird(method, path, **kwargs):
    if not settings.bird_access_key or not settings.bird_workspace_id or not settings.bird_whatsapp_channel_id:
        raise HTTPException(503, 'Bird WhatsApp is not configured')
    async with httpx.AsyncClient(timeout=15) as client:
        return await client.request(method, BASE+'/workspaces/'+settings.bird_workspace_id+path,
                                    headers={'Authorization': 'AccessKey '+settings.bird_access_key}, **kwargs)


def channel_path():
    return '/channels/'+settings.bird_whatsapp_channel_id+'/messages'


def normalize(message):
    if message.get('direction') != 'incoming':
        return None
    if message.get('channelId') != settings.bird_whatsapp_channel_id:
        return None
    try:
        ident = str(UUID(message['id']))
    except (ValueError, KeyError, TypeError):
        return None
    contact = message.get('sender', {}).get('contact', {})
    if contact.get('identifierKey') not in (None, 'phonenumber'):
        return None
    number = phone(contact.get('identifierValue'))
    when = timestamp(message.get('createdAt'))
    if not number or not when or when > datetime.utcnow()+timedelta(minutes=5):
        return None
    body = message.get('body') or {}; kind = body.get('type', 'unknown')
    content = body.get(kind) or {}
    value = content.get('text') if isinstance(content, dict) else None
    if not isinstance(value, str):
        value = '['+str(kind)[:30]+' message — view attachment in Bird]'
    return dict(provider_id=ident, phone=number, name=str(contact.get('displayName') or (contact.get('annotations') or {}).get('name') or '')[:255],
                body=value[:10000], kind=str(kind)[:30], occurred_at=when,
                status=str(message.get('status') or 'received')[:40])


async def ingest(db, message):
    if message.get('direction')=='outgoing' and message.get('channelId')==settings.bird_whatsapp_channel_id:
        reference=str(message.get('reference') or '')
        if reference.startswith('festio-support:'):
            stored=await db.get(SupportMessage,reference.removeprefix('festio-support:'))
            if stored and stored.direction=='outgoing':
                stored.provider_id=message.get('id') or stored.provider_id
                stored.status=str(message.get('status') or stored.status)[:40]
                stored.error=str(message.get('reason') or 'Bird reported delivery failure')[:300] if 'fail' in stored.status else None
        return False
    data = normalize(message)
    if not data:
        return False
    if await db.scalar(select(SupportMessage.id).where(SupportMessage.provider_id==data['provider_id'])):
        return False
    # SAVEPOINT makes parallel webhook/history ingestion idempotent without
    # rolling back messages already imported in this batch.
    try:
        async with db.begin_nested():
            thread = await db.scalar(select(SupportConversation).where(
                SupportConversation.channel_id==settings.bird_whatsapp_channel_id,
                SupportConversation.phone==data['phone']).with_for_update())
            if not thread:
                thread = SupportConversation(channel_id=settings.bird_whatsapp_channel_id, phone=data['phone'], name=data['name'],
                                             last_message_at=data['occurred_at'])
                db.add(thread); await db.flush()
            newer = not thread.last_incoming_at or data['occurred_at'] > thread.last_incoming_at
            if newer:
                thread.last_incoming_at = data['occurred_at']; thread.status = 'open'
            thread.last_message_at = max(thread.last_message_at, data['occurred_at'])
            if data['name'] and not thread.name: thread.name=data['name']
            db.add(SupportMessage(conversation_id=thread.id, direction='incoming', provider_id=data['provider_id'],
                                  body=data['body'], kind=data['kind'], status=data['status'], occurred_at=data['occurred_at']))
            await db.flush()
        return True
    except IntegrityError:
        # A parallel first-message insert may have created the conversation.
        # Retry once after the winning transaction becomes visible.
        if await db.scalar(select(SupportMessage.id).where(SupportMessage.provider_id==data['provider_id'])):
            return False
        thread = await db.scalar(select(SupportConversation).where(SupportConversation.channel_id==settings.bird_whatsapp_channel_id, SupportConversation.phone==data['phone']))
        if not thread: raise
        return await ingest(db, message)


async def sync_history(db, page_token=None, pages=1):
    count=0; cursor=page_token
    for _ in range(pages):
        params={'limit':100}
        if cursor: params['pageToken']=cursor
        response=await bird('GET',channel_path(),params=params)
        if response.status_code!=200: raise HTTPException(502, 'Could not read Bird history. Try again later.')
        payload=response.json()
        for message in reversed(payload.get('results', [])):
            count += int(await ingest(db, message))
        cursor=payload.get('nextPageToken')
        if not cursor: break
    await db.commit()
    return {'imported':count,'next_page_token':cursor}


async def run():
    while True:
        try:
            async with AsyncSessionLocal() as db:
                if db.bind.dialect.name=='postgresql':
                    locked=await db.scalar(text('SELECT pg_try_advisory_xact_lock(719462035)'))
                    if not locked:
                        await asyncio.sleep(30); continue
                await sync_history(db)
                pending = (await db.scalars(select(SupportMessage).where(
                    SupportMessage.direction=='outgoing',SupportMessage.provider_id.is_not(None),
                    SupportMessage.status.in_(['accepted','queued','sent','submitting','pending','processing','sending'])
                ).order_by(SupportMessage.occurred_at).limit(20))).all()
                for message in pending:
                    response=await bird('GET',channel_path()+'/'+message.provider_id)
                    if response.status_code==200:
                        data=response.json();message.status=str(data.get('status') or message.status)[:40]
                        if 'fail' in message.status:message.error=str(data.get('reason') or 'Bird reported delivery failure')[:300]
                await db.commit()
        except Exception:
            log.warning('WhatsApp support history refresh failed',exc_info=False)
        await asyncio.sleep(30)
