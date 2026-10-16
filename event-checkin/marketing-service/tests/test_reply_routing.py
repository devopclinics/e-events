import uuid

from app.reply_routing import make_reply_token, reply_address, verify_reply_token


def test_reply_token_binds_identity_without_exposing_contact_details():
    lead_id = str(uuid.uuid4())
    token = make_reply_token(lead_id, "synthetic-signing-secret")
    assert verify_reply_token(token, "synthetic-signing-secret") == lead_id
    assert verify_reply_token(token, "other-secret") is None
    assert verify_reply_token(token, "") is None
    changed = token[:-1] + ("A" if token[-1] != "A" else "B")
    assert verify_reply_token(changed, "synthetic-signing-secret") is None
    assert verify_reply_token("anything@example.com", "synthetic-signing-secret") is None
    address = reply_address(lead_id, "synthetic-signing-secret", "sales.example.com")
    assert len(address.split("@")[0]) == 64
    assert address.endswith("@sales.example.com")


def test_reply_routing_is_off_until_valid_domain_and_secret_exist():
    lead_id = str(uuid.uuid4())
    for domain in ("", "localhost", "evil.com\nBcc:victim@example.com", "@example.com", "bad_domain.com", "example..com"):
        assert reply_address(lead_id, "synthetic-secret", domain) is None
    assert reply_address(lead_id, "", "sales.example.com") is None
    assert reply_address("invalid-id", "synthetic-secret", "sales.example.com") is None
