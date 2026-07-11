"""FestioMe — in-app, GroupMe-style group chat.

A self-contained module: its own tables (``festiome_*``), router, service, and
authorization. It reuses shared infrastructure (DB session, Redis/SSE fan-out,
Firebase auth verification, object storage, the messaging/credit pipeline) but
does NOT import event business logic. Event <-> chat interaction lives only in
``integration.py``. Keeping this boundary makes FestioMe a clean, rewritable unit.
"""
