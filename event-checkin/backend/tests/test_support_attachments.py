import io,uuid
from datetime import datetime,timedelta
import httpx,pytest
from PIL import Image
from sqlalchemy import select,func
from app import storage
from app.config import settings
from app.models import SupportConversation,SupportMessage,SupportAttachment
from app.services import support_whatsapp as service
from conftest import _Session
from test_support_whatsapp import incoming,seed,CHANNEL
PREFIX='/api/platform/support/whatsapp'
PDF=b'%PDF-1.4\nQA attachment\n%%EOF'

@pytest.fixture(autouse=True)
def setup(monkeypatch,tmp_path):
 monkeypatch.setattr(settings,'support_whatsapp_enabled',True)
 monkeypatch.setattr(settings,'bird_whatsapp_channel_id',CHANNEL)
 monkeypatch.setattr(settings,'outbound_recipient_safety_enabled',False)
 monkeypatch.setattr(storage,'S3_BUCKET','')
 monkeypatch.setattr(storage,'UPLOADS_DIR',str(tmp_path))

async def upload(ctx,ident,content=PDF,name='proposal.pdf',mime='application/pdf'):
 return await ctx.client.post(PREFIX+'/conversations/'+ident+'/attachments',files={'file':(name,content,mime)})

@pytest.mark.asyncio
async def test_pdf_emoji_reply_private_download_and_retry(ctx,monkeypatch):
 ident=await seed();ctx.login(ctx.ids['superadmin']);sent=[]
 async def bird(method,path,**kw):sent.append(kw['json']);return httpx.Response(202,json={'id':str(uuid.uuid4()),'status':'accepted'})
 monkeypatch.setattr(service,'bird',bird)
 r=await upload(ctx,ident);assert r.status_code==201,r.text;asset=r.json();assert 'token' not in str(asset) and 'storage_path' not in asset
 body={'body':'Here is your proposal 🎉 😊','attachment_id':asset['id'],'request_id':str(uuid.uuid4())}
 for _ in range(2):
  r=await ctx.client.post(PREFIX+'/conversations/'+ident+'/reply',json=body);assert r.status_code==200,r.text
 assert len(sent)==1;assert sent[0]['body']['file']['text']==body['body'];url=sent[0]['body']['file']['files'][0]['mediaUrl'];message=r.json();assert message['attachments'][0]['filename']=='proposal.pdf'
 download=PREFIX+'/conversations/'+ident+'/messages/'+message['id']+'/attachments/0';r=await ctx.client.get(download);assert r.content==PDF
 assert (await ctx.client.get(url.replace('https://festio.events',''))).content==PDF
 async with _Session() as db:
  a=await db.get(SupportAttachment,asset['id']);a.created_at=datetime.utcnow()-timedelta(hours=25);await db.commit()
 assert (await ctx.client.get(url.replace('https://festio.events',''))).status_code==404
 ctx.login(ctx.ids['user_a']);assert (await ctx.client.get(download)).status_code==403
 assert (await upload(ctx,ident)).status_code==403

@pytest.mark.asyncio
async def test_upload_type_signature_size_and_window(ctx):
 ident=await seed();ctx.login(ctx.ids['superadmin'])
 for content,name,mime in [(b'<svg>','bad.svg','image/svg+xml'),(b'bad','bad.pdf','application/pdf'),(b'%PDF-'+b'x'*(20*1024*1024),'huge.pdf','application/pdf')]:
  assert (await upload(ctx,ident,content,name,mime)).status_code==400
 async with _Session() as db:
  c=await db.get(SupportConversation,ident);c.last_incoming_at=datetime.utcnow()-timedelta(hours=25);await db.commit()
 assert (await upload(ctx,ident)).status_code==409

@pytest.mark.asyncio
async def test_image_attachment_only_and_caption_validation(ctx,monkeypatch):
 ident=await seed();ctx.login(ctx.ids['superadmin']);buffer=io.BytesIO();Image.new('RGB',(3,3),'green').save(buffer,format='PNG');asset=(await upload(ctx,ident,buffer.getvalue(),'photo.png','image/png')).json();sent=[]
 async def bird(*a,**kw):sent.append(kw['json']);return httpx.Response(202,json={'id':str(uuid.uuid4()),'status':'accepted'})
 monkeypatch.setattr(service,'bird',bird)
 body={'body':'x'*1025,'attachment_id':asset['id'],'request_id':str(uuid.uuid4())};assert (await ctx.client.post(PREFIX+'/conversations/'+ident+'/reply',json=body)).status_code==422
 body['body']='';r=await ctx.client.post(PREFIX+'/conversations/'+ident+'/reply',json=body);assert r.status_code==200,r.text;assert sent[0]['body']['type']=='image';assert 'text' not in sent[0]['body']['image']
 body['attachment_id']=str(uuid.uuid4());assert (await ctx.client.post(PREFIX+'/conversations/'+ident+'/reply',json=body)).status_code==409

@pytest.mark.asyncio
async def test_attachment_scoped_to_conversation_and_actor(ctx,monkeypatch):
 ident=await seed();ctx.login(ctx.ids['superadmin']);asset=(await upload(ctx,ident)).json()
 async with _Session() as db:
  c=SupportConversation(phone='+18320000001',channel_id=CHANNEL,last_incoming_at=datetime.utcnow(),last_message_at=datetime.utcnow());db.add(c);await db.commit();other=c.id
 async def never(*a,**kw):raise AssertionError('No message may be sent')
 monkeypatch.setattr(service,'bird',never)
 r=await ctx.client.post(PREFIX+'/conversations/'+other+'/reply',json={'body':'Wrong thread','attachment_id':asset['id'],'request_id':str(uuid.uuid4())});assert r.status_code==404

@pytest.mark.asyncio
async def test_incoming_attachment_metadata_and_download(ctx,monkeypatch):
 m=incoming(body={'type':'file','file':{'text':'Invoice 📄','files':[{'mediaUrl':'https://media.api.bird.com/workspaces/ws/messages/file','filename':'invoice.pdf','contentType':'application/pdf'}]}});ident=await seed(m);ctx.login(ctx.ids['superadmin']);thread=(await ctx.client.get(PREFIX+'/conversations/'+ident)).json();msg=thread['messages'][0];assert msg['body']=='Invoice 📄' and msg['attachments'][0]['filename']=='invoice.pdf';assert 'url' not in msg['attachments'][0]
 async def fetch(url):assert url.startswith('https://media.api.bird.com/');return PDF
 monkeypatch.setattr(service,'fetch_media',fetch);r=await ctx.client.get(PREFIX+'/conversations/'+ident+'/messages/'+msg['id']+'/attachments/0');assert r.content==PDF

@pytest.mark.asyncio
@pytest.mark.parametrize('url',['http://media.api.bird.com/workspaces/ws/a','https://evil.example/workspaces/ws/a','https://media.api.bird.com/workspaces/other/a','https://api.bird.com@evil.example/workspaces/ws/a','https://media.api.bird.com:444/workspaces/ws/a'])
async def test_media_fetch_rejects_untrusted_url(monkeypatch,url):
 from fastapi import HTTPException
 monkeypatch.setattr(settings,'bird_workspace_id','ws')
 with pytest.raises(HTTPException) as e:await service.fetch_media(url)
 assert e.value.status_code==409

@pytest.mark.asyncio
async def test_old_incoming_media_can_be_downloaded_without_reimport(ctx,monkeypatch):
 ident=await seed();ctx.login(ctx.ids['superadmin']);provider_id=str(uuid.uuid4())
 async with _Session() as db:
  m=SupportMessage(conversation_id=ident,provider_id=provider_id,direction='incoming',body='[file message — view attachment in Bird]',kind='file',status='delivered',occurred_at=datetime.utcnow());db.add(m);await db.commit();mid=m.id
 thread=(await ctx.client.get(PREFIX+'/conversations/'+ident)).json();old=next(x for x in thread['messages'] if x['id']==mid);assert old['attachments'] and old['body']==''
 canonical=incoming(id=provider_id,body={'type':'file','file':{'files':[{'mediaUrl':'https://media.api.bird.com/workspaces/ws/messages/file','filename':'older.pdf'}]}})
 async def bird(method,path,**kw):assert method=='GET';return httpx.Response(200,json=canonical)
 async def fetch(url):return PDF
 monkeypatch.setattr(service,'bird',bird);monkeypatch.setattr(service,'fetch_media',fetch)
 r=await ctx.client.get(PREFIX+'/conversations/'+ident+'/messages/'+mid+'/attachments/0');assert r.status_code==200 and r.content==PDF

@pytest.mark.asyncio
async def test_no_provider_send_after_attachment_window_expires(ctx,monkeypatch):
 ident=await seed();ctx.login(ctx.ids['superadmin']);asset=(await upload(ctx,ident)).json()
 async with _Session() as db:
  a=await db.get(SupportAttachment,asset['id']);a.created_at=datetime.utcnow()-timedelta(hours=25);await db.commit()
 async def never(*a,**kw):raise AssertionError('Must not send expired attachment')
 monkeypatch.setattr(service,'bird',never)
 r=await ctx.client.post(PREFIX+'/conversations/'+ident+'/reply',json={'body':'Proposal','attachment_id':asset['id'],'request_id':str(uuid.uuid4())});assert r.status_code==409
