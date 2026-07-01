"""Phase-1 persistence: one JSON file per event under DESIGN_STORAGE_PATH.

Deliberately simple and swappable — the API never leaks the storage shape, so
this can become Postgres/object-storage later without touching callers. All
writes are atomic (temp file + rename) to survive a crash mid-write.
"""
import json
import os
import re
import tempfile
from datetime import datetime, timezone

from .config import settings

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _designs_dir() -> str:
    d = os.path.join(settings.storage_path, "event-designs")
    os.makedirs(d, exist_ok=True)
    return d


def _path(event_id: str) -> str:
    # Guard against path traversal — event ids are opaque tokens/UUIDs.
    if not _SAFE_ID.match(event_id):
        raise ValueError("invalid event id")
    return os.path.join(_designs_dir(), f"{event_id}.json")


def load_design(event_id: str) -> dict | None:
    try:
        with open(_path(event_id), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def save_design(event_id: str, data: dict) -> dict:
    existing = load_design(event_id) or {}
    existing.update(data)
    existing["event_id"] = event_id
    existing["updated_at"] = datetime.now(timezone.utc).isoformat()
    existing.setdefault("is_published", False)
    path = _path(event_id)
    fd, tmp = tempfile.mkstemp(dir=_designs_dir(), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)  # atomic
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return existing


def publish_design(event_id: str) -> dict:
    d = load_design(event_id) or {"event_id": event_id}
    version = int(d.get("published_version") or 0) + 1
    d["published_snapshot"] = {
        "selected_template_id": d.get("selected_template_id"),
        "selected_flyer_template_id": d.get("selected_flyer_template_id"),
        "theme_config": d.get("theme_config", {}),
        "wording_config": d.get("wording_config", {}),
        "asset_config": d.get("asset_config", {}),
        "organization_id": d.get("organization_id"),
    }
    d["is_published"] = True
    d["published_version"] = version
    d["published_at"] = datetime.now(timezone.utc).isoformat()
    return save_design(event_id, d)
