"""Per-event entitlement rules (Phase 2).

What a free event gets vs what an Event Pass unlocks. Payment that flips these
flags arrives in Phase 3 (Stripe/Paystack); this module only reads/enforces them.
"""
from fastapi import HTTPException

from .models import Event

# Free events: email-only invites, capped guest list, EventQR branding.
FREE_GUEST_CAP = 25


def guest_limit(event: Event) -> int | None:
    """Max guests for this event. None = unlimited."""
    if event.is_paid:
        return event.guest_cap  # None = unlimited for paid/comp tiers
    return FREE_GUEST_CAP


def can_use_paid_channels(event: Event) -> bool:
    """Whether SMS/WhatsApp may be sent for this event (email is always allowed)."""
    return bool(event.is_paid and event.paid_channels)


def assert_within_guest_cap(event: Event, current_count: int, adding: int = 1) -> None:
    """Raise 402 if adding `adding` guests would exceed the event's plan cap."""
    cap = guest_limit(event)
    if cap is not None and current_count + adding > cap:
        raise HTTPException(
            402,
            f"This event's plan allows up to {cap} guests. "
            "Upgrade with an Event Pass to add more.",
        )
