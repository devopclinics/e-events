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

### Initial implementation verification (superseded by review below)

| Check | Result |
| --- | --- |
| Selected affected Backend regression | 543 passed |
| Full Marketing regression | 294 passed |
| Final journey/worker slice (including latest multi-day context) | 32 passed |
| Final source/context/copy/commerce slice | 13 passed |
| Final authenticated ingress/timestamp/STOP slice | 29 passed |
| Full ticketing regression | 30 passed |
| Selected frontend regression | 91 passed |
| Frontend production build/postbuild | Passed; existing large-chunk advisory only |
| Combined patch whitespace review | Passed |

The final changed slices were run after the last source/renderer changes; counts
overlap with the broad suites and must not be summed as unique test cases.
Synthetic source acceptance covers actual business producers to the actual
Marketing consumer. Worker integration uses HTTP MockTransport for the actual
Chatwoot/Bird/notification adapters, and mocks existing email delivery. Real
HTTP/SMTP/provider transport is denied by the service test fixtures.

### Adversarial review follow-up

Reviewed original delivery commit `53201450e6e6fe49824b49d1d9475d9abbd627af`
against the requested failure modes. This was an adversarial self-review, not a
separate reviewer's approval. Recoverable findings were closed locally:

1. Notification HTTP 408/409/425 could have been treated as known rejection.
   They now remain uncertain and never auto-retry. Synthetic transport tests
   assert one request, held receipt and continued takeover suppression.
2. The shared email dispatch and automation ledgers had the same ambiguous-HTTP
   classification gap. Both now hold these responses as uncertain, pause the
   lead and open a handoff. Repeated ticks cannot resend.
3. Retention acceptance and job bookkeeping had a crash boundary. Each job now
   stores its immutable sequence identity. Recovery derives accepted/uncertain
   state from its own durable email claim and creates a deterministic audit
   activity once. A paused lead stays paused. A changed sequence cannot replay
   an old event's job. Missing checkpoint identity becomes review-required,
   without guessing or backfilling consent/enrollment.
4. Reviewed contextual templates could have used the existing legacy email mode.
   They now explicitly require pilot/test mode; retention still requires pilot
   mode plus its own gate. A regression enables legacy scheduler/outbound flags
   while disabling pilot/test and asserts zero provider calls. Legacy tests
   explicitly model preserved, non-migrated stored templates rather than opting
   them into the reviewed journey.
5. Added a native existing-Chatwoot staff-notification adapter in addition to
   the configured HTTPS receipt sink. It posts a private staff note to a reviewed
   account/conversation URL, with a separate staff API token and idempotency key.
   Provider acceptance is not owner acknowledgement. No new receiver or paid
   service is required when using this native mode.
6. Full checks exposed two pre-existing Windows portability defects: CRLF parsing
   in a frontend Dockerfile-contract test, and Unix-only public programme date
   directives. Both were corrected without changing live release flags. Timestamp
   parameter IDs are now stable across isolated pytest workers.

Original delivery scope was exactly 55 files. Review adds three paths:
`event-checkin/backend/app/routers/public_sites.py`,
`event-checkin/frontend/tests/engagement-foundations.test.mjs`, and
`event-checkin/marketing-service/tests/test_engagement_reliability.py`.
The final manifest contains 58 files; the original 55 remain available at the
reviewed commit. No publication/deployment or server-worktree change occurred.

### Complete suite scope and Windows limits

The earlier 543 was an affected-file selection, not the full Backend suite.
The full current collection has **1,273 cases**, versus the cited previous
1,258: six source acceptance cases, two outcome/ownership cases, six new ingress
cases and one new default-config parameter account for the 15-case increase.
No old cases were removed to produce the 543 selection.

The first unmodified full Windows invocation completed with 468 passed,
9 failed, 1 xfailed and 795 setup errors. The initial error was the unchanged
`test_auth_acquisition_capture.py` socket guard blocking Windows asyncio's local
self-pipe construction; subsequent pytest runner setup cascaded. Eight isolated
config tests also omitted Windows `SystemRoot` from their deliberately minimal
child environment and failed importing `_overlapped` (WinError 10106). The ninth
failure was the portable programme-date formatting issue fixed above.

A host-only helper at `verification/festio_windows_test_host.py` initializes
pytest's Windows loop before each module's network guard, and supplies only
`SystemRoot` to explicitly isolated child environments. It does not remove or
weaken the socket guards, copy credentials, change deployment configuration or
permit provider HTTP/SMTP; real provider transports are additionally rejected.
It is outside the application patch. UTF-8 mode is required on this Windows host.

Run all Backend cases with:
`PYTHONPATH=<task>/verification python -X utf8 -m pytest tests -p festio_windows_test_host -n 4 --dist loadfile -q -W ignore --tb=short`.
`pytest-xdist` is a task-local test dependency only; application dependencies and
lockfiles were not changed. A first parallel collection attempt found dynamic
IDs on the four timestamp cases; those IDs are now fixed, with no case removal.

Three unchanged acquisition tests still encounter the strict socket guard while
ASGI TestClient creates a new Windows portal loop. The traceback is in stdlib
`proactor_events._make_self_pipe -> socket._fallback_socketpair`, before the
Marketing request. The guard is preserved; these cases need a compatible test
runtime for a clean pass:

- `test_existing_user_verified_upgrade_preserves_acquisition_without_header`
- `test_new_verified_user_retains_real_acquisition_or_create_only_default[None]`
- `test_new_verified_user_retains_real_acquisition_or_create_only_default[attribution1]`

The existing non-strict xfail is
`test_experience.py::test_room_assignment_step_assigns_table_group_seat_and_sends_email`:
its pre-existing reason concerns room-name email rendering and duplicate builders.
It was not relabelled or hidden. No browser permission was bypassed.

Full Support tests require only process-local `DATABASE_URL=sqlite+aiosqlite://`,
`REDIS_URL=redis://127.0.0.1:1/0`, `SUPPORT_RUN_WORKER=false`, UTF-8 mode, and real
HTTP/SMTP rejection. No live settings or files were changed for these tests.
Full frontend command is `node --test tests/*.test.mjs`; build remains
`npm run build`. Full Marketing/Ticketing commands are `python -m pytest tests`.

Final review results supersede the earlier selected counts: Marketing **304
passed**; Support **37 passed**; Ticketing **30 passed**; frontend **148 passed**;
frontend build/postbuild passed. Full Backend result is recorded with final
handoff evidence after its complete run. Overlapping slices are not summed.

Complete Backend execution finished all 1,273 cases: **1,268 passed, 4 failed,
1 xfailed** in 584.24 seconds with four isolated workers. Three failures are the
unchanged Windows TestClient cases listed above. The fourth was an en-dash
separator regression introduced while making the programme date format portable;
it was corrected to preserve the original output. The final complete
`test_public_site_connections.py` + `test_website_editor_contract.py` rerun passed
**12 tests**. No remaining product failure was found; a clean pass for the three
strict-socket TestClient cases still needs a compatible runtime. The full-suite
result is reported as actually run, not rewritten as an all-green full run.

Final full Marketing result is **304 passed**, including the native staff note,
legacy-mode block, both-ledger HTTP uncertainty and retention recovery cases.
Full Support **37 passed**, full Ticketing **30 passed**, full frontend **148
passed**, and build/postbuild passed. Raw logs and the host-only helper are in
`<task>/verification/review-*` and `festio_windows_test_host.py`. No command is
stalled or awaiting permission. No live provider/browser coverage is claimed.

Invitation first-value evidence is deliberately limited to authenticated final
Resend delivery with exact event/guest/invitation tags. Provider acceptance and
legacy unsigned guest-provider status callbacks never create first value. The
operational Bird public-sales response adapter is separate; sending an anonymous
sales reply is not a guest invitation outcome or an account-linking signal.

### Final owned source routing and transport identity review

The final operational check found that purging accepted reply targets could leave
an assigned handoff operator without a usable conversation pointer. Unresolved
sales cases now retain only encrypted authenticated routing metadata, not message
content or a guessed Festio identity. Assigned operators/superadmins may explicitly
read it through the audited case-context endpoint. Other operators/viewers are
denied; normal backlog responses do not expose it. The staff UI can open the
approved original Chatwoot conversation or display verified WhatsApp source
routing, current takeover/opt-out state and guidance consent. Resolution clears
the encrypted context; a new inbound receipt while paused reopens the owned case
without resuming responses. No automated account lookup or staff reply was added.

Queued targets now store a transport-authority fingerprint: chat host/account/
inbox, or WhatsApp workspace/sender/destination. Dispatch refuses to retarget a
queued message after that mapping changes. Staff source links also fail closed
when the current mapping differs from the recorded authority. Old targets lacking
this binding are held rather than guessed or backfilled.

The final full Marketing run after these changes passed **306 tests**; final
frontend run passed **148 tests** and build/postbuild passed. The preceding owned
handoff/journey slice passed **43 tests**. Full Backend, Support and Ticketing
results and the three unchanged Windows TestClient limits above still apply;
there were no later Backend product changes after the 12-test schedule correction.
The final changed-file scope remains 58. All deployment gates remain OFF.
