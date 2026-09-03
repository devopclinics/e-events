"""One-off repair for guest phone numbers corrupted by a spurious trailing
digit in an imported source spreadsheet (seen on the MBF Summit import,
2026-08-30). _normalize_phone() only assumes a "+1" country code for a clean
10-digit input; a bad 11-digit input that doesn't start with "1" falls
through to its no-country-code branch and gets stored as e.g. "+83231513280"
instead of the intended "+18323151328". These look like "valid" E.164 strings
(they pass the format regex) but aren't real numbers, so SMS/WhatsApp sends
silently fail while email (which doesn't touch this field) keeps working —
exactly what was observed.

This only touches phone numbers matching that exact corrupted shape: 11
digits after "+", not starting with "1". Anything else (already-correct
+1 numbers, genuinely different-shaped international numbers, empty phones)
is left untouched and listed separately for manual review.

Idempotent and scoped to one event. Always run without --apply first and
review the printed diff before applying.

Usage (run from backend/, DATABASE_URL pointed at the target environment):
    python -m scripts.fix_shifted_phone_numbers --event-id <id>              # dry run
    python -m scripts.fix_shifted_phone_numbers --event-id <id> --apply      # write changes
"""
import argparse
import asyncio
import re

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Guest
from app.routers.guests import _normalize_phone

# 11 digits after "+", first digit not "1" — the exact shape _normalize_phone's
# no-country-code fallback produces from a corrupted (10-digit + 1 stray
# trailing digit) raw input. A genuine +1 number is "+1" + 10 digits, so this
# shape can never be a correctly-normalized US number.
_SHIFTED_RE = re.compile(r"^\+[2-9]\d{10}$")


async def main(event_id: str, apply: bool) -> None:
    async with AsyncSessionLocal() as db:
        guests = (await db.execute(
            select(Guest).where(Guest.event_id == event_id, Guest.phone.is_not(None))
        )).scalars().all()

        fixes: list[tuple[Guest, str, str]] = []
        unrecognized: list[Guest] = []
        for guest in guests:
            if not _SHIFTED_RE.match(guest.phone or ""):
                continue
            candidate = _normalize_phone(guest.phone[1:-1])  # strip leading "+" and the trailing digit, re-derive with +1
            if candidate and candidate != guest.phone:
                fixes.append((guest, guest.phone, candidate))
            else:
                unrecognized.append(guest)

        print(f"Event {event_id}: {len(guests)} guests with a phone on file.")
        print(f"{len(fixes)} match the known corruption shape and would be corrected:\n")
        for guest, old, new in fixes:
            print(f"  {guest.first_name} {guest.last_name:<20} {old:>16}  ->  {new}")

        if unrecognized:
            print(f"\n{len(unrecognized)} guest(s) matched the shape but didn't produce a clean fix — skipped, review manually:")
            for guest in unrecognized:
                print(f"  {guest.first_name} {guest.last_name:<20} {guest.phone}")

        if not apply:
            print("\nDry run only — no changes written. Re-run with --apply to save these.")
            return

        for guest, _old, new in fixes:
            guest.phone = new
        await db.commit()
        print(f"\nApplied. {len(fixes)} phone number(s) corrected.")
        if fixes:
            ids = ", ".join(f'"{g.id}"' for g, _, _ in fixes)
            print("\nAffected guest_ids (for a targeted SMS/WhatsApp resend):")
            print(f"  [{ids}]")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--apply", action="store_true", help="Write changes (default: dry run only)")
    args = parser.parse_args()
    asyncio.run(main(args.event_id, args.apply))
