"""The backend is authoritative for the public host used in guest links.

A stale/hardcoded browser value (or the production host arriving on staging)
must be rewritten to this deployment's canonical PUBLIC_BASE_URL, otherwise QR
scan links point at the wrong environment and read as "Invalid Ticket".
"""
import app.routers.events as events


def test_festio_managed_hosts_are_rewritten_to_canonical(monkeypatch):
    monkeypatch.setattr(events, "FESTIO_PUBLIC_BASE_URL", "https://staging.festio.events")
    # Whatever Festio-managed host the browser sends, staging emits staging links.
    for incoming in (
        "https://festio.events",
        "https://festio.events/",
        "http://festio.events",
        "https://events.vsgs.io",
        "",
        None,
    ):
        assert events._normalize_public_base_url(incoming) == "https://staging.festio.events"


def test_custom_host_passes_through(monkeypatch):
    monkeypatch.setattr(events, "FESTIO_PUBLIC_BASE_URL", "https://staging.festio.events")
    assert events._normalize_public_base_url("https://tickets.acme.com") == "https://tickets.acme.com"
    # Trailing slash is trimmed but the host is preserved.
    assert events._normalize_public_base_url("https://tickets.acme.com/") == "https://tickets.acme.com"
