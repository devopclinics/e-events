from app.services.inbound_email_outbox import completion_rules_pass, sender_is_trusted
from app.services.inbound_email_parser import normalize_received_email
from app.services.inbound_guest_matching import _name_matches
from app.models import Guest


class Automation:
    sender_rules = [
        {"sender_kind": "forwarder", "match_type": "email", "value": "organizer@gmail.com"},
        {"sender_kind": "original", "match_type": "domain", "value": "provider.example"},
    ]
    completion_rules = {
        "match": "all",
        "conditions": [
            {"field": "subject", "operator": "contains", "value": "Consent Completed"},
            {"field": "body", "operator": "contains", "value": "successfully submitted"},
        ],
    }


def test_forwarded_email_normalizes_typed_identifiers_and_sender():
    parsed = normalize_received_email({
        "from": "organizer@gmail.com",
        "to": ["consent+token@inbound.festio.events"],
        "subject": "Consent Completed - Ada Test",
        "message_id": "<forward-1@gmail.com>",
        "text": """Your consent has been successfully submitted.

---------- Forwarded message ---------
From: Consent Provider <notifications@provider.example>
Guest Name: Ada Test
Guest Email: ada-test@example.com
Guest Phone: +1 (312) 555-0100
Guest ID: 11111111-1111-1111-1111-111111111111
""",
        "headers": {"Authentication-Results": "mx; dkim=pass"},
    })

    assert parsed.sender == "organizer@gmail.com"
    assert parsed.original_sender == "notifications@provider.example"
    assert {(item.kind, item.value) for item in parsed.identifiers} >= {
        ("email", "ada-test@example.com"),
        ("phone", "+13125550100"),
        ("name", "ada test"),
        ("reference", "11111111-1111-1111-1111-111111111111"),
    }
    assert sender_is_trusted(Automation(), parsed)
    assert completion_rules_pass(Automation(), parsed)


def test_sender_rules_are_restrictive_by_default():
    parsed = normalize_received_email({"from": "attacker@example.com", "text": "done"})
    automation = Automation()
    automation.sender_rules = []
    assert not sender_is_trusted(automation, parsed)


def test_untrusted_sender_and_missing_completion_phrase_are_rejected():
    parsed = normalize_received_email({
        "from": "attacker@example.com",
        "subject": "Consent pending",
        "text": "Guest Email: ada-test@example.com",
    })
    assert not sender_is_trusted(Automation(), parsed)
    assert not completion_rules_pass(Automation(), parsed)


def test_yahoo_nested_waiversign_forward_extracts_provider_and_subject_name():
    parsed = normalize_received_email({
        "from": "oladzeez@yahoo.com",
        "subject": "Fw: Electronically-Signed Document for Test 3 User (33312)",
        "text": """----- Forwarded Message -----
From: \"Oladejo Azeez\" <oladzeez@yahoo.com>
Subject: Fw: Electronically-Signed Document for Test 3 User (33312)

----- Forwarded Message -----
From: \"WaiverSign Support\" <notifications@waiversign.com>
Subject: Electronically-Signed Document for Test 3 User (33312)

Test 3 User,
Your electronically-signed waiver can be viewed below.
""",
        "headers": {"Authentication-Results": "mx; dkim=pass header.i=@yahoo.com"},
    })

    assert parsed.sender == "oladzeez@yahoo.com"
    assert parsed.original_sender == "notifications@waiversign.com"
    assert ("name", "test 3 user") in {(item.kind, item.value) for item in parsed.identifiers}


def test_compact_html_derived_forward_extracts_deepest_provider():
    parsed = normalize_received_email({
        "from": "oladzeez@yahoo.com",
        "subject": "Fw: Electronically-Signed Document for Test 3 User (33312)",
        "text": 'Forwarded Message From: "Oladejo Azeez" <oladzeez@yahoo.com> To: Festio '
                'Forwarded Message From: "WaiverSign Support" <notifications@waiversign.com> '
                'Your electronically-signed waiver is ready.',
        "headers": {"Authentication-Results": "mx; dmarc=pass header.from=yahoo.com"},
    })

    assert parsed.original_sender == "notifications@waiversign.com"


def test_shortened_first_name_requires_exact_surname():
    guest = Guest(event_id="event", first_name="Jonathan", last_name="Williams")
    assert _name_matches("Jon Williams", guest) == (True, "name_prefix")
    assert _name_matches("Jo Williams", guest) == (False, "name")
    assert _name_matches("Jon Williamson", guest) == (False, "name")
