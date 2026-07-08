import importlib.util
from pathlib import Path

def _load_script():
    path = Path(__file__).resolve().parents[1] / "scripts" / "bird_10dlc_campaign.py"
    spec = importlib.util.spec_from_file_location("bird_10dlc_campaign", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_campaign_payload_matches_festio_transactional_sms_scope():
    script = _load_script()

    payload = script.campaign_payload(
        sub_usecases=["ACCOUNT_NOTIFICATION", "CUSTOMER_CARE"],
    )
    script.validate_campaign_payload(payload)

    assert payload["name"] == "Festio - Event Ticket & Check-in Notifications"
    assert payload["usecase"] == "LOW_VOLUME"
    assert payload["subUsecases"] == ["ACCOUNT_NOTIFICATION", "CUSTOMER_CARE"]
    assert payload["embeddedLink"] is True
    assert payload["embeddedPhone"] is False
    assert payload["subscriberOptin"] is True
    assert payload["subscriberOptout"] is True
    assert payload["subscriberHelp"] is True
    assert payload["termsAndConditions"] is True
    assert "not promotional or marketing" in payload["description"]
    assert "Mobile opt-in path" in payload["messageFlow"]
    assert "https://festio.events/rsvp/{event-token}" in payload["messageFlow"]
    assert "https://festio.events/scan/{guest-token}" in payload["messageFlow"]
    assert "Reply HELP for help" in payload["messageFlow"]
    assert "Reply STOP to opt out" in payload["messageFlow"]
    assert "Message frequency varies by event" in payload["messageFlow"]
    assert "Message and data rates may apply" in payload["messageFlow"]
    assert "https://festio.events/privacy" in payload["messageFlow"]


def test_campaign_samples_are_branded_and_include_stop():
    script = _load_script()
    payload = script.campaign_payload()

    assert 1 <= len(payload["samples"]) <= 5
    assert all(sample.startswith("Festio:") for sample in payload["samples"])
    assert all("STOP" in sample for sample in payload["samples"])
    assert any("https://festio.events/scan/abc123" in sample for sample in payload["samples"])


def test_campaign_text_fits_bird_limits():
    script = _load_script()
    payload = script.campaign_payload()

    assert len(payload["description"]) <= 4096
    assert len(payload["messageFlow"]) <= 2048
    assert len(payload["helpMessage"]) <= 255


def test_brand_payload_matches_fohma_festio_identity():
    script = _load_script()

    payload = script.brand_payload()
    script.validate_brand_payload(payload)

    assert payload["entityType"] == "PRIVATE_PROFIT"
    assert payload["displayName"] == "Festio"
    assert payload["companyName"] == "FOHMA Solutions LLC"
    assert payload["ein"] == "332603330"
    assert payload["phone"] == "+18327941707"
    assert payload["website"] == "https://festio.events"
    assert payload["email"] == "muritala@festio.events"
    assert payload["state"] == "TX"
    assert payload["postalCode"] == "77493"
