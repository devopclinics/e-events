"""Per-flow channel policy resolver (priority + fallback)."""
from types import SimpleNamespace

from app.channels import channels_for_flow


def _event(policy=None, blocked=None, **notify):
    base = {"notify_email": True, "notify_sms": True, "notify_whatsapp": True, "notify_mms": False}
    base.update(notify)
    return SimpleNamespace(channel_policy=policy, blocked_messaging_channels=blocked, **base)


def _guest(email="g@x.com", phone="+1", sms=True, whatsapp=True):
    return SimpleNamespace(email=email, phone=phone, sms_consent=sms, whatsapp_consent=whatsapp)


def test_no_policy_sends_every_enabled_available_channel():
    ev, g = _event(), _guest()
    assert channels_for_flow(ev, g, "invite", paid_ok=True) == {"email", "sms", "whatsapp"}


def test_policy_picks_first_deliverable_only():
    ev = _event(policy={"invite": ["email", "sms"]})
    assert channels_for_flow(ev, _guest(), "invite", paid_ok=True) == {"email"}


def test_policy_falls_back_when_preferred_unavailable():
    ev = _event(policy={"invite": ["email", "whatsapp"]})
    # No email → falls back to whatsapp.
    assert channels_for_flow(ev, _guest(email=None), "invite", paid_ok=True) == {"whatsapp"}


def test_paid_gate_drops_paid_channels():
    ev = _event(policy={"invite": ["sms", "email"]})
    # Unpaid event can't use sms → falls back to email.
    assert channels_for_flow(ev, _guest(), "invite", paid_ok=False) == {"email"}


def test_consent_and_contact_respected():
    ev = _event(policy={"reminder": ["whatsapp", "sms"]})
    # No whatsapp consent → sms; but also no sms consent → nothing deliverable.
    assert channels_for_flow(ev, _guest(whatsapp=False), "reminder", paid_ok=True) == {"sms"}
    assert channels_for_flow(ev, _guest(whatsapp=False, sms=False), "reminder", paid_ok=True) == set()


def test_flow_without_policy_entry_keeps_legacy():
    ev = _event(policy={"invite": ["email"]})
    # "admission" has no policy entry → all enabled+available.
    assert channels_for_flow(ev, _guest(), "admission", paid_ok=True) == {"email", "sms", "whatsapp"}


def test_superadmin_block_wins_over_policy_and_flags():
    # WhatsApp hard-blocked by the operator → never chosen, even without a policy.
    ev = _event(blocked=["whatsapp"])
    assert channels_for_flow(ev, _guest(), "invite", paid_ok=True) == {"email", "sms"}
    # And it wins over a policy that lists it first (falls back to next).
    ev2 = _event(policy={"invite": ["whatsapp", "sms"]}, blocked=["whatsapp"])
    assert channels_for_flow(ev2, _guest(), "invite", paid_ok=True) == {"sms"}
