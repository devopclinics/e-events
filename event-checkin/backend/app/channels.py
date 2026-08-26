"""Per-flow channel policy.

An event may set ``channel_policy = {flow: policy}`` where ``policy`` is either:
  - a plain list (legacy) or a dict with ``mode: "priority"`` — ordered
    priority + fallback, cost control: only the FIRST channel the guest can
    actually receive (enabled + contact + consent + paid gate) is used, so an
    organizer can route e.g. invites over free email and only fall back to a
    paid channel if email isn't available.
  - a dict with ``mode: "all"`` — send on every one of the configured channels
    the guest can receive, not just the first. For organizers who'd rather
    pay for redundant delivery than risk a guest missing a message.
Flows with no policy at all keep the legacy behavior of sending on every
enabled + available channel (equivalent to "all" over every channel).
"""
from .models import Event, Guest

ALL_CHANNELS = ("email", "sms", "whatsapp", "mms")


def messaging_channel_blocked(event: Event, channel: str) -> bool:
    """Platform-superadmin hard block (console-only) — wins over notify_* + policy."""
    return channel in (event.blocked_messaging_channels or [])


def comm_feature_blocked(event: Event, feature: str) -> bool:
    """Platform-superadmin hard block on a two-way communication feature
    (guest_hub / guest_chat / host_messages / announcements / festiome)."""
    return feature in (event.blocked_comm_features or [])


def _channel_available(event: Event, guest: Guest, channel: str, *, paid_ok: bool) -> bool:
    if messaging_channel_blocked(event, channel):
        return False
    if not getattr(event, f"notify_{channel}", False):
        return False
    if channel == "email":
        return bool(guest.email)
    # sms / whatsapp / mms are paid channels and need a phone + consent.
    if not paid_ok or not guest.phone:
        return False
    if channel == "sms":
        return bool(guest.sms_consent)
    if channel == "whatsapp":
        return bool(guest.whatsapp_consent)
    if channel == "mms":
        return bool(guest.sms_consent)
    return False


def channels_for_flow(event: Event, guest: Guest, flow: str, *, paid_ok: bool) -> set[str]:
    """Channels to actually send ``flow`` on for this guest.

    No policy for the flow -> every enabled + available channel (legacy).
    Policy with mode "all" -> every configured channel the guest can receive.
    Policy with mode "priority" (or a bare legacy list) -> just the first
    deliverable channel in the configured order, or none if the guest can't
    receive any of them.
    """
    available = [c for c in ALL_CHANNELS if _channel_available(event, guest, c, paid_ok=paid_ok)]
    policy = (event.channel_policy or {}).get(flow)
    if not policy:
        return set(available)
    if isinstance(policy, dict):
        channels = policy.get("channels") or []
        if policy.get("mode") == "all":
            return {c for c in channels if c in available}
        ordered = channels
    else:
        ordered = policy  # legacy bare list -> priority mode
    for channel in ordered:
        if channel in available:
            return {channel}
    return set()
