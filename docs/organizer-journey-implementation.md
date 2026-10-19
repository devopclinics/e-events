# Organizer journey implementation record

Base: public `devopclinics/e-events` main, `93e8919c87b4b9a15ba5c1437f224a76b2836230`.
Task-owned local checkout and branch: `festio-journey`, `codex/organizer-journey`.
No server repository/worktree was modified. No deploy, push, merge, provider
configuration change, real message, historical enrollment or consent backfill.

## Plan and current acceptance

This is a **partial implementation**, not approval to activate the complete
experience. In particular, an endpoint accepting evidence is not evidence that
all business source producers have been connected.

| Requested area | Implemented and tested slice | Remaining implementation |
| --- | --- | --- |
| 1. Lifecycle | Feature toggles emit configured; new/legacy activation ingress cannot graduate a new organizer from event-created onboarding. Separate event/use-case evidence for configured, ready, rehearsal, first outcomes, completion and repeats. Historical lead stages are not backfilled into evidence. | Connect source-backed readiness and completion to the entire journey and email step selection. |
| 2. Milestones | Additive durable evidence table; immutable event fingerprints; duplicate/conflict handling; out-of-order set derivation; explicit synthetic-source rejection; exact-owner capture helper; ownership revalidation/cancellation before outbox dispatch. | Guest import, invitation final delivery, public RSVP, successful check-in, event completion and next-event producers still need explicit synthetic provenance and calls to the helper. No claim of live source capture. |
| 3. Guidance | Existing CHECKLISTS reused for incomplete tasks; event-local date and timezone context; cancelled/past-event guidance; allowlisted CTA routes; authenticated return retained and tenant event list checked after login. | Cross-stage prioritization and browser-level authentication/return QA. |
| 4. Handoff | Matched conversations create durable owned cases; notification adapter contract with failed/uncertain/missing-owner status; backlog; operator assignment, acknowledgement, resolution and history. Unresolved cases prevent explicit resume; resolution itself leaves lead paused. | Wire a real configured notification adapter/worker and an operator inbox UI. Notification delivery is not claimed. |
| 5. Email copy | Four factual registration and three factual setup candidates; no startup rewrite of stored copy; superadmin opt-in migration with compare-and-set fingerprint; changed payload invalidates existing pilot pins. Existing unsubscribe and signed Reply-To send paths retained. | Content review and new immutable production template pins. Seeds do not migrate stored production templates. |
| 6. Commerce/retention | Attendee fulfillment no longer marks organizer customer; only positive Event Pass tier payment advances organizer purchase; no staff fallback when organization has no owner. Distinct evidence categories and separate default-OFF consent/suppression-aware organizer retention guidance; cancelled completion excluded. | Full subscription start/renewal ledger, amount/revenue metrics and source-connected post-event email dispatch through existing caps/approvals. Retention guidance sends zero messages. |
| 7. Chat/WhatsApp | Authenticated existing webhook adapters queue bounded factual intents through durable outbox; no account linking from phone/email; no transcript forwarded. Durable channel state, 4/hour and 6 total turns, stop/human takeover, duplicate and racing dispatch claims, max 3 known-failure attempts, unknown-outcome pause/reconciliation. WhatsApp rechecks authenticated service-window timing on every dispatch/retry; outside requires consent and pinned approved template. | Production transport adapters, durable transport target mapping, dispatch worker and public product UX. Current injected adapter contract is tested with mocks only; no operational autonomous response claim. |
| 8. Safety/verification | Existing email pilot tests plus new journey/channel tests; backend ASGI/SQLite adapter and ownership tests; pure frontend CTA/timezone tests; safety/backlog endpoint. | Complete three-channel browser and source-to-provider end-to-end acceptance; no live browser coverage. |

## Next implementation sequence

1. Add explicit event/guest/source synthetic provenance without historical backfill.
   Connect the six real business outcomes within their source transactions. Preserve
   event/organization/account identity and never count configuration or provider acceptance.
2. Connect factual contextual guidance to the approved email step selector while
   preserving the existing 1–10 immutable verified new-organizer allowlist, consent,
   unsubscribe, suppression, current-owner readiness, daily caps and approval pins.
3. Add the commerce source ledger for Event Passes, attendee tickets, subscription
   starts and renewals. Connect separately consented organizer retention through the
   same claims/caps; keep the retention category OFF.
4. Implement provider-specific transport target mapping and notification/reply
   workers. Authenticate source destination and sender metadata, persist claims
   before calls, and never retry unknown outcomes automatically.
5. Complete operator/product UI and synthetic browser coverage when a legitimate
   sandboxed browser is available. Then review the entire patch before publication.

## New controls (all default OFF)

- Backend `SALES_RESPONSES_ENABLED` controls extra sales-response outbox capture.
- Marketing `MARKETING_SALES_INGRESS_ENABLED` controls internal response preparation.
- `MARKETING_SALES_CHAT_ENABLED` and `MARKETING_SALES_WHATSAPP_ENABLED` require
  the existing `MARKETING_OUTBOUND_ENABLED` gate at dispatch.
- `MARKETING_ORGANIZER_RETENTION_ENABLED` controls organizer guidance eligibility.

No existing deployment environment or gate was changed. Existing email pilot
cohort, scheduler, test and readiness controls are unchanged.

## External activation prerequisites

Only after remaining code and synthetic acceptance are complete: review the
explicit pilot IDs and source ownership evidence; approve/pin stored copy;
configure reviewed staff owner/destination and notification delivery; configure
the existing business sender, approved WhatsApp templates and applicable consent;
verify authenticated ingress routing and provider credentials. No new paid service
is required or authorized. Deployment/publication remains with the user.

## Verification

Tests run in task-local Python virtual environment and frontend Node, using
temporary SQLite/ASGI and mocked providers. Marketing tests reject HTTP/SMTP
transport. Windows required task-local `tzdata`; repository requirements were not
changed for this host-only dependency.

Final commands and results are recorded in the accompanying task response.
No browser session was initialized or bypassed. A frontend build is not browser QA.

Verified commands (run from the named service directory):

- Marketing `python -m pytest -q`: **278 passed**. After final owner/activation
  hardening, `python -m pytest -q tests/test_organizer_journey.py
  tests/test_unverified_account_capture.py`: **86 passed**.
- Backend `python -m pytest -q tests/test_engagement_config.py
  tests/test_prospect_webhooks.py tests/test_marketing_identity_capture.py
  tests/test_marketing_pending_identity_ack.py`: **147 passed**.
- Backend `python -m pytest -q tests/test_organizer_outcome_capture.py
  tests/test_prospect_webhooks.py tests/test_checkout.py tests/test_event_update.py
  tests/test_marketing_capture.py`: **58 passed**.
- Backend `python -m pytest -q tests/test_org_billing.py
  tests/test_ticketing_internal.py`: **18 passed**.
- Frontend `node --test tests/organizer-guidance.test.mjs`: **2 passed**.
- Frontend `npm run build`: **passed**, including generated `dist/guide.html`.
- `git diff --check`: passed.

Validation found and repaired two existing Windows portability issues: demo
request formatting used Linux-only unpadded strftime directives; extensionless
JSX imports collided with similarly named `.mjs` helpers on case-insensitive
filesystems. Those small fixes are included in the scope manifest.

No tracked AGENTS.md or .agents instructions were present in the public checkout.
Patch review was a local self-review, not an independent reviewer approval.
