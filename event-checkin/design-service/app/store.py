"""Phase-1 persistence: one JSON file per event under DESIGN_STORAGE_PATH.

Deliberately simple and swappable — the API never leaks the storage shape, so
this can become Postgres/object-storage later without touching callers. All
writes are atomic (temp file + rename) to survive a crash mid-write.
"""
import copy
import fcntl
from contextlib import contextmanager

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


CONFIG_KEYS = ("selected_template_id", "selected_flyer_template_id", "theme_config", "wording_config", "asset_config", "page_config", "organization_id")


class RevisionConflict(Exception):
    pass


def snapshot(d):
    return {key: copy.deepcopy(d.get(key)) for key in CONFIG_KEYS if key in d}


@contextmanager
def design_lock(event_id):
    # File lock covers all worker processes sharing this persistent volume.
    with open(_path(event_id) + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _check_revision(d, expected):
    if expected is not None and expected != int(d.get("revision") or 0):
        raise RevisionConflict("This design changed in another editor. Reload it before saving or publishing.")


def _write(event_id, d):
    d["event_id"] = event_id
    d["updated_at"] = datetime.now(timezone.utc).isoformat()
    d["revision"] = int(d.get("revision") or 0) + 1
    d.setdefault("is_published", False)
    fd, tmp = tempfile.mkstemp(dir=_designs_dir(), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _path(event_id))
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return d


def save_design(event_id: str, data: dict, expected_revision=None) -> dict:
    with design_lock(event_id):
        d = load_design(event_id) or {}
        _check_revision(d, expected_revision)
        # Freeze the public legacy appearance on its first subsequent edit.
        # Existing events are not visually migrated merely by deploying this code.
        if not d.get("is_published") and "public_baseline" not in d:
            d["public_baseline"] = snapshot(d)
        d.update(data)
        return _write(event_id, d)


def publish_design(event_id: str, expected_revision=None) -> dict:
    with design_lock(event_id):
        d = load_design(event_id) or {"event_id": event_id}
        _check_revision(d, expected_revision)
        versions = d.setdefault("published_versions", [])
        if not versions and d.get("published_snapshot"):
            versions.append({"version": d.get("published_version", 1), "published_at": d.get("published_at"), "design": copy.deepcopy(d["published_snapshot"])})
        version = int(d.get("published_version") or 0) + 1
        d["published_snapshot"] = snapshot(d)
        d["is_published"] = True
        d["published_version"] = version
        d["published_at"] = datetime.now(timezone.utc).isoformat()
        versions.append({"version": version, "published_at": d["published_at"], "design": copy.deepcopy(d["published_snapshot"])})
        return _write(event_id, d)


def restore_design(event_id, version, expected_revision):
    with design_lock(event_id):
        d = load_design(event_id) or {}
        _check_revision(d, expected_revision)
        match = next((v for v in d.get("published_versions", []) if v["version"] == version), None)
        if not match and version == d.get("published_version") and d.get("published_snapshot"):
            match = {"design": d["published_snapshot"]}
        if not match:
            raise KeyError("Published version not found")
        restored = copy.deepcopy(match["design"])
        for key in CONFIG_KEYS:
            if key != "organization_id":
                d[key] = restored.get(key, None if key.startswith("selected_") else {})
        return _write(event_id, d)
