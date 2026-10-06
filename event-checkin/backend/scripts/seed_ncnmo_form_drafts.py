"""Seed the user-requested NCNMO form drafts. No publishing, signatures or messages.
Run in the backend container with template JSON at /tmp/ncnmo-form-templates.json.
Dry-run by default; APPLY_FORM_DRAFTS=1 commits. Stable IDs make reruns safe.
"""
import asyncio, hashlib, json, os, uuid
from pathlib import Path
from sqlalchemy import select, text
from app.database import AsyncSessionLocal
from app.models import Event, EventForm, EventFormRevision, ConsentForm, ConsentSignature
from app.routers.event_forms import Definition
EVENT_ID='cefc5699-da7e-4610-9598-74a9423f0ea0'
MARKER='ncnmo-form-drafts-2026-10-06'
async def main():
    templates=json.loads(Path('/tmp/ncnmo-form-templates.json').read_text())
    async with AsyncSessionLocal() as db:
        await db.execute(text('SELECT pg_advisory_xact_lock(hashtext(:key))'),{'key':MARKER})
        event=await db.get(Event,EVENT_ID)
        assert event and 'NCNMO' in event.name and event.experience_enabled
        async def legacy():
            rows=[]
            for model in (ConsentForm,ConsentSignature):
                records=(await db.scalars(select(model).where(model.event_id==EVENT_ID))).all()
                rows.extend([{c.name:str(getattr(r,c.name)) for c in model.__table__.columns} for r in records])
            return hashlib.sha256(json.dumps(sorted(rows,key=lambda x:x['id']),sort_keys=True).encode()).hexdigest()
        before=await legacy();created=[];existing=[]
        for template in templates:
            form_id=str(uuid.uuid5(uuid.NAMESPACE_URL,MARKER+':'+template['title']))
            row=await db.get(EventForm,form_id)
            if row:
                assert row.event_id==EVENT_ID
                existing.append({'id':row.id,'published_version':row.published_version});continue
            definition=Definition(**template).model_dump()
            form=EventForm(id=form_id,event_id=EVENT_ID,version=1,published_version=None,archived=False)
            db.add(form);await db.flush()
            db.add(EventFormRevision(form_id=form_id,version=1,definition=definition,created_by=None))
            created.append({'id':form_id,'title':definition['title'],'status':'unpublished draft'})
        await db.flush();assert before==await legacy()
        apply=os.environ.get('APPLY_FORM_DRAFTS')=='1'
        if apply:await db.commit()
        else:await db.rollback()
        print(json.dumps({'event_id':EVENT_ID,'mode':'applied' if apply else 'dry-run','created':created,'existing':existing,'legacy_records_unchanged':True,'legacy_fingerprint':before,'published_by_script':0,'signatures_created':0,'outbound_messages':0},indent=2))
asyncio.run(main())
