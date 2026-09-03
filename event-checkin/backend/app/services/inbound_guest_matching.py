"""Deterministic, event-isolated guest matching for normalized inbound mail."""
import re
import unicodedata
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Guest
from ..routers.guests import _normalize_phone
from .inbound_email_parser import InboundEmailNormalized


@dataclass(frozen=True)
class MatchResult:
    outcome: str
    guest_id: str | None = None
    candidate_ids: tuple[str, ...] = ()
    method: str | None = None


def _result(rows: list[Guest], method: str) -> MatchResult | None:
    unique = {row.id: row for row in rows}
    if len(unique) == 1:
        guest_id = next(iter(unique))
        return MatchResult("matched", guest_id, (guest_id,), method)
    if len(unique) > 1:
        return MatchResult("ambiguous", None, tuple(sorted(unique)), method)
    return None


def _name_parts(value: str) -> list[str]:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.findall(r"[a-z0-9]+", ascii_value.casefold())


def _name_matches(extracted: str, guest: Guest) -> tuple[bool, str]:
    """Conservative exact/shortened-name comparison.

    A shortened first name is accepted only with an exact surname and at least
    three shared leading characters. Arbitrary nickname mappings stay in the
    review queue because they are not reliable identity evidence.
    """
    incoming = _name_parts(extracted)
    stored = _name_parts(f"{guest.first_name} {guest.last_name}")
    if incoming == stored and incoming:
        return True, "name"
    if len(incoming) < 2 or len(stored) < 2 or incoming[-1] != stored[-1]:
        return False, "name"
    incoming_first, stored_first = incoming[0], stored[0]
    shortened = min(len(incoming_first), len(stored_first)) >= 3 and (
        incoming_first.startswith(stored_first) or stored_first.startswith(incoming_first)
    )
    return (True, "name_prefix") if shortened else (False, "name")


async def match_guest(db: AsyncSession, event_id: str, email: InboundEmailNormalized) -> MatchResult:
    identifiers = [item for item in email.identifiers if item.confidence in {"high", "medium"}]
    for kind in ("reference", "email"):
        values = {item.value.casefold() for item in identifiers if item.kind == kind and item.confidence == "high"}
        if not values:
            continue
        if kind == "reference":
            rows = (await db.execute(select(Guest).where(Guest.event_id == event_id, Guest.id.in_(values)))).scalars().all()
        else:
            rows = (await db.execute(select(Guest).where(
                Guest.event_id == event_id,
                func.lower(Guest.email).in_(values),
            ))).scalars().all()
        result = _result(list(rows), kind)
        if result:
            return result

    phones = {item.value for item in identifiers if item.kind == "phone" and item.confidence == "high"}
    if phones:
        guests = (await db.execute(select(Guest).where(Guest.event_id == event_id, Guest.phone.is_not(None)))).scalars().all()
        result = _result([guest for guest in guests if _normalize_phone(guest.phone or "") in phones], "phone")
        if result:
            return result

    names = {item.value for item in identifiers if item.kind == "name"}
    if names:
        guests = (await db.execute(select(Guest).where(Guest.event_id == event_id))).scalars().all()
        exact = [guest for guest in guests if any(_name_matches(name, guest) == (True, "name") for name in names)]
        result = _result(exact, "name")
        if result:
            return result
        shortened = [guest for guest in guests if any(_name_matches(name, guest) == (True, "name_prefix") for name in names)]
        result = _result(shortened, "name_prefix")
        if result:
            return result
    return MatchResult("not_found")
