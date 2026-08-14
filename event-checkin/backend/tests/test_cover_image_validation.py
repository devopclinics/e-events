from app.routers.events import _detected_image_type


def test_detected_image_type_uses_bytes_not_filename():
    assert _detected_image_type(b"\x89PNG\r\n\x1a\nrest") == "image/png"
    assert _detected_image_type(b"\xff\xd8\xffrest") == "image/jpeg"
    assert _detected_image_type(b"RIFFxxxxWEBPrest") == "image/webp"
    assert _detected_image_type(b"GIF89arest") == "image/gif"


def test_detected_image_type_rejects_unknown_content():
    assert _detected_image_type(b"not an image") is None
