"""Send deduplicated Event Pass expiry reminders. Intended for a daily job."""
import asyncio
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .database import AsyncSessionLocal
from .models import Membership, Organization, OrganizationPassNotice, User
from services.email_service import send_simple_email

MILESTONES = (90, 60, 30, 14, 7, 1)


async def run() -> int:
    sent = 0
    async with AsyncSessionLocal() as db:
        orgs = (await db.execute(select(Organization).where(
            Organization.event_pass_status == "active",
            Organization.event_pass_expires_at.is_not(None),
        ))).scalars().all()
        now = datetime.utcnow()
        for org in orgs:
            days = (org.event_pass_expires_at.date() - now.date()).days
            if days not in MILESTONES:
                continue
            recipients = (await db.execute(
                select(User.email).join(Membership, Membership.user_id == User.id).where(
                    Membership.org_id == org.id, Membership.role.in_(["owner", "admin"]), User.is_active.is_(True)
                )
            )).scalars().all()
            for recipient in set(recipients):
                notice = OrganizationPassNotice(
                    org_id=org.id, expires_at=org.event_pass_expires_at,
                    days_before=days, recipient=recipient,
                )
                db.add(notice)
                try:
                    await db.commit()
                except IntegrityError:
                    await db.rollback()
                    continue
                await send_simple_email(
                    recipient, f"Your Festio Event Pass expires in {days} day{'s' if days != 1 else ''}",
                    f"<p>Your {org.event_pass_tier} Event Pass expires on {org.event_pass_expires_at:%B %d, %Y}.</p>"
                    "<p>Renew to continue creating events and using paid communication and add-ons. Your data and unused credits remain safe.</p>"
                    '<p><a href="https://festio.events/admin">Review your Event Pass</a></p>',
                    message_kind="event_pass_expiry",
                )
                sent += 1
    return sent


if __name__ == "__main__":
    print(asyncio.run(run()))
