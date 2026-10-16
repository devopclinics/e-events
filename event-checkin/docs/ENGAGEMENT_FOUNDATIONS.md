# Consent-safe client engagement foundations

This change fixes the capture, consent and scheduling defects found in the
existing acquisition journey. It is a **review/staging candidate**, not a live
rollout or a complete autonomous salesperson. No external messages or production
changes are needed to run the tests.

## Implemented

- Demo requests are saved before acknowledgement, with a durable CRM event in the
  same database transaction. A preferred time is explicitly **not a confirmed
  booking**. The generated calendar hold was removed; transactional receipt and
  operator notification remain separate from marketing consent.
- Demo retry keys prevent duplicate requests for a retried submission; conflicting
  payloads using the same key are rejected. The public endpoint is rate-limited.
- Signup, event and revenue lifecycle events use a persistent backend outbox. HTTP
  failures, timeouts and unmatched CRM identities retry with backoff, then remain
  available as failed records for operator recovery. They never run provider HTTP
  in the business request. Successful payloads are reduced to tombstones, not kept
  indefinitely with contact details.
- CRM ingestion uses stable event receipts committed atomically with its effects.
  Repeated events do not duplicate tasks/activity or replay consent. A delayed
  signup event cannot move a customer backwards in the lifecycle.
- Email marketing consent is an optional, unchecked checkbox for password signup,
  Google signup and demo requests. SMS and WhatsApp consent are separate and are
  never inferred from a phone number, registration or a transactional email.
  Forms omit channels they do not ask about, preserving existing preferences.
- The email scheduler calls a plain service function rather than a FastAPI route.
  Only successful sends advance a sequence. Seeded cumulative delays are honored.
  Durable send claims and stable Resend keys prevent duplicate concurrent sends;
  ambiguous delivery outcomes pause for reconciliation instead of blind retry.
- Sales chat, email and WhatsApp inbound events feed durable prospect/handoff
  records. Verified Meta sender identities and signed, sender-matched email reply
  tokens can pause an existing lead; opt-outs revoke only the relevant channel.
  Self-reported chat identities and unbound email From addresses never mutate
  existing leads. New or unverified contacts remain separate, owner-scoped
  prospects for human review, without fabricated email addresses. No message
  body is forwarded to an LLM or retained by these new ingress adapters.
- Public sales chat is separately configured and OFF until its dedicated inbox
  is reviewed. It receives no organizer identity, tenant attributes, current page
  URL or authenticated context. Existing signed organizer support stays separate.
- The previously exposed credential-bearing file is removed from the proposed
  tree, ignored for future additions and checked by CI. This does **not** revoke
  the credential or remove it from prior Git history.

## Rollout switches: default OFF

| Component | Setting | Default |
| --- | --- | --- |
| Marketing sends, including campaigns/SMS/social | `MARKETING_OUTBOUND_ENABLED` | `false` |
| Backend CRM outbox dispatch | `MARKETING_OUTBOX_ENABLED` | `false` |
| Prospect webhook ingestion | `PROSPECT_INGRESS_ENABLED` | `false` |
| Public website sales chat | `VITE_SALES_CHAT_ENABLED` | not enabled |
| Public inbox validation acknowledgement | `VITE_SALES_CHAT_INBOX_VALIDATED` | not enabled |

Existing transactional confirmations, invitations and authenticated organizer
support are not marketing consent and are not turned off by these flags. The
Marketing send gate intentionally also covers its existing direct campaign/SMS/
social endpoints, so deploying this code without enabling it will stop those
Marketing sends. The prior staging consent-bypass setting is no longer honored
by the runner, even if an existing deployment manifest still defines it.

For migration verification, also explicitly set `MARKETING_SCHEDULER_ENABLED=false`.
That existing scheduler defaults to enabled and runs retention purges as well as
outbound work; `MARKETING_OUTBOUND_ENABLED=false` alone does not stop retention.

Backend engagement-only settings live in `app/engagement_config.py`, using the
same environment variable names listed here. Flags default to false and new
webhook credentials default to blank. Legacy database configuration and existing
Compose manifests are unchanged; this patch does not provision or rotate any
database credentials. Deployment manifests must explicitly wire reviewed gates
when enabling a later phase. Missing gate variables remain OFF.

## Destination-specific configuration

Do not paste credentials into source files, logs, chat, screenshots or this document.
Use the existing deployment secret-management process, with separate approval for
credential replacement or new persistent access.

- Meta: `META_WHATSAPP_APP_SECRET` verifies the raw-body `X-Hub-Signature-256`;
  `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` is mandatory for the verification challenge;
  `META_WHATSAPP_SALES_PHONE_NUMBER_ID` restricts capture to the dedicated sales
  number. Route: `POST /api/webhooks/whatsapp/meta`. Guest/event-number traffic is
  ignored. This route is an ingress adapter, not a new WhatsApp sender.
- Chatwoot: configure the **separate public sales inbox**, not the authenticated
  organizer support inbox. `PROSPECT_CHATWOOT_ACCOUNT_ID`,
  `PROSPECT_CHATWOOT_INBOX_ID`, and `PROSPECT_CHATWOOT_WEBHOOK_TOKEN` restrict the
  inbound webhook. Route: `POST /api/webhooks/prospects/chatwoot?token=...`.
  Exclude the query string from proxy/access logs. Incoming public messages only;
  private notes and outbound messages cannot loop into the workflow. Anonymous
  visitors are captured by provider contact ID as separate pending prospects;
  supplied email/phone are unverified claims, not permission to merge accounts.
- Resend sales replies: `RESEND_INBOUND_WEBHOOK_SECRET` and
  `PROSPECT_EMAIL_RECIPIENTS` (comma-separated receiving addresses).
  Route: `POST /api/webhooks/prospects/resend`. Only verified `email.received`
  metadata addressed to this allowlist is ingested. To bind future campaign
  replies, configure `MARKETING_REPLY_DOMAIN` on Marketing and allowlist
  `reply@that-domain` on the backend. Marketing adds a signed, opaque Reply-To
  local part; only a valid token **and** matching intended sender can pause the
  existing lead. The token signature preserves case and contains no contact
  details. An unbound From address creates a pending prospect, never a grant or
  change to someone else’s preferences. A body-only opt-out is not classified
  from metadata, but a bound reply still pauses all follow-ups for human review.
  The unsubscribe URL remains available. Do not replace the separate guest
  Experience inbound route.
- Website: separate `VITE_SALES_CHAT_BASE_URL` and
  `VITE_SALES_CHAT_WEBSITE_TOKEN`, plus the two explicit gates above. These are
  build-time settings, not proof that the inbox is safe or reachable.
- Backend/Marketing service-to-service authentication continues using the existing
  scoped JWT contract. No new vendor, account or key is required by the code.

## Controlled staging checklist

1. Owner revokes/replaces the exposed credential and audits its usage separately.
   Decide separately whether to rewrite public Git history; deletion in this PR
   does not make the old credential safe.
2. Back up backend PostgreSQL and the Marketing SQLite database, review additive
   table/column migrations, and run them against staging copies. Use a consistent
   SQLite backup rather than copying a live database file. The backend's existing migration mechanism creates
   `marketing_outbox` and `demo_requests`; Marketing creates its new receipt,
   pending-prospect and claim tables plus additive lead fields.
3. Keep outbound OFF. Enable CRM dispatch only against the updated staging
   Marketing service. Submit a test signup/demo and verify one durable lead/task,
   no marketing grant by default, and no confirmed meeting/ICS.
4. With explicit test identities, enable the dedicated inbound destinations. Send
   signed fixtures first, then authorized test-provider messages. Verify duplicate
   webhooks are harmless, wrong inboxes/numbers are rejected or ignored, and
   replies/STOP/handoff requests prevent further sequence sends.
5. Validate actual Chatwoot-version compatibility and browser isolation. Cover
   anonymous → signup → logout, two different organizer accounts, Close/Back/
   Forward, repeated opens, route changes and delayed identity responses. Ensure
   neither old support history nor organizer data reaches public sales chat.
6. Review approved sales knowledge, pricing/offer constraints, qualification
   questions, handoff ownership, channel preferences and all outbound templates.
   Existing support knowledge is not automatic approval for sales commitments.
7. Only after a separate rollout decision, enable outbound to a tightly controlled
   explicitly opted-in cohort. Check actual delivery, opt-out suppression, pause
   on reply, provider retry behavior and operator visibility before expanding.

## Marketing SQLite migration and rollback safety

Importing `app.main` runs schema creation, additive column migrations, backfills
and seed updates. Before any of those writes, a read-only preflight checks for
duplicate case-normalized email groups in an existing `marketing_leads` table.
If any exist, startup aborts with only the group count and a manual-review
instruction, never email addresses or other contact details. All leads,
activities and schema remain intact. Automatic duplicate-lead deletion and
activity reassignment have been removed; there is no bypass flag. A clean
database proceeds to the existing unique-index creation. Keep other writers
stopped during migration rather than relying on the preflight as a concurrency
lock.

Use a consistent SQLite backup or a cleanly quiesced volume snapshot before
starting the new image, and rehearse startup/restoration on a disposable copy.
Do not copy only a live database file while ignoring its possible journal/WAL.
Startup spans multiple commits, not one all-or-nothing versioned migration, and
no down migration is supplied. Restoring an older backup can lose newer consent,
suppression, prospect, receipt and send-claim records; keep backend dispatch and
inbound capture stopped until those records and the outbox are reconciled.

An old Marketing image does not understand the new outbound/scheduler gates or
pause/suppression fields. An image rollback can therefore resume messages even
when the new flags are false. Do not start it without independently verified
outbound blocking or a safe rollback build. Existing-database upgrades add the
new non-null lead booleans with SQL defaults, but fresh databases created by the
new ORM have application-side defaults only; an old image may fail inserts on
that fresh schema. Preserve the existing internal signing secret during rollout:
it also derives social-credential encryption and signs email reply routes.
Credential rotation requires its own reviewed plan.

## Remaining work before end-to-end autonomy

- A production-tested, approved-knowledge sales responder/qualification workflow
  and human handoff ownership across the three channels, including verified
  account association for public-chat contacts. The new code centralizes
  safety state, not full conversation transcripts or a new autonomous AI sender.
- WhatsApp sales sender/template approval, service-window handling and explicit
  WhatsApp opt-in collection. Existing guest WhatsApp messaging is not reused as
  a prospect campaign channel.
- Actual calendar availability, real meeting creation/link and verified booking
  confirmation. Until configured, a demo remains a request for a human to arrange.
- Operational dead-letter recovery/alerts, database retention/deletion policy for
  pending/failed outbox events, pending prospects and demo requests, and staging Postgres locking/
  migration validation. SQLite tests do not prove production concurrency behavior.
- Deployment configuration and provider credentials. No live configuration,
  credential rotation, account creation, external sends, merge or deploy is part
  of this implementation.

## Local verification

Use disposable databases and synthetic secrets, never deployed `.env` files.
Tests disable/mimic provider transports. Run services in separate Python
processes because both use a package named `app`.

```sh
cd event-checkin/backend
python -m pytest -q
cd ../marketing-service
MARKETING_SCHEDULER_ENABLED=false MARKETING_OUTBOUND_ENABLED=false python -m pytest -q
cd ../frontend
node --test tests/*.test.mjs e2e/*.test.mjs $(find src -name '*.test.mjs')
npm run build
npm run check:help-content
npx playwright test --list
cd ..
CONTRACT_EXPORT_MODE=local PYTHON_BIN=python bash frontend/scripts/check-api-contract-drift.sh
```

Provider references used for the adapters:
- https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/
- https://github.com/chatwoot/chatwoot/blob/develop/app/models/message.rb
- https://resend.com/docs/webhooks/introduction

## Review and execution limits

- Independent review covered signature verification, soft-bounce propagation,
  first-contact capture, spoofed public identities, overlapping send claims,
  cross-owner handoff access, channel-specific preferences and consent evidence.
- Node tests exercise protocol filtering and teardown; they do not prove visual
  behavior. The nine local browser fixtures could not execute here: sandboxed
  Chromium could not create its sockets, and the available cloud browser could
  not reach the fixture (`ERR_CONNECTION_REFUSED`). No restriction was bypassed.
- The complete backend suite has existing failures outside this change. The same
  failure set was reproduced from an isolated clean-base snapshot. Do not present
  a focused pass as a green full suite; see the PR validation summary.
- OpenAPI regeneration also reconciles previously stale generated fields. Those
  unrelated runtime schemas were not changed by this implementation.

### Initial snapshot validation (2026-10-16, `70c5cff`)

- Backend: 741 passed, 12 failed, 1 expected failure. All 12 failures were also
  reproduced from clean base `0e86e7b1b650f67eccc3168cd41046334a22e4c7`:
  two calendar resolution tests, household bulk assignment, feedback reminders,
  five RSVP answer/deduplication/export tests, and three website-editor contract
  tests. No new failures were introduced by this patch.
- Final attribution-length guard: 31 focused capture/Resend tests passed after
  the full-suite run.
- Marketing: 44 passed, including scheduler invocation, failed-send retry,
  idempotency, consent, handoff, owner isolation, reply-token routing and races.
- Frontend: 143 Node tests passed; production build and help-content checks passed.
  Playwright discovery passed (132 existing scenarios and 9 isolated engagement
  scenarios); browser execution remains unverified for the reasons above.
- OpenAPI snapshot/generated types matched after regeneration. Credential filename
  guard, selected-source credential-pattern scan and whitespace checks passed.
- No real provider messages or production changes were made during verification.


### Reconciliation with newly merged main

The engagement patch was replayed onto main
`15fe07d01854910183d7cb564cf6c865552d4702`, while retaining the tested
`70c5cff` snapshot separately. The new GuestHub/external-website fields and
validation, organizer workspace navigation, and scrolling community tiles are
preserved. No new-main-only source files were overwritten.

The only source conflict was the Pydantic import list; both main's URL validation
imports and the explicit-consent `StrictBool` import are retained. Generated API
contracts were regenerated from the combined source and pass the drift check.
Main already had a failing API-contract drift run at this base commit; stale
generated fields are not new runtime changes from the engagement patch.

Separate server-only Academy/knowledge/reference work has not been folded into
this engagement change. It remains preserved in the server's existing branch
for a separate review. Current main's newer support knowledge and media are
unchanged; this patch does not release Academy content or customer media.

Reconciled validation (`0c4f442`):

- Backend: 757 passed, 12 failed, 1 expected failure. A separate clean-main
  snapshot reproduced exactly the same 12 failures (46 other affected cases
  passed); there are no branch-only failures.
- Marketing: 44 passed using fresh pinned dependencies and isolated test storage.
- Frontend: 163 Node tests passed, including new-main navigation, presentation,
  contrast and model coverage. Production build, guide/help checks, and both
  Playwright discovery lists passed. Browser execution remains unverified.
- API-contract drift, conflict-marker and whitespace checks passed. Independent
  read-only reconciliation review found no remaining concrete blocker.
- This result is local only. No remote branch/PR, merge, deployment, provider
  messages, server-file changes or Academy/media release occurred.


### Final safety refinements

Legacy `app/config.py` and both Compose manifests are unchanged from main. New
engagement-only configuration is isolated in `app/engagement_config.py`; all
existing environment names are retained, gates default OFF, and ingress secrets
default blank without falling back to the legacy Meta verification default.
No database password defaults or role-provisioning behavior were changed.

Marketing now refuses duplicate normalized-email groups before any schema,
backfill or seed writes. It reports only the group count and retains every lead
and activity for manual review instead of silently consolidating/deleting them.

Final checks: 761 backend tests passed with the same 12 clean-main failures and
1 expected failure; 58 focused capture/configuration/webhook tests passed;
46 Marketing tests passed, including duplicate-database preservation. The
163 frontend passes/build remain applicable because no frontend source changed.
API artifacts are byte-identical to the previously verified contracts and drift
passes. Independent review cleared both safety refinements.
