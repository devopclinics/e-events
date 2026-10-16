# Festio Marketing service

An isolated internal service for customer acquisition and lifecycle operations.
It owns its SQLite database and communicates with Festio only through scoped
JWTs and an authenticated lifecycle-ingest contract.

Modules:

- lead pipeline, scoring, ownership, consent, notes, and attribution
- segments and lifecycle follow-up sequences
- campaigns and content calendar
- referrals, internal tasks, and experiments
- staff grants controlled only by platform super-admins
- funnel dashboard and consent-safe follow-up automation

The backend sends registration, demo and account lifecycle signals through a
durable outbox with stable event IDs. Marketing downtime never blocks authentication or event
operations. The service accepts no main-database connection.

## Engagement safety and rollout

All outbound marketing is disabled unless `MARKETING_OUTBOUND_ENABLED=true` is
explicitly configured. This gate covers lifecycle email, campaign email, SMS,
and manual/scheduled social publishing. Dry-run previews still work. Leave the
gate off until provider credentials, channel-specific consent, approved content,
reply routing and staging verification have been reviewed. Provider readiness
includes `outbound_enabled`; configured credentials alone do not enable sends.

Consent is false by default for email, SMS and WhatsApp. A later lifecycle event
with no consent fields preserves existing preferences. Explicit boolean false
revokes the specified channel; explicit true grants it only if the lead has not
already unsubscribed. A bounded consent evidence record stores only supplied channel flags, source,
time and event ID, never treating omitted channels as revoked. A lifecycle
event never clears unsubscribe, handoff,
suppression or deletion state. Re-opt-in is an explicit preferences action.
The old `MARKETING_SKIP_CONSENT_CHECK` bypass is no longer honored.

A verified reply on any channel pauses all automated engagement, clears the
next send, and marks the lead for human follow-up. A verified opt-out also
revokes that channel. Unverified/anonymous contacts create private review
tasks instead; they cannot mutate an existing lead or its consent.
Complaints and permanent email bounces suppress email. A demo request creates
an assigned internal task containing the requested time/details; it does not
create or confirm a calendar booking. Lead output exposes `automation_paused`,
`suppression_reason`, `last_inbound_at`, and `handoff_requested_at` for a future
operator inbox. A staff review must resolve the reason before explicitly
resuming a lead. No automatic reply, chatbot, or WhatsApp sending is implemented
by these ingress contracts.

### Lifecycle ingress

The backend durable outbox sends the existing platform-authenticated request to
`POST /api/marketing/internal/ingest` with:

- `event_id`: stable, globally unique string of 1–128 characters. Required for
  durable producers. Optional only for compatibility with legacy callers.
- `lifecycle_event`: e.g. `registered`, `signup_consent`, `event_created`,
  `demo_requested`, `activated`, `paid`, or `customer`.
- `email` and optionally `festio_user_id`, `name`, `phone`, `organization` and
  acquisition attribution. `event_type` remains the event category, not the
  lifecycle name. `stage` can supply the corresponding pipeline stage.
- Optional explicit boolean `consent_email`, `consent_sms`, `consent_whatsapp`.
- Demo details: `demo_request_id`, `preferred_time` (requested ISO timestamp),
  `timezone`, `event_name`, and `message`. These are bounded in the review task.

Lead changes, timeline entry, demo task and the event receipt commit atomically.
The response contains the lead and `ingest_duplicate: false`; a retry of the
same event returns `ingest_duplicate: true` without repeating effects. Reusing
an ID for different content returns HTTP 409. Receipts survive lead deletion so
replaying an old event cannot recreate that lead; such a replay returns the
original `id`, `removed: true`, and `ingest_duplicate: true`. Pipeline events
advance recognized stages but cannot regress a later-stage lead.

### Conversation and delivery ingress

`POST /api/marketing/internal/conversations` uses the same platform authority:

```json
{
  "event_id": "whatsapp:stable-provider-message-id",
  "channel": "whatsapp",
  "event": "message_received",
  "identity_verified": true,
  "source_contact_id": "meta:15555550101",
  "phone": "+15555550101"
}
```

`channel` is `email`, `whatsapp`, `chat` or `sms`. `event` is `message_received`,
`handoff_requested` or `opt_out`. Supply at least one of `email`, `phone`,
`festio_user_id`, or a namespaced `source_contact_id` (up to 512 characters).
`identity_verified` is a strict boolean defaulting to false. Only authenticated
adapters may assert it after verifying ownership of the identifier, such as a
signed Meta sender phone. A provider signature alone does not establish that
an email From field or anonymous chat email belongs to an existing lead.

Verified identifiers must resolve to one lead; ambiguity returns 409. Explicit
international phone formatting is normalized without guessing a country code.
Local/ambiguous phone numbers are not used to match leads. No transcript,
message body, media or reply token is stored by this endpoint.

The usual response is `{recorded, duplicate, lead_id}`. New, unknown or
unverified contacts are durably saved as pending prospects with an assigned,
owner-scoped review task, not fabricated email leads. Their response includes
`recorded: true`, `unmatched: true`, `prospect_id` and `lead_id: null`. A stable
source-contact ID groups later messages into the same pending review task.
All receipts commit atomically, and duplicate events repeat no effects.

A later lifecycle event may associate a verified pending prospect only when
its identity resolves unambiguously to that lead, carrying forward the paused
state and any channel opt-out. Self-reported/unverified identities never
associate automatically merely because their claimed email later matches an
account. Staff must review them. These tasks are not a full conversational
inbox and do not send replies.

Set `MARKETING_REPLY_DOMAIN` only after configuring receiving routes and the
backend recipient allowlist. Outbound email then includes a signed,
lead-specific `Reply-To` plus-address (including Resend's `reply_to` field).
The internal conversation adapter may supply `reply_token`; a valid token and
an exact current lead sender-email match bind an email reply to that lead.
Invalid, mismatched and untokened email goes to pending review, not lead
suppression. Chatwoot anonymous contacts remain unverified pending review.

The upstream adapter must authenticate each provider and validate its dedicated
sales destination before calling this internal API. Public webhooks must not
point directly at it. Lead/deletion workflows remove associated prospect and
task contact details while retaining non-contact receipt tombstones.

`POST /api/marketing/internal/delivery` also accepts optional `event_id` for
outbox deduplication. Delivery callbacks never advance sequence progress.
Direct SignalHouse callbacks at `/api/marketing/sms/webhook` fail closed when
`SIGNALHOUSE_WEBHOOK_TOKEN` is absent and require a matching `X-Webhook-Token`.

### Dispatch behavior

The scheduler and HTTP trigger call the same plain `run_automation_service`,
not a FastAPI endpoint function with unresolved dependency/query defaults.
Only provider-accepted `email_sent` attempts advance sequence progress. A
failed/missing-provider send remains on the same step; known failures back off
15, 30, 60, ... minutes, capped at 24 hours. After
`MARKETING_MAX_SEND_ATTEMPTS` (default 5), a lead is paused for review. Completion
clears the next-send timestamp immediately.

Seeded step `delay_hours` values are cumulative offsets (0, 24, 72, 168): the
next successful step is scheduled using the difference between adjacent
values. Explicit legacy `next_delay_hours` remains supported, including zero.
A nonzero initial `delay_hours` is also honored. Failed attempts do not consume
a delay or a step.

Each automated lead/sequence/step has a durable send claim persisted before
contacting a provider. Parallel workers cannot claim the same step. Due time, stage, suppression and
owner scope are revalidated after claiming; stale claims are released without
spending the retry budget. Resend also
receives a stable `Idempotency-Key`. Timeout/network/ambiguous server outcomes,
or an abandoned in-flight claim older than two minutes, pause the lead for
manual reconciliation instead of retrying blindly after a provider's
idempotency window. A provider may have accepted a message immediately before
a crash, so this is deliberately not a promise of exactly-once delivery,
especially with SMTP. Reconcile provider records before modifying a paused
send claim. Known client rejections and unconfigured-provider results can
retry within the bounded policy. Keep sequences stable while dispatching.

The timer defaults to every 15 minutes. Set `MARKETING_SCHEDULER_ENABLED=false`
to disable it in tests or a controlled review environment. SQLite schema
upgrades are additive for consent, pause and receipt/claim fields; back up the
service database before deployment as usual.

### Isolated tests

From this directory, using an isolated Python environment:

```sh
python -m pip install -r requirements.txt pytest
python -m pytest -q
```

Tests use temporary SQLite databases, disable the scheduler, strip provider
configuration and reject real HTTP/SMTP transport. Coverage includes old-schema
migration, idempotent lifecycle/demo/conversation/delivery ingestion, rollback,
consent defaults/revocation, stage ordering, reply/opt-out suppression,
ambiguous identities, outbound gates, sequence timing/progress, provider
idempotency, concurrent send claims and crash/uncertain-outcome handoff.
