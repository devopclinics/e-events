"""Legacy duplicate data must block migration without losing any records."""
import importlib
import sqlite3

import pytest

from test_marketing_e2e import load_app


def database_dump(path):
    with sqlite3.connect(path) as db:
        return "\n".join(db.iterdump())


def test_duplicate_email_preflight_preserves_all_legacy_rows_and_schema(tmp_path):
    path = tmp_path / "marketing.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE marketing_leads (id TEXT PRIMARY KEY, email TEXT, created_at TEXT, updated_at TEXT, stage_changed_at TEXT)")
        db.execute("CREATE TABLE marketing_activities (id TEXT PRIMARY KEY, lead_id TEXT, summary TEXT)")
        db.executemany("INSERT INTO marketing_leads VALUES (?, ?, ?, ?, ?)", [
            ("lead-a", "Owner@example.com", "2026-01-01", "2026-02-01", None),
            ("lead-b", "owner@example.com", "2026-01-02", "2026-02-02", None),
            ("lead-c", "Second@example.com", "2026-01-03", "2026-02-03", None),
            ("lead-d", "second@example.com", "2026-01-04", "2026-02-04", None),
            ("lead-e", "unique@example.com", "2026-01-05", "2026-02-05", None),
        ])
        db.executemany("INSERT INTO marketing_activities VALUES (?, ?, ?)", [
            ("activity-a", "lead-a", "Keep first activity"),
            ("activity-b", "lead-b", "Keep duplicate owner's activity"),
        ])
    before = database_dump(path)
    with pytest.raises(RuntimeError, match="2 duplicate normalized-email group") as error:
        load_app(tmp_path)
    assert "manual review" in str(error.value)
    assert "@" not in str(error.value)
    assert "lead-a" not in str(error.value) and "lead-b" not in str(error.value)
    assert database_dump(path) == before
    # Retrying startup must also preserve data and refuse, not silently repair it.
    with pytest.raises(RuntimeError, match="2 duplicate normalized-email group"):
        load_app(tmp_path)
    assert database_dump(path) == before


def test_clean_existing_database_retains_leads_and_creates_unique_index(tmp_path):
    client, headers = load_app(tmp_path)
    lead = client.post("/api/marketing/leads", headers=headers, json={"email": "unique@example.com", "name": "Keep this lead"}).json()
    module = importlib.import_module("app.main")
    module.engine.dispose()
    path = tmp_path / "marketing.db"
    with sqlite3.connect(path) as db:
        db.execute("DROP INDEX uq_marketing_leads_email_normalized")
        before_leads = db.execute("SELECT * FROM marketing_leads ORDER BY id").fetchall()
        before_activities = db.execute("SELECT * FROM marketing_activities ORDER BY id").fetchall()
    client, headers = load_app(tmp_path)
    assert client.get("/health").status_code == 200
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT * FROM marketing_leads ORDER BY id").fetchall() == before_leads
        assert db.execute("SELECT * FROM marketing_activities ORDER BY id").fetchall() == before_activities
        index_sql = db.execute("SELECT sql FROM sqlite_master WHERE name='uq_marketing_leads_email_normalized'").fetchone()[0]
        assert "UNIQUE INDEX" in index_sql and "lower(email)" in index_sql
        assert db.execute("SELECT id FROM marketing_leads").fetchall() == [(lead["id"],)]
