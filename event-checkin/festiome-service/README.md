# FestioMe internal service

FestioMe is a feature inside the Festio product, backed by an independently
deployable service. It owns its PostgreSQL database, Redis instance, upload
volume, migrations, and backup lifecycle. It must never import GuestHub code or
query the GuestHub database.

The Festio proxy exposes the user API at `/api/festiome/v1/*`. GuestHub calls
only the service-token-protected `/internal/v1/guesthub/*` contract.

## User capabilities

- FestioMe groups, roles, ownership, invitations, and discussion,
  announcement, or staff channels
- Cursor-paginated messages, replies, editing, deletion, reactions, mentions,
  read cursors, and unread counts
- Redis-backed server-sent events with short-lived stream tickets and polling
  fallback in the web client
- Multipart attachments with a 25 MB limit, MIME allowlist, generated storage
  names, pending-upload consumption, and authenticated downloads
- Search, polls, scheduled posts, notification preferences, reporting,
  moderation, and audit records

## GuestHub integration

GuestHub provisions event-linked groups and writes confirmed-guest changes,
removals, announcements, and access-token requests through versioned HTTP APIs.
All lifecycle updates except explicit provisioning/access use GuestHub's durable
outbox worker, so a FestioMe outage cannot roll back RSVP, invitation, ticket,
or check-in work. Urgent announcements may escalate through GuestHub's existing
email, SignalHouse SMS/MMS, and WhatsApp consent/credit pipeline.

## Operations

- `GET /health` checks the process.
- `GET /ready` checks database readiness.
- `GET /internal/metrics` exposes authenticated Prometheus text counters.
- Every response includes `x-request-id`; request logs are structured JSON.
- The container runs `python -m app.migrate` before starting the API. Applied
  migration names are recorded transactionally in `schema_migrations`.
- `festiome-db-backup` writes a compressed, clean PostgreSQL dump every 24
  hours to `./backups` and retains 14 days by default.
- `festiome-pgdata`, `festiome-redisdata`, and `festiome-uploads` are separate
  named volumes.

Restore a backup into a new database first, verify it, and only then schedule a
production cutover:

```sh
docker compose exec -T festiome-db createdb -U festiome festiome_restore_check
gzip -dc backups/festiome-YYYYMMDDTHHMMSSZ.sql.gz \
  | docker compose exec -T festiome-db psql -U festiome -d festiome_restore_check
docker compose exec -T festiome-db psql -U festiome -d festiome_restore_check \
  -c 'select version from schema_migrations order by version;'
docker compose exec -T festiome-db dropdb -U festiome festiome_restore_check
```

## Verification

Run service tests from this directory with `python3 -m pytest -q`. The GuestHub
boundary and integration tests live under `backend/tests/test_festiome_*`.
