from pathlib import Path


def test_service_does_not_import_guesthub_application():
    root = Path(__file__).resolve().parents[1] / "app"
    forbidden = ("event-checkin", "app.models", "app.routers", "backend.app")
    offenders = []
    for path in root.rglob("*.py"):
        text = path.read_text()
        if any(term in text for term in forbidden):
            offenders.append(str(path.relative_to(root)))
    assert not offenders, f"FestioMe crossed the GuestHub code boundary: {offenders}"

