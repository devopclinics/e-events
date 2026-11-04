from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,ConfigDict,Field,model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import require_superadmin
from app.config import settings
from app.database import get_db
from app.models import SupportAutomationConfig as Config,SupportAutomationState as State,SupportConversation,Event,User
from app.services import support_automation as service
from app.services.support_answers import defaults,answer
router=APIRouter()

class Answers(BaseModel):
    model_config=ConfigDict(extra='forbid')
    time:str=Field(default='',max_length=600)
    venue:str=Field(default='',max_length=600)
    registration:str=Field(default='',max_length=600)
    programme:str=Field(default='',max_length=600)
    dress:str=Field(default='',max_length=600)

class Profile(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id:str=Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    name:str=Field(min_length=2,max_length=100)
    aliases:list[str]=Field(default_factory=list,max_length=5)
    approved:bool=False
    answers:Answers=Field(default_factory=Answers)
    @model_validator(mode='after')
    def clean(self):
        self.name=self.name.strip()
        if len(self.name)<2 or any(not isinstance(x,str) or not 2<=len(x.strip())<=80 for x in self.aliases):raise ValueError('Use event names and aliases of at least two characters.')
        if self.approved and not any(v.strip() for v in self.answers.model_dump().values()):raise ValueError('An approved event needs at least one answer.')
        self.aliases=[x.strip() for x in self.aliases]
        return self

class SettingsPayload(BaseModel):
    model_config=ConfigDict(extra='forbid')
    enabled:bool=False
    welcome:str=Field(default=defaults()['welcome'],min_length=1,max_length=500)
    handover:str=Field(default=defaults()['handover'],min_length=1,max_length=500)
    heading:str=Field(default=defaults()['heading'],min_length=1,max_length=80)
    intro:str=Field(default=defaults()['intro'],min_length=1,max_length=300)
    message:str=Field(default=defaults()['message'],min_length=1,max_length=500)
    profiles:list[Profile]=Field(default_factory=list,max_length=20)
    @model_validator(mode='after')
    def unique(self):
        if len({p.id for p in self.profiles})!=len(self.profiles):raise ValueError('Each event needs a unique identifier.')
        names=[]
        for p in self.profiles:
            if p.approved:names.extend([p.name.casefold(),*[x.casefold() for x in p.aliases]])
        if len(names)!=len(set(names)):raise ValueError('Approved event names and aliases must be distinct.')
        if any(not getattr(self,k).strip() for k in ['welcome','handover','heading','intro','message']):raise ValueError('Welcome and contact text cannot be blank.')
        return self

class SaveSettings(BaseModel):
    settings:SettingsPayload
    version:int=Field(ge=0)

class Preview(BaseModel):
    settings:SettingsPayload
    text:str=Field(min_length=1,max_length=1000)
    context:dict=Field(default_factory=dict)

@router.get('/contact')
async def contact(db:AsyncSession=Depends(get_db)):
    cfg,_=await service.config(db)
    return {k:cfg[k] for k in ['heading','intro','message']}

@router.get('/automation/settings')
async def get_settings(db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    cfg,version=await service.config(db)
    return {'settings':cfg,'version':version,'channel_enabled':settings.support_whatsapp_enabled}

@router.put('/automation/settings')
async def save_settings(data:SaveSettings,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    row=await db.scalar(select(Config).where(Config.id=='main').with_for_update())
    if (row.version if row else 0)!=data.version:raise HTTPException(409,'Settings changed. Reopen them before saving.')
    if not row:
        row=Config(id='main',payload=data.settings.model_dump(),version=1,updated_by=user.id);db.add(row)
    else:
        row.payload=data.settings.model_dump();row.version+=1;row.updated_by=user.id;row.updated_at=datetime.utcnow()
    try:await db.commit()
    except IntegrityError:
        await db.rollback();raise HTTPException(409,'Settings changed. Reopen them before saving.')
    return {'settings':row.payload,'version':row.version,'channel_enabled':settings.support_whatsapp_enabled}

@router.post('/automation/preview')
async def preview(data:Preview,user:User=Depends(require_superadmin)):
    if len(str(data.context))>5000:raise HTTPException(400,'Reset the preview conversation.')
    body,context,mode=answer(data.settings.model_dump(),data.context,data.text)
    return {'body':body,'context':context,'mode':mode,'sent':False}

@router.get('/automation/event/{event_id}')
async def event_snapshot(event_id:str,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    event=await db.get(Event,event_id)
    if not event:raise HTTPException(404,'Event not found')
    try:tz=ZoneInfo(event.timezone or 'UTC')
    except (ValueError,KeyError):tz=ZoneInfo('UTC')
    when=event.event_date.replace(tzinfo=ZoneInfo('UTC')).astimezone(tz)
    return {'id':event.id,'name':event.name,'aliases':[],'approved':False,'answers':{'time':when.strftime('%A, %d %B %Y · %I:%M %p')+' ('+str(tz)+')','venue':'\n'.join(filter(None,[event.venue_name,event.venue_address])),'registration':'','programme':'','dress':''}}

class Mode(BaseModel):
    mode:str=Field(pattern='^(auto|human)$')

@router.put('/conversations/{ident}/automation')
async def set_mode(ident:str,data:Mode,db:AsyncSession=Depends(get_db),user:User=Depends(require_superadmin)):
    thread=await db.scalar(select(SupportConversation).where(SupportConversation.id==ident).with_for_update())
    if not thread:raise HTTPException(404,'Conversation not found')
    row=await db.get(State,ident)
    if not row:row=State(conversation_id=ident,context={});db.add(row)
    row.mode=data.mode;row.updated_at=datetime.utcnow()
    if data.mode=='auto':row.context={'_resume_after':row.updated_at.isoformat()}
    await db.commit();return {'mode':row.mode}
