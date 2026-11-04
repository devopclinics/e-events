import base64,hashlib,hmac,json,time,uuid
from datetime import datetime,timedelta
import httpx,pytest
from sqlalchemy import select,func
from app.config import settings
from app.models import SupportConversation,SupportMessage,Guest
from app.services import support_whatsapp as service
from conftest import _Session

PREFIX='/api/platform/support/whatsapp'
CHANNEL='11111111-1111-4111-8111-111111111111'

def incoming(**changes):
    m={'id':str(uuid.uuid4()),'channelId':CHANNEL,'direction':'incoming','status':'delivered','createdAt':datetime.utcnow().isoformat()+'Z','sender':{'contact':{'identifierValue':'+18320000000','annotations':{'name':'Test customer'}}},'body':{'type':'text','text':{'text':'Can you help me find my pass?'}}};m.update(changes);return m

@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setattr(settings,'support_whatsapp_enabled',True)
    monkeypatch.setattr(settings,'bird_whatsapp_channel_id',CHANNEL)
    monkeypatch.setattr(settings,'support_whatsapp_signing_key','whsec_'+base64.b64encode(b'x'*32).decode())
    monkeypatch.setattr(settings,'support_whatsapp_webhook_url','https://staging.festio.events'+PREFIX+'/bird')
    monkeypatch.setattr(settings,'outbound_recipient_safety_enabled',False)

async def seed(m=None):
    async with _Session() as db:
        await service.ingest(db,m or incoming());await db.commit()
        return await db.scalar(select(SupportConversation.id))

@pytest.mark.asyncio
@pytest.mark.parametrize('method,path,body',[('GET','/conversations',None),('GET','/conversations/abc',None),('POST','/sync',{}),('POST','/conversations/abc/read',{}),('PATCH','/conversations/abc',{'status':'resolved'}),('POST','/conversations/abc/reply',{'body':'Hi','request_id':str(uuid.uuid4())})])
async def test_event_team_cannot_access(ctx,method,path,body):
    ctx.login(ctx.ids['user_a']);r=await ctx.client.request(method,PREFIX+path,json=body);assert r.status_code==403,r.text

@pytest.mark.asyncio
async def test_ingest_idempotent_history_and_read_state(ctx):
    m=incoming();ident=await seed(m)
    async with _Session() as db:
        assert not await service.ingest(db,m)
        assert await db.scalar(select(func.count()).select_from(SupportMessage))==1
    ctx.login(ctx.ids['superadmin'])
    r=await ctx.client.get(PREFIX+'/conversations');assert r.status_code==200,r.text
    assert r.json()['unread_count']==1
    data=(await ctx.client.get(PREFIX+'/conversations/'+ident)).json();assert data['messages'][0]['body']=='Can you help me find my pass?'
    assert data['name']=='Test customer'
    await ctx.client.post(PREFIX+'/conversations/'+ident+'/read',json={'through':data['read_through']})
    assert (await ctx.client.get(PREFIX+'/conversations')).json()['unread_count']==0
    await ctx.client.patch(PREFIX+'/conversations/'+ident,json={'status':'resolved'})
    async with _Session() as db:
        await service.ingest(db,incoming());await db.commit()
    r=(await ctx.client.get(PREFIX+'/conversations')).json();assert r['unread_count']==1 and r['items'][0]['status']=='open'

@pytest.mark.asyncio
async def test_import_does_not_create_or_confirm_guests(ctx):
    async with _Session() as db:before=await db.scalar(select(func.count()).select_from(Guest))
    await seed()
    async with _Session() as db:assert before==await db.scalar(select(func.count()).select_from(Guest))

@pytest.mark.asyncio
async def test_wrong_channel_outgoing_invalid_and_future_ignored(ctx):
    async with _Session() as db:
        for m in [incoming(channelId='other'),incoming(direction='outgoing'),incoming(createdAt='invalid'),incoming(createdAt=(datetime.utcnow()+timedelta(days=1)).isoformat()+'Z')]:assert not await service.ingest(db,m)
        assert await db.scalar(select(func.count()).select_from(SupportMessage))==0

@pytest.mark.asyncio
async def test_reply_once_and_reports_provider_acceptance(ctx,monkeypatch):
    ident=await seed();ctx.login(ctx.ids['superadmin']);sent=[]
    async def bird(method,path,**kwargs):sent.append(kwargs);return httpx.Response(202,json={'id':str(uuid.uuid4()),'status':'accepted'})
    monkeypatch.setattr(service,'bird',bird)
    payload={'body':'Hello, happy to help.','request_id':str(uuid.uuid4())}
    a=await ctx.client.post(PREFIX+'/conversations/'+ident+'/reply',json=payload);assert a.status_code==200,a.text
    b=await ctx.client.post(PREFIX+'/conversations/'+ident+'/reply',json=payload)
    assert len(sent)==1 and a.json()['id']==b.json()['id'] and a.json()['status']=='accepted'
    assert sent[0]['json']['body']['text']['text']==payload['body']
    payload['body']='Different text';assert (await ctx.client.post(PREFIX+'/conversations/'+ident+'/reply',json=payload)).status_code==409

@pytest.mark.asyncio
@pytest.mark.parametrize('blocked',['expired','guard'])
async def test_no_provider_call_for_closed_window_or_guard(ctx,monkeypatch,blocked):
    ident=await seed(incoming(createdAt=(datetime.utcnow()-timedelta(hours=25)).isoformat()+'Z') if blocked=='expired' else None)
    if blocked=='guard':monkeypatch.setattr(settings,'outbound_recipient_safety_enabled',True);monkeypatch.setattr(settings,'outbound_allowed_phones','')
    async def never(*a,**kw):raise AssertionError('must not send')
    monkeypatch.setattr(service,'bird',never);ctx.login(ctx.ids['superadmin'])
    r=await ctx.client.post(PREFIX+'/conversations/'+ident+'/reply',json={'body':'Hi','request_id':str(uuid.uuid4())});assert r.status_code==(409 if blocked=='expired' else 403)
    async with _Session() as db:assert await db.scalar(select(func.count()).select_from(SupportMessage).where(SupportMessage.direction=='outgoing'))==0

@pytest.mark.asyncio
async def test_uncertain_send_does_not_retry(ctx,monkeypatch):
    ident=await seed();calls=[]
    async def timeout(*a,**kw):calls.append(1);raise httpx.ReadTimeout('no response')
    monkeypatch.setattr(service,'bird',timeout);ctx.login(ctx.ids['superadmin']);body={'body':'Hi','request_id':str(uuid.uuid4())}
    for _ in range(2):
        r=await ctx.client.post(PREFIX+'/conversations/'+ident+'/reply',json=body);assert r.json()['status']=='unknown'
    assert len(calls)==1

@pytest.mark.asyncio
async def test_signed_webhook_fetches_canonical_message(ctx,monkeypatch):
    m=incoming();raw=json.dumps({'data':{'id':m['id'],'body':'untrusted'}}).encode();stamp=str(int(time.time()));event='evt_test'
    sig=base64.b64encode(hmac.new(b'x'*32,event.encode()+b'.'+stamp.encode()+b'.'+raw,hashlib.sha256).digest()).decode()
    calls=[]
    async def fetch(method,path,**kw):calls.append(path);return httpx.Response(200,json=m)
    monkeypatch.setattr(service,'bird',fetch)
    headers={'webhook-id':event,'webhook-timestamp':stamp,'webhook-signature':'v1,'+sig,'Content-Type':'application/json'}
    for _ in range(2):assert (await ctx.client.post(PREFIX+'/bird',content=raw,headers=headers)).status_code==204
    async with _Session() as db:
        rows=(await db.scalars(select(SupportMessage))).all();assert len(rows)==1 and rows[0].body!='untrusted'
    bad=await ctx.client.post(PREFIX+'/bird',content=raw+b' ',headers=headers);assert bad.status_code==401
    assert len(calls)==2

@pytest.mark.parametrize('change',['expired','forged','missing'])
def test_legacy_jwt_signatures(change):
    settings.support_whatsapp_signing_key='legacy-key';raw=b'{"test":1}'
    encode=lambda b:base64.urlsafe_b64encode(b).decode().rstrip('=')
    claims={'iss':'MessageBird','jti':'test','iat':int(time.time()),'exp':int(time.time())+300,'url_hash':hashlib.sha256(settings.support_whatsapp_webhook_url.encode()).hexdigest(),'payload_hash':hashlib.sha256(raw).hexdigest()}
    if change=='expired':claims['iat']-=1000;claims['exp']-=1000
    head=encode(b'{"alg":"HS256"}');body=encode(json.dumps(claims).encode());token=head+'.'+body+'.'+encode(hmac.new(b'legacy-key',(head+'.'+body).encode(),hashlib.sha256).digest())
    if change=='forged':token=token[:-8]+'aaaaaaaa'
    from fastapi import HTTPException
    with pytest.raises(HTTPException):service.verify_signature(raw,{} if change=='missing' else {'messagebird-signature-jwt':token})

def test_legacy_valid():
    settings.support_whatsapp_signing_key='legacy-key';raw=b'{}';enc=lambda b:base64.urlsafe_b64encode(b).decode().rstrip('=')
    claims={'iss':'MessageBird','jti':'ok','iat':int(time.time()),'exp':int(time.time())+30,'url_hash':hashlib.sha256(settings.support_whatsapp_webhook_url.encode()).hexdigest(),'payload_hash':hashlib.sha256(raw).hexdigest()}
    a=enc(b'{"alg":"HS256"}');b=enc(json.dumps(claims).encode());token=a+'.'+b+'.'+enc(hmac.new(b'legacy-key',(a+'.'+b).encode(),hashlib.sha256).digest())
    service.verify_signature(raw,{'messagebird-signature-jwt':token})

@pytest.mark.asyncio
async def test_outgoing_history_only_reconciles_existing_support_intents(ctx):
    ident=await seed()
    async with _Session() as db:
        m=SupportMessage(conversation_id=ident,direction='outgoing',body='Help reply',kind='text',status='unknown',occurred_at=datetime.utcnow())
        db.add(m);await db.commit();mid=m.id
        assert not await service.ingest(db,dict(id=str(uuid.uuid4()),channelId=CHANNEL,direction='outgoing',reference='unrelated-pass',body={'type':'text','text':{'text':'pass secret'}}))
        assert not await service.ingest(db,dict(id=str(uuid.uuid4()),channelId=CHANNEL,direction='outgoing',reference='festio-support:'+mid,status='delivered'))
        await db.commit();assert m.status=='delivered' and m.provider_id
        assert await db.scalar(select(func.count()).select_from(SupportMessage))==2

@pytest.mark.asyncio
async def test_history_import_paginates_and_is_repeatable(ctx,monkeypatch):
    one=incoming();two=incoming();calls=[]
    async def fetch(method,path,**kw):
        calls.append(kw['params'].get('pageToken'))
        return httpx.Response(200,json={'results':[two] if kw['params'].get('pageToken') else [one], 'nextPageToken':None if kw['params'].get('pageToken') else 'older'})
    monkeypatch.setattr(service,'bird',fetch);ctx.login(ctx.ids['superadmin'])
    a=await ctx.client.post(PREFIX+'/sync',json={});assert a.status_code==200,a.text
    b=await ctx.client.post(PREFIX+'/sync',json={});assert a.json()['imported']==2 and b.json()['imported']==0 and calls==[None,'older',None,'older']

def test_legacy_hmac_raw_body_and_timestamp():
    settings.support_whatsapp_signing_key='legacy-key';raw=b'{"body":"raw content"}';stamp=str(int(time.time()))
    signed=stamp.encode()+b'\n\n'+hashlib.sha256(raw).digest()
    signature=base64.b64encode(hmac.new(b'legacy-key',signed,hashlib.sha256).digest()).decode()
    headers={'messagebird-request-timestamp':stamp,'messagebird-signature':signature}
    service.verify_signature(raw,headers)
    from fastapi import HTTPException
    with pytest.raises(HTTPException):service.verify_signature(raw+b' ',headers)
