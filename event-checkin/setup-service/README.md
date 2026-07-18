# Festio Guided Setup Service

`setup-service` powers the event-type-aware guided setup flow (`/setup/guided`
in the frontend). It is a pure orchestration layer: for anything that creates
or modifies rows the core `backend` app owns (tables, table groups, RSVP
questions, multi-invitee rules, Experience/Program steps), it calls
`backend`'s own authenticated REST API — forwarding the caller's Firebase
bearer token unchanged — so every one of backend's existing auth/entitlement
checks applies exactly as if the organizer's browser had called backend
directly. `setup-service` never writes into backend's tables via its own DB
connection.

The one exception is `setup_progress`, a small table this service exclusively
owns in the shared `checkin` Postgres database, tracking which guided-setup
steps an organizer has completed or skipped per event so the flow is
resumable.

## Endpoints

- `POST/PATCH /api/setup/{event_id}/tables/bulk` — bulk table + table-group creation
- `PUT /api/setup/{event_id}/multi-invitee` — structured multi-invitee category/limit rules
- `POST /api/setup/{event_id}/program/bulk` — day/time Live Program segment builder
- `POST /api/setup/team/check-email` — Firebase existence check before inviting a teammate
- `GET /api/setup/recommendations?event_type=X` — event-type-driven defaults (`app/recommendations.py`)
- `GET/POST /api/setup/progress` — per-event guided-setup step tracking

## Runtime

Local compose:

```bash
docker compose up -d db backend setup-service proxy frontend
```

Production deploy:

```bash
./deploy.sh
```

## Config

Reads `backend/.env` (same shared config as `messaging-service`/`support-service`)
for `DATABASE_URL`, `FIREBASE_CREDENTIALS`, `SUPERADMIN_EMAILS`. The one setting
specific to this service is `BACKEND_BASE_URL` (defaults to `http://backend:8000`,
the in-cluster/in-compose service name).
