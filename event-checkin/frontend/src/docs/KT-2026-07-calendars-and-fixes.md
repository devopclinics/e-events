# KT: Event Calendars, Task Attachments, and two production bugs (2026-07)

Internal knowledge-transfer note for backend-2.2.80 → backend-2.2.83. Covers
what shipped, why, and two real bugs found and fixed along the way. Staging
only as of this writing — see the version history at the bottom for the
promotion status.

## 1. Event Calendars (new feature)

Modeled on Gatsby's "Event Calendars" product: a curated, cross-event listing
page, public or private, that lives at the **organisation** level (not tied
to one event).

**Data model** (`backend/app/models.py`): `ContactList`, `Contact`,
`ContactListMember`, `Calendar`, `CalendarEvent` (join table with
`sort_order`), `CalendarContactList`, `CalendarAccess` (one personalized
token per contact per private calendar — mirrors `Guest.invite_token`'s
mint-once/lookup-by-token convention).

**Key design decision**: registering for an event from a calendar sends the
visitor to that event's *own* existing RSVP page (`InvitePage.jsx` /
`invite.py`), not a second parallel registration engine. RSVP questions,
capacity, meal selection, and the existing `.ics`-attached confirmation email
all work for free. `InvitePage.jsx` just pre-fills name/email from query
params when present.

**Backend**: `backend/app/routers/calendars.py` — admin CRUD mounted at
`/api/organizations/me` (contact lists, calendars, curation, contact-list
attachment, logo upload, "send calendar link" broadcast), plus a public
resolver `GET /api/calendars/{token}` that tries `Calendar.share_token`
first, falls back to `CalendarAccess.token` (private mode). A contact's
RSVP status per event is resolved *live* by looking up `Guest` on
`(event_id, email)` — no cached/duplicated status column.

**Frontend**: `Org Settings → Calendars` (`OrgSettingsPage.jsx`,
`CalendarsPanel` + `ContactListsPanel` + `CalendarDetail`), public page at
`/calendar/:token` (`CalendarPage.jsx`).

**Follow-up polish shipped 2026-07-25** (backend-2.2.81):
- View/click analytics: `Calendar.view_count`, `CalendarEvent.click_count`.
  Every event link on a resolved calendar now routes through
  `GET /api/calendars/{token}/go/{event_id}` (increments the click counter,
  then 302-redirects to the real destination) instead of linking directly.
- Iframe embed snippet for public calendars (computed client-side in
  `CalendarDetail`, not server-generated).
- Drag-and-drop event reordering in the admin UI (existing ↑/↓ buttons kept
  as a fallback/accessible path).
- CSV import for Contact Lists (`POST
  /contact-lists/{list_id}/contacts/csv`, reuses the `_decode_csv_bytes`/
  `_norm_header` helpers already used by guest CSV import — requires an
  `email` column via normalized header matching).

**User-facing gotcha worth knowing**: "Hide past events" is **on by
default**. A calendar can have N events curated onto it in the admin view
but show fewer on the public/private page simply because some have already
passed — this is filtering working as designed, not a bug, but it reads as
one to a first-time user. Documented in the in-app Help guide's
Troubleshooting topic.

## 2. Tasks & My Tasks — file attachments (new), the rest (pre-existing but undocumented)

The Task board itself (per-event Kanban: Open/In progress/Done, assignment,
due dates, comment thread, subtasks, plus a cross-event "My Tasks" view for
staff) already existed going into this pass — it just had **zero
representation** in the Help guide or the marketing site, which we also
fixed this round (see `org-tasks` topic in `guideContent.mjs` and the
"Tasks & My Tasks" pillar on the landing pages).

**File attachments are the one actually-new capability**: `TaskAttachment`
model, `backend/app/routers/tasks.py` endpoints (upload/list/delete), gated
by the same `require_event_member` bar as every other Task action (comments,
subtasks) — Task has no `created_by_user_id` to gate more narrowly on.
Mirrors `events.py`'s cover-image upload pattern (`app/storage.py`, 10 MB
cap, broader allowed-type list than images-only: images + PDF/doc/xls/csv/
txt). Frontend: `TaskDetailPanel.jsx` gained an "Attachments" section
structured like its existing Subtasks section.

## 3. Bug: SignalHouse `provider_message_id` was capturing the wrong field

**Symptom this was chasing**: inbound SignalHouse delivery-status webhooks
need to look up the right `MessageCreditLedger` row by
`provider_message_id`. The parsing code (`_signalhouse_result()` in
`backend/services/messaging.py`, and its twin
`_signalhouse_extract_status_and_message_id()` in
`backend/app/routers/messaging.py`) needed to pull the correct identifier
out of SignalHouse's response shape.

**What went wrong initially**: an early pass (informed by a synthetic test
payload, not a real one) prioritized `groupId`/`subgroupId` as the message
identifier. **A live test caught this as a genuine regression**: two real
sends to different recipients, ~90 minutes apart, came back with the
*identical* `groupId` (`G00003ZI`). `groupId`/`subgroupId` are 10DLC
campaign/brand-level identifiers — constant for every message sent through
that registration, not per-message. Using them for an exact-match webhook
lookup would have silently attributed one guest's delivery status to a
different guest's ledger row.

**The fix**: the real live payload has the correct identifier all along —
the top-level `_id` field on the message document (Mongo ObjectId,
confirmed present and stable via a real `/message/sms` call). This is
*not* the same field as `statusHistory[-1]._id` — that's a separate,
transient subdocument id that gets a new value appended on every status
transition. Corrected priority order:
`messageId → first._id → groupId/subgroupId → statusHistory[-1]._id → batchId`.

**Lesson recorded here on purpose**: this was only caught because live
testing with a real phone number was insisted on instead of accepting
unit-test-only verification. The synthetic test fixture that informed the
first (wrong) pass didn't reflect the real response shape closely enough to
surface the bug. Tests were rewritten afterward
(`backend/tests/test_messaging_signalhouse.py`,
`backend/tests/test_signalhouse_webhook_parser.py`) using payload shapes
captured verbatim from the real API.

**Separate, unrelated config bug found + fixed in the same pass**: staging's
`backend/.env` had `SIGNALHOUSE_STATUS_CALLBACK_URL` hardcoded to
`https://festio.events/...` (prod's domain) instead of
`https://staging.festio.events/...` — so staging's outbound SMS webhooks
were telling SignalHouse to call prod. Fixed in staging's `.env`.

Shipped as backend-2.2.82 (backend-only rebuild).

**Still open**: the inbound webhook → ledger reconciliation path has not
been verified end-to-end with a real webhook actually arriving and updating
a `MessageCreditLedger` row (only the outbound parsing fix has real-world
confirmation so far).

## 4. Bug: org-scoped admin panels silently operated on the wrong org

**How it was found**: a user (owner of two orgs) reported a calendar they'd
just curated events onto wasn't showing those events. Root cause traced by
directly inspecting the `calendars` row's `org_id` in the DB — it belonged
to the org visible nowhere in their nav.

**Root cause**: every account created before 2026-06-07 was auto-enrolled
into a shared legacy org (`DEFAULT_ORG_ID =
"00000000-0000-0000-0000-000000000001"`, name `"vsgs"`) during the
multi-tenancy migration, in addition to whatever real org they went on to
create. Five separate router files each independently implemented a "which
org does this user manage" helper
(`_owned_org`/`_managed_org`/`_primary_owned_org` in `api_keys.py`,
`webhooks.py`, `org_billing.py`, `calendars.py`, `referrals.py`), and every
one of them picked the *earliest-created* org a user belongs to with the
right role — which for any pre-migration user is always the legacy "vsgs"
org, since it was created first. There is no "current org" selector
anywhere in the frontend, so this was invisible: the user's Org Settings
panels were transparently operating on the wrong org with zero indication.

**Fix**: all five helpers now use
`case((Organization.id == DEFAULT_ORG_ID, 1), else_=0)` as the primary
`ORDER BY` key (ascending), pushing the legacy org to the back of the
candidate list — a user's real, deliberately-created org always wins,
falling back to the legacy org only if it's the only org they belong to at
the required role. Regression test:
`test_calendar_creation_prefers_real_org_over_legacy_default_org` in
`backend/tests/test_calendars.py`.

**Data correction**: the code fix does not retroactively move
already-misplaced rows. The one specific calendar known to be affected
(`info@devopclinics.com`'s "Upcoming Events" calendar) was moved to the
correct org via a direct one-row SQL update. **Not yet done**: a second
multi-org user (`mubahcreativity@gmail.com`, owner of 3 orgs) was found via
a blast-radius query and has not yet been investigated for similarly
misplaced data — flagged for follow-up, not resolved.

Shipped as backend-2.2.83 (backend-only rebuild).

## Version history this pass

| Version | Contents | Status |
|---|---|---|
| 2.2.80 | Event Calendars + Contact Lists core, Task attachments | staging |
| 2.2.81 | Calendar analytics, embed snippet, drag-drop reorder, CSV import | staging |
| 2.2.82 | SignalHouse `provider_message_id` fix (corrected) + staging callback URL fix | staging |
| 2.2.83 | Multi-org `DEFAULT_ORG_ID` resolution fix (5 routers) + data correction | staging |

All of the above is **staging only**, pending the user's feature-by-feature
review pass before promotion to prod (`festio-infra`'s `make promote
TAG=x`, per the top-level `README.md` release flow).
