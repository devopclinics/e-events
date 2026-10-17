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

The backend sends registration/account lifecycle signals with explicit email
verification provenance and separate unverified public demo requests through
a durable outbox with stable event IDs. Marketing downtime never blocks
authentication or event operations. The service accepts no main-database connection.

## Engagement safety and rollout

All outbound marketing is disabled unless `MARKETING_OUTBOUND_ENABLED=true` is
explicitly configured. This gate covers lifecycle email, campaign email, SMS,
and manual/scheduled social publishing. Dry-run previews still work. Leave the
gate off until provider credentials, channel-specific consent, approved content,
reply routing and staging verification have been reviewed. Provider readiness
includes `outbound_enabled`; configured credentials alone do not enable sends.

Keep the backend `MARKETING_OUTBOX_ENABLED` gate OFF until both the backend and
Marketing service have been upgraded and their receipt contracts verified in
staging. Deploying only one side is not sufficient: an older consumer may still
trust an unverified claim. The new producer rejects an unexpected fresh-lead
acknowledgement for an unverified signup instead of silently deleting its
recoverable payload. Neither this rollout nor receipt replay automatically
repairs historical role assignments, account links, lead profile changes or
consent; those require separate authorized review.

Human Marketing JWTs now require the literal boolean `email_verified: true`
before staff grants or human super-admin access are accepted. The backend emits
it only after checking current authentication proof against the selected
account's email. Older human sessions without this proof must refresh after
email verification. The exact existing signed backend service identity
(`sub=festio-backend`, `email=system@festio.events`, and literal
`is_platform_superadmin: true`) remains compatible without a human-email claim;
there is no general exception for other super-admin tokens.

Consent is false by default for email, SMS and WhatsApp. A verified lifecycle event
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
Complaints and permanent email bounces suppress email. A public demo request
creates an unverified pending prospect and an assigned review task containing
the requested time/details; it cannot update a lead or confirm a calendar booking. Lead output exposes `automation_paused`,
`suppression_reason`, `last_inbound_at`, and `handoff_requested_at` for a future
operator inbox. A staff review must resolve the reason before explicitly
resuming a lead. No automatic reply, chatbot, or WhatsApp sending is implemented
by these ingress contracts.

### Lifecycle ingress

Service authentication establishes the producer, not ownership of the supplied
email. Public demo requests use the separate unverified capture below.

The backend durable outbox sends the existing platform-authenticated request to
`POST /api/marketing/internal/ingest` with:

- `event_id`: stable, globally unique string of 1–128 characters. Required for
  durable producers and every unverified pending capture. Optional only for
  compatible trusted legacy callers.
- `lifecycle_event`: e.g. `registered`, `signup_consent`, `event_created`,
  `demo_requested`, `activated`, `paid`, or `customer`.
- `email` and optionally `festio_user_id`, `name`, `phone`, `organization` and
  acquisition attribution. `event_type` remains the event category, not the
  lifecycle name. `stage` can supply the corresponding pipeline stage.
- `email_verified`: only literal boolean `true` authorizes email lookup, account
  association, lead creation, contact/attribution updates or effective consent.
  Missing, false and non-boolean values do not establish ownership. A generic
  `identity_verified` field, valid service JWT or loaded account record does not
  substitute for current verified-email proof.
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

An unverified registration, consent claim or unmatched lifecycle event instead
creates a separate `PendingProspect` and owner-scoped review task, atomically
with its receipt. Claimed details and explicit channel flags are retained as
review evidence, not lead identity or effective consent. The event-bound ACK is
`{recorded: true, pending_identity: true, duplicate: false, ingest_duplicate: false,
event_id, unmatched: true, lead_id: null, prospect_id}`. Exact retries return the
same prospect with both duplicate flags true. An eventual verified registration
does not associate this prospect or adopt any earlier consent claims.

The backend uses distinct versioned `verified-email-v2` and `unverified-email-v2`
registration/consent event identities. This prevents an immutable pre-upgrade or
unverified outbox payload from blocking a later verified capture. Verified
consent capture includes only the new request's explicit channel choices.
Older queued events with missing verification follow pending review unless they
are exact previously accepted receipts. Such a historical receipt is ACK-only,
including after lead deletion: its original payload hash must match and no
profile, consent or association is reapplied.

A narrow exception preserves background business milestones for an already
linked, exact `festio_user_id`: `event_created`, `event_updated`, `activated`,
`paid` and `customer` may update only stage, score and activity timing when no
consent fields are present. This path never looks up the claimed email, changes
profile/contact/attribution, applies consent, or associates pending prospects.
Verified updates also refuse a subject whose stored CRM email differs from the
verified email, and a conditional account-link claim cannot replace another
subject that linked concurrently.

### Unverified demo ingress

Public demo requests are captured durably in the backend and sent to
`POST /api/marketing/internal/demo-requests` with the stable `event_id`,
`demo_request_id`, contact details and requested time. This endpoint always
creates an unverified pending prospect and owner-scoped review task, never a
lead. It does not resolve the claimed email/phone against existing leads,
change profile fields or lifecycle stage, pause automation, or change consent
and suppression. Any supplied consent checkboxes are retained only as
`consent_claims` in the review task, not effective lead preferences. Caller
identity assertions are ignored; a later account with matching email/phone
cannot automatically associate this unverified request. Staff review and a
verified association are required before any trusted lead action.

Prospect, task and event receipt commit atomically. The acknowledgement is
`{recorded: true, duplicate: false, unmatched: true, lead_id: null, prospect_id}`.
Retries return the same prospect with `duplicate: true`; conflicting content
under the same event ID returns 409. The requested time is never a booking,
and transactional email continues to say the request is not yet confirmed.

For safe rollout, already-queued `website_demo` / `demo_requested` events at
the old lifecycle ingress are routed to this same unverified capture before
any lead lookup. An exact replay of a demo already committed before the fix
receives an explicit `legacy_demo_receipt: true`, `ingest_duplicate: true`
acknowledgement carrying its original retained lead ID; it repeats no effects and
cannot recreate a deleted lead. This compatibility path does not repair any
profile or consent changes made before the fix.

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
