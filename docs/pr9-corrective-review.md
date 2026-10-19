# PR9 corrective review: deployment hold

Baseline: merged PR9 `a57f28fc01e0de6864fbf8ae5e126a947de5957d` (same application tree as approved `8bec854`). All fourteen exact inline comments from review 5569202615 were read as technical evidence and independently checked. All are confirmed; none is dismissed. This branch is corrective work only. Keep deployment and all messaging gates OFF. The corrective PR must remain draft for parent verification; it must not be merged by this task.

## Comment dispositions and reproductions

| PR9 inline comment | Disposition / correction | Regression evidence |
|---|---|---|
| 4312042893: explicit unknown Event provenance | Confirmed. Boolean evaluates_none retains explicitly supplied NULL; omission still defaults False. | test_pr9_provenance_readiness: fresh-session Event/Guest insert round trips and actual historical-event duplication; historical copies emit no real milestones. |
| 4312042964: explicit unknown Guest provenance | Confirmed. Same NULL-preserving type for Guest, without SQL defaults or historical classification. | Same round trip separately asserts unknown Guest NULL and omitted-new Guest False; existing outcome acceptance excludes unknown guests. |
| 4312043023: blocked queue starvation | Confirmed. Persist queue scheduling before dispatch, order never-attempted/old work first, remove terminal work and exclude exhausted notification attempts before LIMIT. | test_pr9_corrections: >20 blocked replies and missing-owner handoffs still allow the later valid row; exhausted cases do not occupy batch. Adjacent repair query filters existing cases before LIMIT, covering twenty existing cases plus the missing twenty-first. |
| 4312043070: stop during context HTTP | Confirmed. Fresh persisted eligibility and template approval are rechecked after all context I/O, at provider submission. Known-unsent claims are cancelled. | Ten separate-connection barrier cases: unsubscribe, consent withdrawal, human takeover, changed recipient and changed account, each for onboarding and retention; zero provider calls. |
| 4312043157: PostgreSQL step overflow | Confirmed. BIGINT model and idempotent in-place PostgreSQL widening preserve checkpoint/dispatch identities. | Actual disposable PostgreSQL 16 migration preserves existing 2147483647 and inserts/reads 281474976710655; repeated migration succeeds. Normal suite also checks PostgreSQL DDL and SQLite 48-bit identity. |
| 4312043229: distinct replies race | Confirmed. A conversation-keyed durable guard atomically admits one reply and reserves its current-hour budget. Random attempt tokens fence stale workers; unresolved outcomes never expire automatically. | Two real SQLite connections synchronize after both observe no unresolved reply. Only one provider call proceeds. Process-death and blocked-readiness/reconcile/reclaim tests preserve unknown holds and prevent a stale worker submitting or overwriting newer state. |
| 4312043280: staging free checkout | Confirmed. Free orders include the environment in persisted provenance; only production non-fake free orders are real. | Five actual SQLite create_order/read-back cases, fulfillment mocked. Unchanged merge fails both staging Stripe/Paystack cases. |
| 4312043334: stale readiness revision | Confirmed. Hash includes checkout/menu timing/invite mode/token/deadline and related persisted check settings; invite-settings and token-rotation routes publish configured evidence transactionally. | Seven setting-change revisions and actual mutation-route evidence assertions fail on baseline and pass corrected. No raw share token is emitted. |
| 4312043372: valid guide routes | Confirmed. Add actual registered workspaces, website subroute and the other literal recipe destinations. | Every literal guide recipe route is checked against App registration and safe navigation; authenticated same-event links succeed, wrong-event links fail. |
| 4312043420: wrong invitation enum | Confirmed. Use backend enum closed, not manufactured personal. | Existing six mode fixtures now use closed; baseline fails closed RSVP/private-list guidance. |
| 4312043460: authenticated deep-link event | Confirmed. ProtectedRoute verifies URL event access and selects it before mounting workspace children, including already-authenticated visitors. | Real component executed in VM: A-selected/B-requested never mounts A tasks, valid B selects B, unavailable/wrong-tenant B shows an error without switching. |
| 4312043495: missing_owner recovery | Confirmed. Notification CAS includes missing_owner after checking active operator access. | Existing inactive owner becomes active on a separate session; notification resumes without reassignment. |
| 4312043547: pre-send context failure | Confirmed. Transport, non-200, malformed JSON and invalid proof fail as EmailBlocked before submission, so ledger cancels rather than requiring provider reconciliation. | Timeout and malformed-response tests for onboarding and retention, deliberately after reservation; provider count zero, claims cancelled. |
| 4312043585: cap only at preparation | Confirmed. Durable current-hour attempt reservation shares the conversation admission transaction. Existing current-hour attempts are conservatively accounted for when initializing the guard. | Four prepared in hour A plus two in B cannot flush six in B: four provider attempts, two deferred, then allowed next hour. Preparation lifetime cap remains unchanged. |

Tests use synthetic data, file-backed SQLite and explicit barriers/controlled clocks, not timing sleeps. Provider acceptance, process death and reconciliation remain mock-only. The PostgreSQL test uses only existing local images, an isolated loopback namespace, no host ports and disposable scratch data; the test database was stopped/removed afterward. No production runtime, credentials, identities or settings were accessed or changed.

## Validation record

Application source checkpoint d8d887e: complete isolated Linux Marketing 350 passed (one optional PostgreSQL test skipped in the network-disabled normal run), Support 37 passed, Ticketing 35 passed. The dedicated real PostgreSQL run separately passed its one migration/round-trip test. The complete Backend result and exact final head are recorded in the corrective PR verification comment after completion. Final frontend 189 tests and production build passed, including all literal guide routes. Hosted CI and review must complete at the final PR head.

Red evidence against unchanged merged application code: Marketing 24 failed / 4 passed in the selected reproductions; Backend 10 failed (normal asyncio-auto setting); staging free-order 2 failed / 3 passed; frontend component/route red results are in task verification. These failures are intentional pre-fix evidence and are not claimed as successful final tests.

Existing default-OFF gates, 1–10 immutable pilot, single test recipient, suppression, consent, template approval and global caps remain in force. New guard/schedule tables are additive. PostgreSQL step widening is the only existing-checkpoint type migration; it changes no IDs, enrollment or provenance. Review and final-head CI completion must be checked separately; green CI alone is not review completion.

## Exact corrective scope

- docs/pr9-corrective-review.md
- event-checkin/backend/app/models.py
- event-checkin/backend/app/routers/events.py
- event-checkin/backend/app/services/marketing_client.py
- event-checkin/backend/tests/test_pr9_provenance_readiness.py
- event-checkin/frontend/src/components/ProtectedRoute.jsx
- event-checkin/frontend/src/pages/organizerGuidance.mjs
- event-checkin/frontend/tests/organizer-return-gate.test.mjs
- event-checkin/marketing-service/app/email_pilot.py
- event-checkin/marketing-service/app/journey_context.py
- event-checkin/marketing-service/app/journey_workers.py
- event-checkin/marketing-service/app/main.py
- event-checkin/marketing-service/app/organizer_journey.py
- event-checkin/marketing-service/app/retention.py
- event-checkin/marketing-service/app/sales_responses.py
- event-checkin/marketing-service/tests/test_journey_workers.py
- event-checkin/marketing-service/tests/test_pr9_corrections.py
- event-checkin/marketing-service/tests/test_pr9_postgres_checkpoint.py
- event-checkin/ticketing-service/app/main.py
- event-checkin/ticketing-service/tests/test_pr9_free_provenance.py
