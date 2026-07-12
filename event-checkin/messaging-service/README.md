# EventQR Messaging Service

`messaging-service` is the isolated Guest Hub and event communication service.
It is intentionally non-critical: RSVP, QR tickets, and check-in continue to
work if this service is disabled or unavailable.

## Runtime

Local compose:

```bash
docker compose up -d db backend messaging-service proxy frontend
```

Production deploy:

```bash
./deploy.sh --no-cache
```

The deploy pipeline builds and pushes:

- `dclinics/events:messaging-${VERSION}`
- `dclinics/events:messaging-latest`

## Environment

The service uses the existing `backend/.env` pattern and shared Postgres DB.

Important variables:

- `DATABASE_URL`
- `REDIS_URL` (distributed rate limiting)
- `FIREBASE_CREDENTIALS`
- `SUPERADMIN_EMAILS`
- `MESSAGING_ENABLED=true`
- `GUEST_HUB_ENABLED=true`
- `ANNOUNCEMENTS_ENABLED=true`
- `DIRECT_HOST_MESSAGES_ENABLED=true`
- `EVENT_CHAT_ENABLED=false`
- `REALTIME_MESSAGING_ENABLED=false`
- `MESSAGE_MAX_LENGTH=1000`
- `ANNOUNCEMENT_MAX_LENGTH=5000`
- `GUEST_MESSAGE_RATE_LIMIT=10`
- `GUEST_CHAT_RATE_LIMIT=20`
- `GUEST_QUERY_TOKEN_FALLBACK_ENABLED=true` (set to `false` to require Authorization header for guest token)

## Routes

Public health:

- `GET /health`
- `GET /api/messaging/health`

Guest routes:

- `GET /api/messaging/events/{event_id}/guest-hub` (guest token via `Authorization: Bearer <token>`; query fallback still accepted)
- `POST /api/messaging/events/{event_id}/messages/direct` (guest token via `Authorization: Bearer <token>`; query fallback still accepted)
- `POST /api/messaging/events/{event_id}/messages/chat` (guest token via `Authorization: Bearer <token>`; query fallback still accepted)

Admin routes:

- `GET /api/messaging/admin/events/{event_id}/messaging/settings`
- `PATCH /api/messaging/admin/events/{event_id}/messaging/settings`
- `GET /api/messaging/admin/events/{event_id}/announcements`
- `POST /api/messaging/admin/events/{event_id}/announcements`
- `GET /api/messaging/admin/events/{event_id}/messages/inbox`
- `GET /api/messaging/admin/events/{event_id}/messages/inbox/{thread_id}`
- `POST /api/messaging/admin/events/{event_id}/messages/inbox/{thread_id}/reply`
- `GET /api/messaging/admin/events/{event_id}/messages/chat`
- `PATCH /api/messaging/admin/events/{event_id}/messages/chat/{message_id}`

## Phase 1 Scope

Implemented:

- Event Updates / announcements
- Event-level Guest Hub enable/disable
- Direct guest-to-host messages
- Guest-to-guest chat with host-controlled posting
- Basic guest chat moderation
- Admin Guest Communication tab
- Guest Hub after confirmed RSVP
- Shared DB tables for future delivery/read tracking
- Feature flags
- Polling-friendly APIs

Deferred:

- Email/SMS/WhatsApp delivery adapters
- Scheduled announcements
- WebSocket/SSE realtime

## Rollout

1. Deploy with `./deploy.sh --no-cache`.
2. Confirm `messaging-service` is healthy in compose.
3. Open an event in admin and use **Guest Communication**.
4. Confirm a guest RSVP and verify **Guest Hub** appears.

If the service fails, the invite page shows a non-blocking unavailable message;
RSVP and QR behavior are unaffected.
