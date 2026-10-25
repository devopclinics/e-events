# Standalone Meetings

Meetings live at `/meetings` in the organizer workspace. They do not create an
Event, ticket, Guest, registration, or event entitlement. Owners/admins of an
active organization can create meetings and manage only meetings they organize.
As with the existing calendar workspace, a deliberately created organization is
preferred over the legacy shared default organization.

## Organizer and attendee flow

1. Schedule a meeting: title, local start/end, IANA timezone, up to 50 named
   email attendees, online link or physical location, optional agenda/video link.
2. Save draft. Saving never queues mail, including edits to an invited meeting.
3. Preview invitation. Review recipient names/emails, message, calendar
   attachment, and cancellation recipients removed since the last publication.
   Preview does not create response tokens, mutate responses, or queue mail.
4. Explicitly **Send invitations**. The reviewed revision is required. A stale
   revision fails with 409; repeating the same send is idempotent.
5. Each recipient receives an individual email with one ATTENDEE in its calendar
   attachment and personal scoped response links. Opening any link is a safe
   preview; an explicit POST from Accept/Maybe/Decline records the response.
6. Organizer view shows Festio responses and delivery state. Refresh retrieves
   current status. Definite submission failures can be retried explicitly.

Google/Outlook calendar replies are **not synchronized**. Recurrence, free/busy,
calendar OAuth, generated video rooms, and calendar reply ingestion are excluded.

## Calendar and time semantics

Meeting UID is `meeting-{id}@festio.events`, shared across recipients and stable
through every update. The first publication has SEQUENCE 0. Later publications
and cancellation increment SEQUENCE. Current attendees receive METHOD:REQUEST;
removed attendees receive METHOD:CANCEL using the previous published details.
Cancelling uses the same UID and METHOD:CANCEL/STATUS:CANCELLED. No further edits,
invitations or attendee responses can revive a cancelled meeting. Unsent draft
changes do not change the currently published invitation or its response links.

Wall clock start/end and IANA zone are stored together. Calendar DTSTART/DTEND
are UTC instants. Nonexistent spring-forward times fail validation. Ambiguous
fall-back times require an explicit first/second occurrence for start and end.
End must be after start; sending an already ended meeting is rejected. Response
tokens expire 30 days after the published end and are scoped to meeting,
attendee, sequence and purpose. New publication invalidates previous links.

## Persistence and sending safety

Three additive ORM tables (`meetings`, `meeting_attendees`,
`meeting_deliveries`) follow the existing `app.db_migrate` convention: its
`Base.metadata.create_all` creates new tables, including unique constraints and
indexes. There is no data backfill or event-table alteration. Do not run the
migration against a live database as part of local validation.

Publication and outbox rows commit in one transaction. Unique
meeting/attendee/sequence/method keys prevent duplicate logical deliveries.
Organizer edits, responses, cancellation, publication and workers lock the parent
meeting row. A worker persists its claim before I/O, then rechecks the current
version under the same parent lock before sending. Publication supersedes older
queued/claimed/failed deliveries. The bounded provider request holds the meeting
lock, serializing cancellation with an in-flight send.

The initial supported Meetings transport is Resend. It reuses Festio's existing
email shell, provider payload builder, recipient safety guard and shared ICS
builder. It does not use the legacy `_send` wrapper because that wrapper swallows
provider errors and cannot supply a reliable outbox result. SMTP/Bird fallback
is deliberately unavailable for Meetings until an idempotent outcome contract is
implemented. Existing event-email behavior remains on its original path.

Each delivery has a stable Message-ID and Resend idempotency key. Workers never
automatically retry ambiguous timeouts/5xx or interrupted claims. They mark those
`uncertain`; the organizer cannot retry them until an operator reconciles the
provider result. Definite pre-send/4xx failures can be corrected and retried using
the same logical delivery. Provider acceptance is `accepted`, not proof of inbox
delivery. Existing authenticated Resend webhooks record delivered/bounced/failed/
suppressed/delayed/complained receipt status for that exact delivery version.
Out-of-order receipts cannot replace a newer receipt. Unsigned webhooks never
change Meetings receipt state. Bounces are displayed separately from submission
failures; correct the attendee and explicitly publish an update rather than
blindly resending an accepted message.

## Configuration and publication prerequisites

**Sending defaults off**: `MEETINGS_SENDING_ENABLED=false`.
`MEETINGS_SIGNING_KEY` defaults empty; no key is generated by this feature.
Draft/save/preview work with these defaults. The worker starts only when sending
is enabled, and also checks the switch before each delivery.

Before a separately authorized publication:

- Review/merge the feature branch while preserving `954b64c`, existing NCNMO and
  GuestHub work. The held onboarding correction `b45d084` is not included.
- Validate the additive migration and concurrent worker/cancel behavior with an
  isolated PostgreSQL database. SQLite tests do not prove PostgreSQL locking.
- Provision a dedicated high-entropy signing secret through the normal secrets
  process, configure a trusted HTTPS `FRONTEND_URL`, and review the existing
  Resend sender, API access, signed webhook secret and receipt event subscription.
  No credentials or live settings were created/changed during implementation.
- Enable sending only after a controlled, explicitly authorized staging test.
  Key rotation invalidates outstanding response links. Redact response tokens
  from reverse-proxy/access logs; public responses use no-store/no-referrer and
  noindex headers, and the response page suppresses outgoing referrers.
- Operator reconciliation for `uncertain`: check the exact delivery ID/provider
  idempotency key and provider result. Record acceptance or confirmed rejection
  through controlled operational tooling before considering a retry. There is no
  unsafe UI override for an unknown outcome.

## Local verification

Backend: `python -m pytest tests/test_meetings.py tests/test_invite_email_qr.py
tests/test_resend_webhooks.py -q` (all provider transports mocked, no real sends).
Fixtures clear all existing outbound provider credentials. Tests cover tenant
and suspension checks, draft/preview isolation, stale revisions, duplicate sends
and clicks, invalid/expired/wrong-scope links, DST gaps/folds, UTC calendar output,
reschedule/add/remove/cancel, safe failure retry, interrupted/uncertain delivery,
individual payloads/idempotency, signed receipts and shared ICS regressions.

Frontend: `npm ci --ignore-scripts`, `npm run build`,
`node --test tests/*.test.mjs`. For the standalone local UI fixture, serve Vite
on `127.0.0.1:5175` with test-only `VITE_FIREBASE_API_KEY=local-test-only` and
`VITE_FIREBASE_PROJECT_ID=demo-local`, then `node e2e/meetings-local.mjs`.
The browser fixture injects a mock client and blocks external requests. It tests
draft/preview/send/retry/cancel and explicit guest responses on desktop/mobile,
including no horizontal overflow and expired-link handling. Screenshots are
written to ignored `frontend/test-results/meetings/` for local visual inspection.
The fixture is not a production entry point or authentication bypass.

### Implementation validation on October 25, 2026

- Focused backend command above: **34 passed** (20 Meetings cases and 14 existing
  invitation/ICS/webhook regressions), mocked only.
- `node --test tests/*.test.mjs`: **51 passed**. The initial Windows checkout
  produced a CRLF-only generated-knowledge comparison failure; restoring the
  existing Git blob line endings for those unchanged source/reference files
  resolved it. No knowledge/onboarding content changes are included.
- `npm run build`: passed, including prebuild/postbuild generation.
- Mocked Edge browser flow: passed; desktop and 390px phone screenshots inspected
  against the approved mockup. No external requests, authentication or actual
  email transport were used by the fixture.
- Additional existing calendar suite: **23 passed, 2 failed**. The failures are
  `test_resolve_public_calendar_lists_curated_events` and
  `test_resolve_private_calendar_prefill_and_returning_rsvp_status`. Both also fail
  unchanged at baseline `9141504`: the shared fixture is September 1, 2026 and is
  hidden as a past event by the current date. These unrelated tests were not edited.
- Not run: full backend suite, real authenticated organizer/browser integration,
  PostgreSQL migration/locking integration, real provider/calendar delivery,
  staging/production tests. No local PostgreSQL executable or running Docker
  engine was available; SQLite metadata/lifecycle checks passed.
- Server checkout was read only. No push, PR, merge, deployment, live data/config
  change, real email, or credential creation occurred.
