"""FestioMe authorization tests — cross-event / cross-group isolation, guest
eligibility, no auto-rejoin after removal, and the one-identity DB constraint."""
from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Organization, Event, Guest
from app.festiome.models import FestiomeGroup, FestiomeMember
from app.festiome import authz, integration
from app.festiome.authz import Identity


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite://",
                                 connect_args={"check_same_thread": False}, poolclass=StaticPool)
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        yield s


async def _event(db, *, invite_mode="closed", rsvp="invited", admitted=False, tok="t"):
    org = Organization(name="O", slug="o-" + tok)
    db.add(org); await db.flush()
    ev = Event(org_id=org.id, name="E-" + tok, couples_name="x",
               event_date=datetime(2026, 1, 1), checkin_base_url="http://x", invite_mode=invite_mode)
    db.add(ev); await db.flush()
    g = Guest(event_id=ev.id, first_name="G", last_name=tok, email=f"g{tok}@x",
              invite_token="inv-" + tok, qr_token="qr-" + tok, rsvp_status=rsvp, admitted=admitted)
    db.add(g); await db.commit()
    return ev, g


@pytest.mark.asyncio
async def test_guest_eligibility_policy(db):
    ev_closed, g = await _event(db, invite_mode="closed", rsvp="invited", tok="c")
    assert integration.guest_eligible(g, ev_closed) is True          # closed + invited = audience
    ev_open, g2 = await _event(db, invite_mode="open", rsvp="invited", tok="o")
    assert integration.guest_eligible(g2, ev_open) is False          # open + only invited = not yet
    _, g3 = await _event(db, invite_mode="open", rsvp="confirmed", tok="cf")
    assert integration.guest_eligible(g3, (await db.get(Event, g3.event_id))) is True
    _, g4 = await _event(db, invite_mode="open", rsvp="declined", admitted=True, tok="ad")
    assert integration.guest_eligible(g4, (await db.get(Event, g4.event_id))) is True   # admitted overrides


@pytest.mark.asyncio
async def test_cross_event_and_cross_group_isolation(db):
    ev_a, ga = await _event(db, tok="a")
    ev_b, gb = await _event(db, tok="b")
    grp_a, mem_a = await integration.ensure_guest_member(ev_a.id, ga.id, "GA", db)
    grp_b, mem_b = await integration.ensure_guest_member(ev_b.id, gb.id, "GB", db)
    assert mem_a and mem_b and grp_a.id != grp_b.id

    id_a = Identity("guest", ga.id, "GA", ev_a.id)
    # Guest A is a member of group A…
    assert (await authz.member_for(grp_a.id, id_a, db)) is not None
    # …but NOT of event B's group (cross-event / cross-group).
    assert (await authz.member_for(grp_b.id, id_a, db)) is None


@pytest.mark.asyncio
async def test_removed_guest_not_auto_rejoined(db):
    ev, g = await _event(db, tok="r")
    grp, mem = await integration.ensure_guest_member(ev.id, g.id, "G", db)
    assert mem is not None
    mem.removed_at = datetime.utcnow()
    await db.commit()
    # Re-resolving does NOT bring them back — must be admin-restored.
    grp2, mem2 = await integration.ensure_guest_member(ev.id, g.id, "G", db)
    assert mem2 is None
    await integration.restore_member(mem, db)
    grp3, mem3 = await integration.ensure_guest_member(ev.id, g.id, "G", db)
    assert mem3 is not None and mem3.removed_at is None


@pytest.mark.asyncio
async def test_ineligible_guest_not_joined(db):
    ev, g = await _event(db, invite_mode="open", rsvp="pending", tok="p")
    grp, mem = await integration.ensure_guest_member(ev.id, g.id, "G", db)
    assert grp is not None and mem is None   # group exists, but pending guest isn't joined


@pytest.mark.asyncio
async def test_one_identity_constraint(db):
    grp = FestiomeGroup(name="G", created_by="u"); db.add(grp); await db.flush()
    db.add(FestiomeMember(group_id=grp.id, user_id="u1", guest_ref="g1", display_name="Both"))
    with pytest.raises(IntegrityError):
        await db.commit()
