"""Explicit release command; importing this file does not change stored copy.

Usage: python -m app.onboarding_templates
Creates versioned reviewed templates without editing legacy templates or leads.
Prints only template IDs/hashes for deployment policy (never credentials).
"""
import json
from sqlalchemy import select


def install(m):
    from .journey_templates import candidates
    from .email_pilot import template_fingerprint
    pins = {}
    with m.SessionLocal() as db:
        for name, payload in candidates().items():
            name = "Client onboarding 2026-10 · " + name
            row = db.scalar(select(m.ModuleRecord).where(m.ModuleRecord.module == "sequences", m.ModuleRecord.name == name))
            if row and row.payload != payload:
                raise RuntimeError("Stored reviewed copy differs; create a new version instead of silently editing it")
            if row is None:
                row = m.ModuleRecord(module="sequences", name=name, status="active", payload=payload, created_by="reviewed-release")
                db.add(row); db.flush()
            if row.status != "active": raise RuntimeError("Reviewed template is not active")
            pins[payload['stage']] = {'id': row.id, 'sha256': template_fingerprint(row)}
        db.commit()
    return pins


if __name__ == '__main__':
    from . import main
    print(json.dumps(install(main), sort_keys=True))
