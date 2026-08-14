"""Dry-run-first legacy entitlement reconciliation.

Usage: python -m app.reconcile_organization_entitlements (report only)
       python -m app.reconcile_organization_entitlements --apply
"""
import argparse
import asyncio
from datetime import timedelta

from sqlalchemy import func, select

from .database import AsyncSessionLocal
from .models import Event, Organization


async def run(apply: bool = False) -> None:
    async with AsyncSessionLocal() as db:
        orgs = (await db.execute(select(Organization).with_for_update())).scalars().all()
        changed = 0
        for org in orgs:
            events = (await db.execute(select(Event).where(Event.org_id == org.id))).scalars().all()
            paid = [event for event in events if event.is_paid]
            units = sum(max(0, int(event.message_credits or 0)) * 10 for event in events)
            proposal = {
                "org": org.id, "events": len(events), "paid_events": len(paid),
                "free_event_used": bool(events), "credit_units": units,
            }
            print(proposal)
            if apply:
                org.free_event_used = bool(events)
                # Preserve the default free allocation for genuinely new orgs.
                org.message_credit_units = units if events else max(100, int(org.message_credit_units or 0))
                # Historical paid events do not prove a currently active pass.
                # Operators must activate one from a confirmed payment date.
                changed += 1
        if apply:
            await db.commit()
        print({"mode": "apply" if apply else "dry-run", "organizations": len(orgs), "changed": changed})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    asyncio.run(run(parser.parse_args().apply))
