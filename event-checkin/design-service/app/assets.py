"""Secure image asset handling for Design Studio uploads.

Defense in depth: extension allow-list + real magic-byte signature check +
Pillow decode (rejects anything that isn't a genuine raster image) + metadata
strip + re-encode + size cap. SVG/HTML/scripts can never pass because they don't
decode as a raster image and their signatures aren't in the allow-list. Files are
stored under DESIGN_STORAGE_PATH/assets/<event_id>/ with random names, so an
attacker can't control the path or overwrite anything.
"""
import io
import os
import re
import uuid

from PIL import Image

from .config import settings

# Magic-byte signatures for the only formats we accept.
_SIGNATURES = {
    "jpg":  [b"\xFF\xD8\xFF"],
    "jpeg": [b"\xFF\xD8\xFF"],
    "png":  [b"\x89PNG\r\n\x1a\n"],
    "webp": [b"RIFF"],  # + "WEBP" at offset 8, checked below
}
_PIL_FORMAT = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MAX_DIM = 4000  # downscale anything larger — no giant decompression bombs on render


class UploadError(Exception):
    pass


def _ext_from_name(filename: str) -> str:
    return (os.path.splitext(filename or "")[1].lstrip(".") or "").lower()


def _signature_ok(data: bytes, ext: str) -> bool:
    sigs = _SIGNATURES.get(ext, [])
    if not any(data.startswith(s) for s in sigs):
        return False
    if ext == "webp":  # RIFF container must be a WEBP
        return len(data) >= 12 and data[8:12] == b"WEBP"
    return True


def _assets_dir(event_id: str) -> str:
    if not _SAFE_ID.match(event_id):
        raise UploadError("invalid event id")
    d = os.path.join(settings.storage_path, "assets", event_id)
    os.makedirs(d, exist_ok=True)
    return d


def save_upload(event_id: str, filename: str, data: bytes, asset_type: str = "image") -> dict:
    """Validate → strip metadata → optimize → thumbnail → store. Returns metadata
    including a public URL. Raises UploadError on anything suspicious."""
    ext = _ext_from_name(filename)
    if ext not in settings.allowed_file_types:
        raise UploadError(f"file type .{ext or '?'} not allowed")
    if ext == "svg" and not settings.enable_svg_upload:
        raise UploadError("SVG upload is disabled")

    max_bytes = settings.upload_max_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise UploadError(f"file too large (max {settings.upload_max_mb} MB)")
    if not _signature_ok(data, ext):
        raise UploadError("file content does not match its type")

    # Decode with Pillow — this is what actually rejects disguised/corrupt files.
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()               # integrity check
        img = Image.open(io.BytesIO(data))  # reopen (verify() exhausts the file)
    except Exception:
        raise UploadError("not a valid image")

    fmt = _PIL_FORMAT[ext]
    if img.mode in ("P", "RGBA") and fmt == "JPEG":
        img = img.convert("RGB")
    if max(img.size) > _MAX_DIM:
        img.thumbnail((_MAX_DIM, _MAX_DIM))

    # Re-encode WITHOUT the original metadata (EXIF/GPS/ICC dropped) — new image
    # object has no info dict carried over, so this strips it.
    clean = Image.new(img.mode, img.size)
    clean.putdata(list(img.getdata()))

    asset_id = uuid.uuid4().hex
    out_ext = "jpg" if fmt == "JPEG" else ext
    directory = _assets_dir(event_id)
    fname = f"{asset_id}.{out_ext}"
    fpath = os.path.join(directory, fname)
    save_kwargs = {"optimize": True}
    if fmt == "JPEG":
        save_kwargs["quality"] = 85
    clean.save(fpath, fmt, **save_kwargs)

    # Thumbnail (max 480px).
    thumb = clean.copy()
    thumb.thumbnail((480, 480))
    thumb_name = f"{asset_id}_thumb.{out_ext}"
    thumb.save(os.path.join(directory, thumb_name), fmt, **save_kwargs)

    base = settings.public_asset_base_url
    public_url = f"{base}/api/v1/design/files/{event_id}/{fname}"
    return {
        "id": asset_id,
        "event_id": event_id,
        "asset_type": asset_type,
        "filename": fname,
        "thumb_filename": thumb_name,
        "mime_type": f"image/{'jpeg' if out_ext == 'jpg' else out_ext}",
        "width": clean.size[0],
        "height": clean.size[1],
        "size_bytes": os.path.getsize(fpath),
        "public_url": public_url,
        "thumb_url": f"{base}/api/v1/design/files/{event_id}/{thumb_name}",
    }


def asset_path(event_id: str, filename: str) -> str | None:
    """Resolve a stored asset path safely (no traversal). Returns None if missing."""
    if not _SAFE_ID.match(event_id):
        return None
    if not re.match(r"^[A-Za-z0-9_.-]{1,128}$", filename) or "/" in filename or ".." in filename:
        return None
    directory = os.path.realpath(os.path.join(settings.storage_path, "assets", event_id))
    path = os.path.realpath(os.path.join(directory, filename))
    # Ensure the resolved path stays inside the event's asset dir.
    if not path.startswith(directory + os.sep):
        return None
    return path if os.path.isfile(path) else None
