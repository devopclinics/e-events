# CRM capture and demo requests

The backend stores lifecycle and prospect interaction events locally, in the
same database transaction as the source change. It does not call Marketing
from authentication, event changes, payment fulfillment, or public demo intake.
The `marketing_outbox` and `demo_requests` tables are created by the existing
`app.db_migrate` metadata migration runner.

## Dispatch is disabled by default

The engagement-only `app.engagement_config` module loads the existing environment
variable names independently of legacy database settings; it contains no database
credential defaults. `MARKETING_OUTBOX_ENABLED=false` is the default. Capture continues while it is
off. When explicitly enabled, the application lifespan starts the outbox worker,
using the existing `MARKETING_SERVICE_URL` and `PLANNER_INTERNAL_TOKEN` service
contract. This switch does not authorize or enable outbound marketing messages;
Marketing's separate channel/automation controls and consent gates still apply.

Workers claim due rows with `FOR UPDATE SKIP LOCKED`, permitting multiple
PostgreSQL replicas. Each event keeps the same `event_id`, occurrence time, and
payload across retries, and the Marketing service deduplicates the event in its
own transaction. HTTP errors, timeouts, invalid acknowledgements, and
`recorded:false` responses remain retryable. The latter matters when a reply
arrives before the matching lead. Retry intervals use exponential backoff with
jitter, capped at 15 minutes. After 12 attempts, the row remains `failed` for
operator review instead of being discarded. Review the status, attempts, and
sanitized error category before retrying; a repair must retain the same ID.

After successful delivery, the payload is reduced to its event ID, occurrence
time, and lifecycle name. These tombstones prevent recapture without keeping a
second permanent copy of prospect contact information. Pending and failed
payloads retain the information needed for recovery. Operators must apply an
approved retention/deletion policy to pending/failed data and demo requests
before production enablement.

## Consent and registration

Registration and explicit signup checkbox evidence are separate one-time
idempotent events. This handles Firebase's auth listener creating the account
before the signup form submits its checkbox choices. Missing flags never grant
or revoke consent; only actual booleans for `consent_email`, `consent_sms`, and
`consent_whatsapp` are captured. Later logins cannot replay an old signup grant.
A phone number, account creation, or demo request is not WhatsApp consent.
Preference changes use the existing account preferences endpoint.

## Demo request semantics

`POST /api/demo-requests` records a requested time, not a reservation. Its 201
response includes `request_id`, `status: "requested"`, and an explicit statement
that the preferred time is not confirmed. No availability check is implied and
no calendar invite is generated. Existing acknowledgement and operator emails
remain transactional background tasks; they are queued only after the request
and its CRM event commit. These emails are best-effort, not a booking system or
an exactly-once notification guarantee. A lost acknowledgement does not lose
the request or CRM follow-up record.

Clients should supply an `Idempotency-Key` header (8–128 characters) and retain
it for retries of an unchanged submission. The server stores its SHA-256 digest
and a canonical payload digest. An identical replay returns the original result
without scheduling more emails; changed payloads using the same key return 409.
The unique database constraint also protects concurrent duplicate requests.
Legacy clients without a key are accepted but do not gain request deduplication.
A coarse public limit of five requests per IP per minute uses the existing
rate-limit helper. Configure shared Redis and trusted proxy/IP header handling
for multi-replica deployment; an in-memory fallback is per process, and the
existing generic helper fails open if Redis is unavailable.

## Local verification

Run the backend tests using the development requirements and isolated SQLite
fixtures. `tests/test_marketing_capture.py` covers transactional rollback,
idempotency, dispatcher-off behavior, retries/backoff/recovery, retained failures,
PII scrubbing, signup consent races, truthful demo requests, and rate limits.
Do not run with real provider credentials or against production services.

## Authenticated delivery receipts

`POST /api/webhooks/resend` now fails closed: missing
`RESEND_WEBHOOK_SECRET` returns 503, and an invalid or missing signature returns
400 before anything is persisted. Configure and verify the provider's signing
secret before rollout. The authenticated `svix-id` is the stable receipt ID,
including when the JSON body has no `id`. Receipt storage and CRM mirroring
commit together, so provider retries cannot create duplicate lifecycle effects.
