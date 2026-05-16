from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Event
from ..schemas import EventCreate, EventUpdate, EventOut

router = APIRouter()


@router.post("", response_model=EventOut, status_code=201)
async def create_event(data: EventCreate, db: AsyncSession = Depends(get_db)):
    event = Event(**data.model_dump())
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


@router.get("", response_model=list[EventOut])
async def list_events(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Event).order_by(Event.created_at.desc()))
    return result.scalars().all()


@router.get("/{event_id}", response_model=EventOut)
async def get_event(event_id: str, db: AsyncSession = Depends(get_db)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return event


@router.put("/{event_id}", response_model=EventOut)
async def update_event(event_id: str, data: EventUpdate, db: AsyncSession = Depends(get_db)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(event, field, value)
    await db.commit()
    await db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
async def delete_event(event_id: str, db: AsyncSession = Depends(get_db)):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    await db.delete(event)
    await db.commit()
