# Festio Live engagement-service

Festio Live is an isolated FastAPI service with its own PostgreSQL database,
Redis realtime tier, migration lifecycle, API container, and AI worker. Core
Festio never calls it synchronously from a user request. Scoped JWTs carry
opaque Festio event, organization, guest, and user references across the
boundary. A transactional core outbox asynchronously replicates published
Experience program metadata into an idempotent Live inbox. Neither service
connects to the other's database.

```text
Festio core ── scoped JWT / async program events ──> engagement API ──> engagement PostgreSQL
                                      │
                                      ├── best-effort SSE/pub-sub ──> Redis
                                      └── durable AI job ──> engagement worker
```

The complete architecture, security model, implementation phases, and
requirements acceptance matrix are in [ARCHITECTURE.md](ARCHITECTURE.md).

Redis is optional at runtime and at service startup. Response submission uses
PostgreSQL directly; SSE and rate limiting fail open when Redis is unavailable.
The worker claims persisted jobs with `FOR UPDATE SKIP LOCKED`, so jobs survive
process restarts and multiple workers can run safely.

## Product surfaces

- Admin: activities, question bank, live control, displays, responses,
  analytics, settings, conditional rules, and CSV exports.
- Guest: event/pass or anonymous join, current-question participation, Q&A,
  live updates, and privacy-safe leaderboards.
- Presenter/moderator: capability-scoped share links.
- Display: legacy activity links and independent `/live/{display_code}` scenes
  with revocable read-only tokens.

### Festio Broadcast

Independent displays support 21 scene types: welcome, join/QR, agenda,
question, responding, results, answer reveal, leaderboard, team battle,
rating, feedback, word cloud, Q&A, room pulse, AI insight, idea galaxy,
announcement, break, countdown, celebration, and custom messages. Each scene
can use Aurora, Citrus, Ocean, Festio, or high-contrast art direction.

Display settings live in engagement-service's own JSONB record and include
event branding, venue/date labels, sponsors, agenda cards, team names,
countdown duration, motion/reaction controls, safe-area guides, and automatic
activity following. Capability-scoped presenters can change these show-time
fields through `/control/displays`; they cannot rename, disable, delete, or
rotate a display token. Display SSE subscribes to both its display channel and
its assigned activity channel, with five-second HTTP polling as venue-network
fallback.

Public text never reaches guest feeds or displays before moderation. Pending
Q&A is staff-only. Truly anonymous activities store an HMAC pseudonym instead
of the Festio guest ID and anonymize exports and leaderboards.

## Operations

- Liveness: `/health/live`
- Readiness: `/health/ready`
- Metrics: `/metrics`
- Proxied staging aliases: `/api/engagement/health*` and
  `/api/engagement/metrics`
- Load probe: `scripts/load_probe.py`
- Service-down acceptance: `scripts/staging_failure_acceptance.sh`
- Standalone staging deploy: `scripts/deploy_staging.sh VERSION`

The failure acceptance script stops only the engagement API and worker, checks
core staging surfaces, and restores the exact version from `VERSION` even when
the host `.env` contains an older `APP_VERSION`.
