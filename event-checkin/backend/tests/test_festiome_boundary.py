"""Static guards for the GuestHub/FestioMe service boundary."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GUESTHUB_APP = ROOT / "backend" / "app"
FESTIOME_APP = ROOT / "festiome-service" / "app"


def test_embedded_festiome_prototype_is_removed():
    assert not (GUESTHUB_APP / "festiome").exists()


def test_festiome_service_does_not_import_guesthub_application_code():
    offenders = []
    forbidden = ("from app.", "import app.", "from backend", "import backend")
    for path in FESTIOME_APP.glob("*.py"):
        for line_number, line in enumerate(path.read_text().splitlines(), 1):
            if any(token in line for token in forbidden):
                offenders.append(f"{path.name}:{line_number}: {line.strip()}")
    assert not offenders, "FestioMe imported GuestHub code:\n" + "\n".join(offenders)


def test_guesthub_integration_uses_http_client_not_festiome_orm():
    client = (GUESTHUB_APP / "services" / "festiome_client.py").read_text()
    router = (GUESTHUB_APP / "routers" / "festiome.py").read_text()
    assert "httpx" in client
    assert "festiome-service" not in router
    assert "app.festiome" not in client + router
