import pytest

from app.assets import UploadError, save_upload


def test_mismatched_extension_has_actionable_error(tmp_path, monkeypatch):
    monkeypatch.setattr("app.assets.settings.storage_path", str(tmp_path))
    png = b"\x89PNG\r\n\x1a\nnot-enough-to-decode"

    with pytest.raises(UploadError) as exc:
        save_upload("event-1", "wedding.jpeg", png)

    message = str(exc.value)
    assert "PNG image data" in message
    assert "named .jpeg" in message
    assert "as .png" in message
