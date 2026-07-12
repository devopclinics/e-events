"""Per-flow channel policy — priority + fallback, to minimize messaging cost.

An event may set ``channel_policy = {flow: [ordered channels]}``. For a flow that
has a policy, only the FIRST channel the guest can actually receive (enabled +
contact + consent + paid gate) is used — so an organizer can route, e.g., invites
over free email and tickets over MMS instead of paying to send every message on
every channel. Flows with no policy keep the legacy behavior of sending on every
enabled + available channel.
"""
from .models import Event, Guest

ALL_CHANNELS = ("email", "sms", "whatsapp", "mms")


def _channel_available(event: Event, guest: Guest, channel: str, *, paid_ok: bool) -> bool:
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

    No policy for the flow → every enabled + available channel (legacy). With a
    policy → the first deliverable channel in the configured order (priority +
    fallback), or none if the guest can't receive any of them.
    """
    available = [c for c in ALL_CHANNELS if _channel_available(event, guest, c, paid_ok=paid_ok)]
    policy = (event.channel_policy or {}).get(flow)
    if not policy:
        return set(available)
    for channel in policy:
        if channel in available:
            return {channel}
    return set()
