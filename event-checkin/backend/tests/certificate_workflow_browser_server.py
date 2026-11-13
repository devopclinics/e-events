import sys,asyncio,os
from pathlib import Path
from datetime import datetime
sys.path.insert(0,str(Path(__file__).resolve().parent))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from conftest import _engine,_Session,Base,app,get_db,get_current_user,_override_get_db
from app.models import Organization,Membership,User,Event,Guest
from app.config import settings
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
port=int(sys.argv[1]);root=Path(sys.argv[2]);user=None
_engine=create_async_engine('sqlite+aiosqlite:///'+str(root/'fixture.sqlite'))
_Session=async_sessionmaker(_engine,expire_on_commit=False)
async def local_db():
 async with _Session() as db:yield db
settings.public_base_url=f'http://127.0.0.1:{port}';settings.frontend_url=settings.public_base_url;settings.design_service_url=''
for field in ['resend_api_key','bird_access_key','smtp_host','twilio_account_sid','twilio_auth_token','signalhouse_api_key']:
 if hasattr(settings,field):setattr(settings,field,'')
async def seed():
 global user
 async with _engine.begin() as conn:
  await conn.run_sync(Base.metadata.drop_all);await conn.run_sync(Base.metadata.create_all)
 async with _Session() as db:
  db.add(Organization(id='qa-org',name='QA Conference',slug='qa-org'))
  user=User(id='qa-admin',name='QA Organiser',email='qa@example.test',role='official');db.add(user);await db.flush()
  db.add(Membership(org_id='qa-org',user_id=user.id,role='owner'))
  db.add(Event(id='qa-event',org_id='qa-org',name='Certificate Workflow QA',couples_name='QA',checkin_base_url=f'http://127.0.0.1:{port}',event_date=datetime(2026,11,11),is_paid=True));await db.flush()
  db.add(Guest(event_id='qa-event',first_name='QA',last_name='Participant',email='participant@example.test',admitted=True));await db.commit()
asyncio.run(seed())
async def seed_registration_without_attendance():
 async with _Session() as db:
  db.add(Guest(event_id='qa-event',first_name='Registered',last_name='Absent',email='absent@example.test',admitted=False));await db.commit()
asyncio.run(seed_registration_without_attendance())
from app.routers import live_content
sent_emails=[]
async def capture_certificate_email(*args,**kwargs):
 sent_emails.append({'to':args[0],'subject':args[1],'html':args[2]})
live_content.send_simple_email=capture_certificate_email
@app.get('/fixture-emails')
async def fixture_emails():return sent_emails

async def actor():return user
app.dependency_overrides[get_db]=local_db;app.dependency_overrides[get_current_user]=actor
@app.get('/studio')
@app.get('/certificate-review/{token}')
@app.get('/certificate-sign/{token}')
async def index(token=None):return FileResponse(root/'index.html')
app.mount('/fixture-assets',StaticFiles(directory=str(root)),name='fixture-assets')
uvicorn.run(app,host='127.0.0.1',port=port,lifespan='off',log_level='warning')
