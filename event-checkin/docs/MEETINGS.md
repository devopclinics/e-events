# Standalone Meetings

`/meetings` schedules a meeting without creating an event, ticket, guest or event
entitlement. Owners/admins select an active organization they belong to. Meetings
are private to their organizer by default. An organizer may explicitly allow that
organization's owners/admins to co-manage a meeting. Ordinary staff and other
organizations do not gain access. Only the organizer can change sharing.

## Organizing a meeting

1. Choose the organization, then create a meeting. Start/end are local wall-clock
   times in the chosen IANA timezone. New meetings default to the browser zone;
   the searchable picker accepts a city or IANA identifier. Start must be future
   when saving. Invalid zones, DST gaps and end-before-start are rejected; DST
   folds require an explicit occurrence.
2. Add up to 50 named attendees. Paste email addresses, `Name <email>`, CSV or
   spreadsheet Name/Email rows, or search that organization's contacts/event
   guests. Imports select email only. Duplicates are skipped and over-limit
   imports fail as a whole. Phone channels require E.164 and affirmative consent.
3. Add the meeting URL/address, agenda, invitation style, and optional reminders.
   Saving or previewing never sends invitations. A pasted meeting URL without
   `https://` is normalized; unsafe schemes are rejected.
4. Preview the saved revision and recipients. The review also shows optional
   email reminders (1 day, 1 hour, 30 minutes or 10 minutes before), and a
   pending-reply nudge (1 or 2 days before). Select Send now or Schedule send.
   Paid-channel recipients and current charges require separate confirmation.
5. Track replies and delivery independently. **Pending invitation sends** counts
   future send instructions; **Attendees accepted** counts Festio RSVP replies.
   Meeting labels distinguish Draft, Send scheduled, Sending invitations,
   Invitations sent, Delivery needs attention, Cancelled and Archived.
6. Search/filter unarchived, upcoming, past, draft, cancelled or archived meetings.
   The paginated overview returns compact summaries and reply counts. Visible
   tabs poll summaries and only the open meeting detail every 10 seconds; hidden
   tabs pause. Incoming status never replaces unsaved form fields or silently
   adopts a newer editor revision.

Use **Duplicate** to prepare a new draft with copied details and attendees. It
clears the dates and never sends. **Archive** hides a meeting from the default
list and stops scheduled reminders and queued follow-ups. It does not cancel published invitations.
Restoring does not replay stopped reminders: review and publish an updated invitation to establish a new schedule.
Restore before editing or sending. Pending invitation sends must first be
cancelled before archiving. **Delete draft** permanently deletes only unpublished
unscheduled drafts. Published/cancelled meetings retain their delivery records;
archive them instead. Calendar download and CSV reply export are organizer actions.
CSV cells that could be interpreted as spreadsheet formulas are neutralized.

An organizer can copy a named attendee's personal response link, resend one
eligible attendee's email, or nudge eligible pending email replies. These are
explicit email-only actions with idempotency keys and a five-minute follow-up
cooldown. They do not reset responses, republish the meeting or charge SMS/WhatsApp.
Sharing changes who can edit, send, cancel, archive and export; review it carefully.

## Responses, reminders and delivery

Attendees use Accept / Maybe / Decline on a private signed link. GET never records
an RSVP. Links are scoped to attendee, meeting, publication sequence and purpose;
new publication invalidates earlier response links. Responses close 24 hours after
the published end, including for older tokens. A forwarded link remains a bearer
credential; no claim of recipient identity verification is made. Keep links
private. Preference-only cancellation links remain available for 30 days.

Reminders default **off**, including for existing meetings. Only settings included
in an explicitly published invitation create future work. A reminder time already
past at publication is skipped. Reminders require an accepted initial email,
an active attendee, a non-declined response, current authorizing organizer/admin membership and an
active organization. Nudges additionally require a pending response. Attendees can
stop reminder/follow-up emails from the invitation; ordinary updates and
cancellations are unaffected. Eligibility is rechecked immediately before sending.
Archiving, old publications and cancellation stop pending follow-ups. No unknown SMTP
outcome is retried automatically. Disabled sending gates all scheduler activity.

Email **Accepted by provider** means SMTP/API submission was accepted, not that
mail reached the inbox or that someone accepted the meeting. Existing authenticated
Resend receipts can report delivered/bounced/complained/failed/delayed status when
that transport and its signed webhook are configured. SMTP has no receipt webhook
in this implementation; phone adapters expose submission state, not verified final
delivery. Frozen delivery payloads keep their original transport; old SMTP sends remain untracked. Never infer delivered status from SMTP acceptance.
Real inbox arrival, spam placement and Gmail/Outlook calendar rendering require an
actual mailbox check. They cannot be proved by mocked delivery tests.

## Calendar semantics

The stable UID is `meeting-{id}@festio.events`. First publication has SEQUENCE 0;
updates and cancellation increment it. Current attendees get METHOD:REQUEST;
removed attendees get METHOD:CANCEL with prior published details. Cancellation uses
that UID with STATUS:CANCELLED. A follow-up reuses the publication's UID/SEQUENCE;
it does not create a second calendar meeting. The organizer can download an ICS.
Google/Outlook RSVP replies are not synchronized; responses are recorded in Festio.

SMTP sends the exact persisted MIME including calendar method and DTSTAMP.
`resend_attachment` is an explicit alternative with a downloadable ICS requiring
manual import; it does not claim native scheduling MIME support. Provider bytes,
recipient, signed link, calendar timestamps and idempotency keys are frozen.

## Storage, migration and operational controls

Meetings use `meetings`, `meeting_attendees`, `meeting_deliveries` and
`meeting_suppressions`. `app.db_migrate` adds archive/sharing flags, UTC filtering
metadata, follow-up schedules, attendee follow-up preferences and delivery purpose.
It backfills UTC times using the same timezone/fold validation as the API. The
per-recipient uniqueness key includes purpose, so reminders and manual follow-ups
can coexist with the original invitation without changing its sequence. Parent
meeting row locks and `SKIP LOCKED` prevent concurrent workers queuing work twice.

Publication, cancellation and queued work commit atomically. A worker durably
claims each delivery before external I/O. Crashed or uncertain sends require
operator reconciliation; only proven rejection or pre-dispatch setup failure is
safe to retry. Paid channel reservations/refunds retain their existing behavior.
The compact overview has constant query count per page; the compatibility full
list is also paginated and batch-loads attendees/deliveries.

Apply and verify schema changes before exposing the updated frontend. After
purpose-specific deliveries exist, an old migration runner that reinstates the
previous six-column uniqueness constraint is not a safe rollback. Keep the upgraded
migration/outbox code when rolling back only the UI; reconcile/drain follow-ups
before any backend rollback. Do not delete delivery history to force a rollback.

Runtime defaults remain `MEETINGS_SENDING_ENABLED=false`, empty dedicated signing
key, `MEETINGS_PAID_SENDING_ENABLED=false`, and SMTP transport. Production email
sending was explicitly enabled during the reviewed October 24 rollout after
controlled staging checks. The October 25 follow-up correction uses the existing Resend API transport for new meeting emails and signed delivery receipts. Calendar files remain attached for import, with attendee replies recorded through Festio. Existing frozen SMTP payloads retain their transport; default configuration is not current deployment state.
Secrets are managed through the deployment's secret source, not direct pod edits.
Public API success and handled errors apply no-store, no-referrer and noindex.

## Verification and limits

Earlier Windows-only notes saying PostgreSQL migration/concurrent release had not
run are superseded by the controlled staging release reports. Those checks did run
for the previous production release. This follow-up additionally exercises the
purpose migration, existing-row backfill and concurrent reminder release in
PostgreSQL before promotion. Record current counts and exact revisions in the
release's deployment report rather than interpreting historic test counts as live
state.

Focused regression commands:

- Backend: `python -m pytest tests/test_meetings.py tests/test_meeting_workspace.py
  tests/test_resend_webhooks.py -q` with offline credentials and mocked providers.
- Frontend: `node --test tests/*.test.mjs e2e/*.test.mjs` and production build.
- Isolated browser fixture: draft/preview/send/retry/cancel, response flow,
  timezone search, import, directory, filters/pagination, archive/duplicate/export,
  reminder settings, opt-out and mobile overflow; external traffic is blocked.
- PostgreSQL staging: apply migration twice, verify indexes/uniqueness/backfill,
  concurrently release due reminders once, verify cancellation and no real sends.
- Production: exact image/revision/asset hashes on each replica, schema/flags,
  protected organizer routing, API health and public invalid-link error headers.

Recurrence, generated video rooms, calendar OAuth/free-busy, attendee comments/time
proposals, organizer calendar view and post-meeting notes remain separate product
extensions. They are not implied by reminder or delivery status support.
