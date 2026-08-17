"""Speaker Showcase add-on — a public page listing an event's guest speakers.

Two routers:
  * `router`         — admin endpoints at /api/events, paid-gated + speaker_enabled.
  * `speaker_router`  — public, no-auth, at /api/speakers.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Event, GuestSpeaker, User
from ..schemas import GuestSpeakerCreate, GuestSpeakerUpdate, GuestSpeakerOut, SpeakerSettingsOut, SpeakerPageOut
from ..auth import require_paid_event_admin, require_paid_event_member

router = APIRouter()
speaker_router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────

async def _speaker_event(event_id: str, db: AsyncSession) -> Event:
    ev = await db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    if not ev.speaker_enabled:
        raise HTTPException(400, "Speaker Showcase is not enabled for this event")
    return ev


async def ensure_speaker_token(event: Event, db: AsyncSession) -> str:
    """Lazily mint the event's unguessable speaker token (cf. registry_token)."""
    if not event.speaker_token:
        event.speaker_token = str(uuid.uuid4())
        await db.commit()
        await db.refresh(event)
    return event.speaker_token


def _speaker_out(speaker: GuestSpeaker) -> GuestSpeakerOut:
    return GuestSpeakerOut(
        id=speaker.id, event_id=speaker.event_id, name=speaker.name, title=speaker.title,
        bio=speaker.bio, photo_url=speaker.photo_url, social_links=speaker.social_links or [],
        sort_order=speaker.sort_order, is_active=speaker.is_active,
    )


async def _get_speaker(event_id: str, speaker_id: str, db: AsyncSession) -> GuestSpeaker:
    speaker = await db.get(GuestSpeaker, speaker_id)
    if not speaker or speaker.event_id != event_id:
        raise HTTPException(404, "Speaker not found")
    return speaker


# ── Admin: speakers CRUD ────────────────────────────────────────────────────────

@router.get("/{event_id}/speakers", response_model=list[GuestSpeakerOut])
async def list_speakers(event_id: str, db: AsyncSession = Depends(get_db),
                        _: User = Depends(require_paid_event_member)):
    await _speaker_event(event_id, db)
    rows = (await db.execute(
        select(GuestSpeaker).where(GuestSpeaker.event_id == event_id)
        .order_by(GuestSpeaker.sort_order, GuestSpeaker.created_at)
    )).scalars().all()
    return [_speaker_out(s) for s in rows]


@router.post("/{event_id}/speakers", response_model=GuestSpeakerOut, status_code=201)
async def create_speaker(event_id: str, data: GuestSpeakerCreate, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_admin)):
    await _speaker_event(event_id, db)
    speaker = GuestSpeaker(
        event_id=event_id, name=data.name, title=data.title, bio=data.bio,
        photo_url=data.photo_url, social_links=[l.model_dump() for l in data.social_links],
        sort_order=data.sort_order,
    )
    db.add(speaker)
    await db.commit()
    await db.refresh(speaker)
    return _speaker_out(speaker)


@router.put("/{event_id}/speakers/{speaker_id}", response_model=GuestSpeakerOut)
async def update_speaker(event_id: str, speaker_id: str, data: GuestSpeakerUpdate,
                         db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_admin)):
    await _speaker_event(event_id, db)
    speaker = await _get_speaker(event_id, speaker_id, db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(speaker, k, v)
    await db.commit()
    await db.refresh(speaker)
    return _speaker_out(speaker)


@router.delete("/{event_id}/speakers/{speaker_id}", status_code=204)
async def delete_speaker(event_id: str, speaker_id: str, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_paid_event_admin)):
    await _speaker_event(event_id, db)
    speaker = await _get_speaker(event_id, speaker_id, db)
    await db.delete(speaker)
    await db.commit()


@router.get("/{event_id}/speakers/settings", response_model=SpeakerSettingsOut)
async def get_speaker_settings(event_id: str, db: AsyncSession = Depends(get_db),
                               _: User = Depends(require_paid_event_member)):
    ev = await _speaker_event(event_id, db)
    token = await ensure_speaker_token(ev, db)
    return SpeakerSettingsOut(speaker_token=token)


# ── Public speaker page (no auth, by unguessable token) ────────────────────────

async def _event_by_speaker_token(token: str, db: AsyncSession) -> Event:
    ev = await db.scalar(select(Event).where(Event.speaker_token == token))
    if not ev or not ev.speaker_enabled:
        raise HTTPException(404, "Speaker page not found")
    return ev


@speaker_router.get("/{token}", response_model=SpeakerPageOut)
async def public_speakers(token: str, db: AsyncSession = Depends(get_db)):
    ev = await _event_by_speaker_token(token, db)
    rows = (await db.execute(
        select(GuestSpeaker)
        .where(GuestSpeaker.event_id == ev.id, GuestSpeaker.is_active.is_(True))
        .order_by(GuestSpeaker.sort_order, GuestSpeaker.created_at)
    )).scalars().all()
    return SpeakerPageOut(event_name=ev.name, speakers=[_speaker_out(s) for s in rows])
