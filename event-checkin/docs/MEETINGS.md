# Standalone Meetings

Meetings live at `/meetings` in the organizer workspace. They do not create an
Event, ticket, Guest, registration, or event entitlement. Owners/admins of an
active organization can create meetings and manage only meetings they organize.
As with the existing calendar workspace, a deliberately created organization is
preferred over the legacy shared default organization.

## Organizer and attendee flow

1. Schedule a meeting: title, local start/end, IANA timezone, up to 50 named
   attendees with email and/or international phone, explicit email/SMS/WhatsApp channel selection, online link or physical location, optional agenda/video link. Email remains the only default channel; phone consents default false.
2. Save draft. Saving never queues mail, including edits to an invited meeting.
3. Preview invitation. Review recipient names/emails, message, calendar
   attachment, and cancellation recipients removed since the last publication.
   Preview does not create response tokens, mutate responses, or queue mail.
4. Explicitly **Send invitations**. The reviewed revision is required. A stale
   revision fails with 409; repeating the same send is idempotent.
5. Each selected recipient/channel receives an individual notification. Email has
   one ATTENDEE in its calendar attachment; phone channels carry the meeting
   details and personal scoped response link. Opening any link is a safe
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

Four additive ORM tables (`meetings`, `meeting_attendees`,
`meeting_deliveries`, `meeting_suppressions`) follow the existing `app.db_migrate` convention: its
`Base.metadata.create_all` creates new tables, including unique constraints and
indexes. There is no event-table alteration. The channel delta includes guarded migration of the initial email-only Meetings uniqueness constraint and recipient backfill, plus nullable email for phone-only attendees. Do not run the
migration against a live database as part of local validation.

Publication and outbox rows commit in one transaction. Unique
meeting/attendee/sequence/method keys prevent duplicate logical deliveries.
Organizer edits, responses, cancellation, publication and workers lock the parent
meeting row. A worker persists its claim before I/O, then rechecks the current
version under the same parent lock before sending. Publication supersedes older
queued/claimed/failed deliveries. The bounded provider request holds the meeting
lock, serializing cancellation with an in-flight send.

### Calendar transport and byte-identical delivery

SMTP is the default email transport (`MEETINGS_EMAIL_TRANSPORT=smtp`). It uses
the existing SMTP configuration and transmits the exact persisted MIME bytes,
including `text/calendar; method=REQUEST` or `method=CANCEL`. The shared ICS
builder supports a fixed DTSTAMP; delivery Date, boundary, sender, recipient,
links and attachment are frozen before I/O. Mocked SMTP tests parse actual
serialized REQUEST/update/CANCEL messages and verify single-recipient metadata,
UID/SEQUENCE and repeat-byte equality. Real client/calendar behavior has not been
verified by sending mail.

`MEETINGS_EMAIL_TRANSPORT=resend_attachment` is an explicit alternative for
downloadable `.ics` files that require manual import. The documented Resend JSON
[send contract](https://resend.com/docs/api-reference/emails/send-email) does not
provide a calendar scheduling MIME-method parameter. This path does not claim
native calendar scheduling or automatic cancellation/update processing. Its
preview states the limitation. No undocumented API fields are sent. Existing
event email behavior is unchanged.

Exact provider JSON bytes or SMTP MIME bytes are persisted in `wire_payload`
before dispatch and reused on retries. SMTP and shared messaging adapters have
no assumed provider idempotency support; durable claim/uncertain-state handling
prevents blind replays. Resend additionally uses a stable delivery idempotency
key. Conflict/408/5xx, malformed success results, timeout, interrupted claims and
legacy messaging adapters' generic failures are uncertain, not retryable.
Only explicit known provider rejection statuses or proven pre-dispatch setup
failures are eligible for retry. Unknown outcomes require operator reconciliation.

Existing authenticated Resend webhooks retain versioned, monotonic email receipt
status. SMTP/SMS/WhatsApp presently expose provider submission acceptance,
setup-required, blocked or uncertain state, not unverified final delivery.
The existing phone callbacks do not provide sufficiently consistent authentication
to extend them to Meetings safely in this change; they are not used to assert
final phone delivery. An accepted message cannot be blindly retried.

### Phone notifications, consent and charges

Phone addresses must explicitly use E.164 format with `+` and country code; no
country is inferred. A phone-only attendee is supported. Channels and affirmative
consent are selected independently for each attendee. Preview lists every
recipient/channel/action, message details, readiness and credit quote, including
removed channels and previous phone destinations that need cancellation.
Sending and cancellation require a separate paid-channel acknowledgement and
matching quote; changed rates require a fresh preview. Saving and previewing
never send or charge.

The existing organization-wallet rollout, active organization pass and configured
channel credit weights are reused. Each delivery reserves its quoted integer
credit units under the organization lock exactly once; charge/refund state is
audited on that standalone delivery. No fake Event/Guest or event credit ledger
is created. Proven pre-send failure refunds safely; unknown outcomes hold the
reservation for reconciliation rather than allowing a duplicate charge/send.

SMS uses the existing `messaging.send_custom_sms` dispatcher, country routing,
branding, STOP/HELP footer and recipient guard, without event-specific overrides.
WhatsApp uses only `send_custom_template_whatsapp`, with an existing approved
Bird template owned by the tenant or marked shared. It must have exactly
`firstName`, `eventName`, `message`, `ticketLink` variables. The server lists only
eligible templates, rechecks approval/provider/consent at dispatch, and refuses
missing, rejected, foreign or changed templates. There is no free-text/session/
sandbox or SMS fallback. No template is created or submitted by Meetings.

An attendee can explicitly stop SMS or WhatsApp from a signed preference link.
GET only previews; POST writes a tenant/phone/channel suppression. Duplicate
opt-outs are idempotent. Suppressions apply across that tenant's meetings and
cannot be overridden by organizer edits. Existing event consent withdrawals for
the same tenant and normalized phone are also honored conservatively. Cancellation
preference links remain usable without permitting RSVP on cancelled meetings.
SMS/WhatsApp carry meeting details and the secure Festio link; they do not mean
native calendar acceptance. Provider-managed carrier opt-outs remain enforced by
the existing providers; Meetings does not add an unauthenticated STOP webhook.

## Configuration and publication prerequisites

**Sending defaults off**: `MEETINGS_SENDING_ENABLED=false`.
`MEETINGS_SIGNING_KEY` defaults empty; no key is generated by this feature.
`MEETINGS_PAID_SENDING_ENABLED=false` independently defaults off, so enabling
email Meetings cannot silently activate paid phone sends. Paid channels also
require the existing `ORGANIZATION_ENTITLEMENTS_V2` wallet rollout and active
organization pass. `MEETINGS_EMAIL_TRANSPORT` defaults to `smtp`.
Draft/save/preview work with these defaults. The worker starts only when sending
is enabled, and also checks the switch before each delivery.

Before a separately authorized publication:

- Review/merge the feature branch while preserving `954b64c`, existing NCNMO and
  GuestHub work. The held onboarding correction `b45d084` is not included.
- Validate the additive migration and concurrent worker/cancel behavior with an
  isolated PostgreSQL database. SQLite tests do not prove PostgreSQL locking.
- Provision a dedicated high-entropy signing secret through the normal secrets
  process, configure a trusted HTTPS `FRONTEND_URL`, and review the existing
  SMTP sender/host/auth/TLS settings for scheduling MIME, or explicitly select Resend attachment/manual-import mode with existing API access and signed receipt webhook settings. Reuse existing SMS provider settings and approved Bird templates only after review. Do not reuse provider/Firebase/webhook credentials as the dedicated Meetings signing key.
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
individual payloads/idempotency, signed receipts and shared ICS regressions. The channel delta also covers E.164/contact/channel validation, phone-only attendees, quoted charge confirmation, channel/version idempotency, approved-template eligibility/no fallback, suppression/legacy consent, per-channel lifecycle, wallet holds and exact frozen provider payloads.

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

### Additive channel/review-fix validation

The channel delta is based on original feature commit `4772d6e`; repository base
remains `9141504b7fb66c1b633ad0f906fb958e42710e35`, including `954b64c` and existing
GuestHub/NCNMO changes. Held onboarding work is excluded.

Saved executor-local review logs live beside the checkout:
`meetings-delta-tests.log`, `meetings-delta-frontend-tests.log`,
`meetings-delta-build.log`, `meetings-delta-ui.log`,
`meetings-delta-final-smoke.log`, `meetings-postgresql-ddl.log`.
The final focused backend run passed **69 tests**, including **38 Meetings cases**;
all **51 frontend unit tests** passed, the production build passed, and the
mocked desktop/mobile channel/consent/charge-confirmation/opt-out browser flow
passed. PostgreSQL schema compilation and additive-default checks passed as
static checks only; the compiled DDL is saved beside the logs.
The final handoff records their final counts and SHA.

PostgreSQL migration and multi-worker/cancellation locking remain **not run**.
Read-only local inspection found no Windows/WSL PostgreSQL binaries. Windows
Docker's endpoint is absent; WSL has a running local Docker engine, but only
cached application images, with no cached PostgreSQL image or server binary in
the checked backend image. The prerequisite is an already available disposable
PostgreSQL runtime/image, or separately authorized installation/image pull. No
software was installed, no existing database/container data was used, and no
database credentials or persistent access were created for this follow-up.
