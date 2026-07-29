"""Phase 0 (redesign rollout) — seed a dedicated, isolated test organization.

Creates one fresh org (slug "internal-redesign-qa") with one draft test event,
for exercising the redesign_cohort rollout mechanism without touching any real
customer org or data. Deliberately NOT the legacy DEFAULT_ORG_ID (that org is
protected/legacy — see backend/app/routers/admin.py).

Idempotent: re-running is a no-op if the org already exists.

Usage (run from backend/, DATABASE_URL pointed at the target environment):
    python -m scripts.seed_redesign_test_org
    python -m scripts.seed_redesign_test_org --member-email you@example.com

Not wired into db_migrate.py or the deploy pipeline — run manually, once, per
environment that needs a redesign QA org.
"""
import argparse
import asyncio
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Event, Membership, Organization, User
from app.routers.events import FESTIO_PUBLIC_BASE_URL, unique_event_code

TEST_ORG_SLUG = "internal-redesign-qa"
TEST_ORG_NAME = "Festio Internal QA"


async def main(member_email: str | None) -> None:
    async with AsyncSessionLocal() as db:
        existing = await db.scalar(select(Organization).where(Organization.slug == TEST_ORG_SLUG))
        if existing:
            print(f"Already seeded: org {existing.id} (slug={TEST_ORG_SLUG}, "
                  f"redesign_cohort={existing.redesign_cohort})")
            org = existing
        else:
            org = Organization(
                id=str(uuid.uuid4()),
                name=TEST_ORG_NAME,
                slug=TEST_ORG_SLUG,
                redesign_cohort="legacy_only",
            )
            db.add(org)
            await db.flush()

            event = Event(
                id=str(uuid.uuid4()),
                org_id=org.id,
                name="Redesign QA Test Event",
                couples_name="",
                event_date=datetime.utcnow() + timedelta(days=30),
                timezone="America/New_York",
                checkin_base_url=FESTIO_PUBLIC_BASE_URL,
                status="draft",
                # Internal QA fixture: unlock the Stage B add-on surfaces without
                # creating a real payment or touching a customer organization.
                is_paid=True,
                plan_tier="tier150",
                seating_enabled=True,
                menu_enabled=True,
                logistics_enabled=True,
                registry_enabled=True,
                venue_access_enabled=True,
                manual_checkin_enabled=True,
                walk_in_enabled=True,
                experience_enabled=True,
                festiome_addon_enabled=True,
                event_code=await unique_event_code(db),
                rsvp_token=str(uuid.uuid4()),
            )
            db.add(event)
            await db.commit()
            await db.refresh(org)
            print(f"Seeded org {org.id} (slug={TEST_ORG_SLUG}) with test event {event.id}")

        if member_email:
            user = await db.scalar(select(User).where(User.email == member_email))
            if not user:
                print(f"No user found with email {member_email} — skipping membership grant.")
                return
            existing_membership = await db.scalar(
                select(Membership).where(Membership.org_id == org.id, Membership.user_id == user.id)
            )
            if existing_membership:
                print(f"{member_email} is already a member (role={existing_membership.role}).")
                return
            db.add(Membership(org_id=org.id, user_id=user.id, role="owner"))
            await db.commit()
            print(f"Granted {member_email} owner membership on {TEST_ORG_SLUG}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--member-email", default=None,
                        help="Existing user email to grant owner membership on the QA org")
    args = parser.parse_args()
    asyncio.run(main(args.member_email))
