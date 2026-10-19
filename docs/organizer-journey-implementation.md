# Festio organizer journey implementation and acceptance

Base: public `devopclinics/e-events` main
`93e8919c87b4b9a15ba5c1437f224a76b2836230`.
Task-owned checkout: `festio-journey`, branch `codex/organizer-journey`.
No unrelated server repository/worktree was changed. No push, merge, deployment,
real message/account/guest write, live configuration or credential change,
historical enrollment/consent backfill or paid service was performed.

## Implementation plan and completed slices

1. Separate configuration, scoped readiness/rehearsal and source-backed outcomes.
   Add explicit new-record provenance, transactional business producers and durable
   deduplicated consumer receipts; recheck current ownership before dispatch.
2. Connect checklist/date/timezone guidance and authenticated CTA returns. Preserve
   the guarded email pilot; offer factual copy through explicit stored-template
   review rather than rewriting production data.
3. Make human handoff durable and accountable, with assignment, notification,
   acknowledgement/resolution, audit, uncertainty reconciliation and staff UI.
4. Distinguish Event Pass acquisition, attendee orders/ticket sales and recurring
   starts/renewals. Add separately gated organizer retention through existing caps.
5. Implement bounded public chat/WhatsApp state, fixed factual knowledge, consent,
   encrypted transport binding, dispatch/retry guards and restart-safe claims.
6. Exercise source-to-consumer and worker-to-provider paths with synthetic
   databases/ASGI/mocks, review the patch and package exact scope/evidence.

## Acceptance matrix

| Request | Implementation/evidence | Acceptance boundary |
| --- | --- | --- |
| 1 Lifecycle | Feature toggles emit configured. Event/use-case evidence separates configured, ready, rehearsal, first value, complete, cancelled and repeat. Ready is tied to the current event configuration revision; changing configuration invalidates old readiness. Historical activated stages never create outcome evidence or end onboarding. Paid organizers continue event onboarding until actual completion. | Source/Marketing and worker regression tests; readiness describes recorded checks, not launch approval. |
| 2 Milestones | CSV import, signed final invitation delivery with exact event/guest tags, real RSVP, successful scanner admission, explicit event completion and new/copy event creation capture durable outbox records in source transactions. Existing state is derived as sets, so duplicates/out-of-order delivery cannot regress. Exact active organization owners are revalidated before delivery; revoked records are cancelled unsent. | Six synthetic backend acceptance cases bridge actual sources/outbox into the actual Marketing consumer; test/unknown provenance, duplicate outcomes and wrong ownership fail closed. |
| 3 Guidance | Existing `guideChecklists.mjs` tasks remain the source for contextual UI next steps. Event-local day/timezone prioritizes operations or closeout; date alone never completes an event. Reviewed email copy links to a scoped next task. Login retains only safe allowlisted local returns and validates requested event membership. Guidance does not send invitations or buy anything. | Frontend pure/component harness tests and build; backend tenant guards. Live browser QA unavailable. |
| 4 Handoff | Matched replies open durable cases with assigned active operator/configured owner, notification generation, bounded attempts, acknowledgement/resolution/history/backlog. Configured HTTPS adapter uses idempotency receipts. Unknown outcomes/restarts remain held. Staff UI exposes missing owner/failed/uncertain state, reconciliation and separate explicit resume. | Mocked worker tests cover notification retry/uncertainty/reassignment races. Real sink configuration and operator ownership are activation prerequisites. |
| 5 Copy | Four registration and three setup factual review candidates include safe relevant CTA. No unsupported scale, setup-time, event-live or free-call promises. Existing stored edits are preserved. Explicit superadmin compare-and-set migration returns new fingerprint; content/renderer changes invalidate approval pins. Existing unsubscribe and tracked Reply-To retained. | Marketing copy/migration/pilot suites. Stored production template review and new pins required; seeds do not update stored production templates. |
| 6 Commerce/retention | Typed deduplicated ledger separates positive Event Pass acquisition, attendee orders, net ticket sales, subscription starts/renewals, free orders, event completion and repeat. Provider live/amount/currency proof is required. Organizer-only post-event guidance uses current signed ownership, explicit real completion, cancellation guard and a separately OFF retention category through the same immutable pilot/caps/consent/claims. | Source commerce and worker retention tests. No inferred historical purchase/consent enrollment. Guest thank-yous remain separate. |
| 7 Chat/WhatsApp | Existing authenticated Chatwoot/Meta ingress queues minimal fixed intents without transcripts/account lookup. Four replies/hour, six total and three known-failure attempts; private identities never linked by email/phone alone. Fixed Chatwoot/Bird adapters use encrypted target metadata, exact destination/sender bindings, approved knowledge pin and durable claims. Pending source stops block send. WhatsApp rechecks authenticated window on dispatch/retry with 30-second margin; outside requires applicable consent and approved pinned template. Missing timestamps cannot open a window, but STOP still suppresses. | Actual worker-to-HTTP MockTransport integration and race/restart tests. Business sender, templates/keys/consent and reviewed routing remain external prerequisites. |
| 8 Safety/tests | Funnel/safety endpoint and staff UI distinguish source first value/completion/reuse, commerce, email/reply outcomes and unresolved handoff/provider backlog. Every new gate defaults OFF; email's seven existing gates remain OFF. Provider transport is prohibited in synthetic service tests. | Final verification results below. No claim of live delivery, browser validation or distributed proof beyond tested point-in-time guards. |

## Persistence and provenance

Marketing creates additive evidence, handoff, sales state/reply/target, commerce
and retention-job tables, plus additive checkpoint columns. No historical
activated records become first value. Backend's existing additive migration
mechanism adds nullable Event/Guest `is_test` with **no server default**: old rows
stay unknown and cannot create real outcomes. New explicit records default real;
UI exposes rehearsal-event/test-guest controls and CSV supports `is_test`.
Ticketing adds nullable order provenance in `0011_order_provenance.sql` without
backfill; authenticated live provider receipts establish paid-source provenance.
Rehearsals/test-mode receipts never count as actual guest or revenue outcomes.

Configuration changes have their own evidence version. Completion is an explicit
organizer action, never inferred from the date. Cancelled status is represented
as ended+cancelled to preserve existing guest access gates. Copied drafts carry
no previous outcomes. Multiple organizations/events remain scoped independently.

Uncertain provider outcomes are held for authenticated operator reconciliation.
A resolved human case stays paused until explicit safe resume. No clock, lease
expiry or worker restart automatically resumes takeover. Already-submitted
messages cannot be recalled by a later stop; current state and source backlog
are checked before provider submission. Notification sinks must implement the
provided idempotency protocol; mocks do not establish provider behavior.

## Default-OFF and activation prerequisites

No deployment environment or flag was changed. Existing email pilot is still
an explicit immutable allowlist of 1-10 **new verified organizer IDs**, plus
source proof, recipient/account caps, opt-out/suppression and approved pins.
It never automatically enrolls the next ten, old users, contacts or historical
consent. Retention uses this same cohort and budget, not a new enrollment path.

New gates: Backend `SALES_RESPONSES_ENABLED`; Marketing
`MARKETING_SALES_INGRESS_ENABLED`, `MARKETING_SALES_CHAT_ENABLED`,
`MARKETING_SALES_WHATSAPP_ENABLED`, `MARKETING_HANDOFF_NOTIFICATIONS_ENABLED`,
`MARKETING_ORGANIZER_RETENTION_ENABLED`, `MARKETING_JOURNEY_WORKER_ENABLED`.
All default false, with existing global outbound protection at dispatch.
Manual worker API defaults dry run. No startup sends; clock waits 60 seconds.

Before activation, user review/configuration must supply the exact pilot IDs,
stored reviewed templates and pins (including renderer hash); authenticated
inbound routing/current-owner context and source-backlog readiness URLs using
the existing internal key; an accountable active staff owner and durable
notification destination/token; existing Chatwoot account/inbox/token; approved
Bird sender binding, credentials, WhatsApp templates and applicable consent;
and operational delivery/uncertainty monitoring. Exact configuration/protocol
is documented in `event-checkin/marketing-service/README.md`. No new paid service
or credential was created. The user will deploy; this patch is not activation
or permission for real communications.

## Verification and review

Synthetic temporary SQLite databases, ASGI clients, fixed identities and mocked
HTTP/SMTP transports only. No live provider calls. Windows task-local venv used
existing repository dependencies plus host-only `tzdata`; no dependency/lockfile
changes. Browser initialization was previously blocked by EPERM; no bypass was
attempted and no live browser coverage is claimed. Build is not browser QA.

Final suite results and exact commands are recorded with the delivery evidence.
The backend regression selection covers marketing, organizer, prospect, Resend,
RSVP, invitation, check-in/scanner, checkout/org billing, events, households and
offline manifest. Ticketing tests cover fulfillment/commerce. Frontend selection
covers guide/organizer/signup/marketing/acquisition/readiness/programme/offline.

Patch review is a local self-review, not independent approval. Two small existing
Windows portability repairs are included: portable demo date formatting, and
explicit JSX import extensions to disambiguate case-insensitive helper names.
No tracked AGENTS.md or .agents instructions existed in the public checkout.
The exact changed-file manifest is `docs/organizer-journey-files.txt`.

### Reproducible verification commands

Run each from its service directory with the task-local Python environment.
Provider transports are prohibited/mocked; do not run staging/live scripts.

- Marketing: `python -m pytest tests -q -W ignore --tb=short`.
- Final changed Marketing slice: `python -m pytest tests/test_journey_workers.py tests/test_organizer_journey.py -q -W ignore --tb=short`.
- Backend broad selection (PowerShell):
  `$files=Get-ChildItem tests -Filter 'test_*.py' | Where-Object {$_.Name -match '^test_(marketing|organizer|prospect|resend|rsvp|invite|manual_checkin|section_scanning|checkout|org_billing|event_|households|offline_manifest|scan)'} | ForEach-Object {$_.FullName}; python -m pytest $files -q -W ignore --tb=short`.
- Final source/context/copy/ticketing slice: `python -m pytest tests/test_event_update.py tests/test_organizer_journey_acceptance.py tests/test_ticketing_internal.py tests/test_engagement_config.py -q -W ignore --tb=short`.
- Ingress: `python -m pytest tests/test_prospect_webhooks.py -q -W ignore --tb=short`.
- Ticketing: `python -m pytest tests -q -W ignore --tb=short`.
- Frontend (PowerShell): `$files=Get-ChildItem tests -Filter '*.test.mjs' | Where-Object {$_.Name -match 'guide|guided|organizer|signup|marketing|acquisition|readiness|programme|offline|chat'} | ForEach-Object {$_.FullName}; node --test $files`.
- Frontend: `npm run build`; repository: `git diff --cached --check`.

A preliminary backend run found a test fixture with a stale January provider
timestamp. The implementation correctly refused an automated reply. The fixture
now uses fresh authenticated metadata; missing/malformed/stale/future timestamp
STOP requests have separate regression coverage. No freshness check was relaxed.
Multi-day email guidance uses the event-local end day, matching the UI.
