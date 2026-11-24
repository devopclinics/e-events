# Junior Programme

Staff-only, event-scoped child roster and custody/movement workspace at `/junior-platform`.
Parents receive updates without using Festio. The convention Guest, RSVP, zone and
admission models remain independent; no implicit roster migration is performed.

## Event setup

Open Event Setup → Junior Programme. The mode defaults off on every existing and
new event. Administrators configure classrooms and grant roles to existing event
staff. Do not infer confirmed classrooms or child identities from old demo data.

- Scanner: search/scan child badges, witness and record movements, select authorized collectors.
- Intake: add/paste children, correct names/classrooms with reasons, manage guardian contacts and authorizations.
- Support: record restricted allergy/accommodation details and wristband completion.
- Inventory: manage supplies without child roster or medical access.
- Supervisor: all operational functions, outing rosters and reconciliation.
- Event owner/admin or editing event manager: configure the module and grants.

Removing an event assignment revokes its Junior grant even if a stale grant remains
in configuration. View-only event access cannot mutate Junior records. Ordinary
scanner access grants neither name correction nor guardian authorization.

## Intake and operations

Paste up to 200 tab-separated spreadsheet rows without a header. Name-only rows
are supported; other columns may be left empty:

`Child full name | Roster reference | Age group | Classroom | Guardian name | Guardian email | Guardian mobile`

The separators must be tabs. References are unique within an event. Exact name
matches require explicit review/confirmation for a genuinely different child.
Import is atomic. Missing age/classroom remains awaiting confirmation; classroom
arrival is blocked until intake assigns a configured classroom. Import never
assumes SMS permission, adulthood or pickup authority.
Intake staff must verify those independently. A child's roster reference can be
retained from NCNMO; generated badge QRs contain only a JP record identifier and
require authenticated staff access. They are not pickup credentials.

1. Find/add child, record dropping-off adult and relationship (optional drop-off phone).
2. Answer both screening questions. Yes routes to support; each required referral
   needs restricted details and wristband confirmation before classroom placement.
3. Record actual arrival into the assigned classroom.
4. Clinic/Other records a temporary departure and accompanying adult. Other needs
   an internal reason. Record return to JP before classroom arrival or final release.
5. Outing requires a supervisor-created roster with verified permission. Departure
   is available only on the outing date in the event timezone. Returned children
   move to reception until classroom arrival is confirmed. Outstanding names stay
   visible; an outing cannot close with missing returns.
6. Final pickup requires an explicitly authorized, adult-verified contact and
   staff identity check. Missing links fail closed. A typed movement name cannot
   authorize collection. Record all custody transfers online; there is no offline release.

Child mutations and inventory use row locks plus record versions. Retried movement
and inventory request IDs do not record duplicate transitions. Each child occupies
one current location. Current-location counts and outing cohort counts are separate.

## Guardian email and SMS

Every child operational transition writes movement and per-channel notification
records in the same transaction. Notifications go to designated guardian contacts,
not automatically to the dropping-off/collecting person or a convention Guest's
address. Free-text clinical notes and departure reasons never enter message bodies.

Sending is independently off by default. Collect guardian contacts and SMS permission,
verify providers and available credits, then enable Junior sending. Convention
notification toggles stay unchanged. The worker checks the live event safety policy, channel
blocks, consent, current recipient and metering before each attempt. It runs
independently from the existing source-list poller, so slow providers cannot delay
legacy sync/programme jobs. Claims are replica-safe with SKIP LOCKED.

Paused history does not replay automatically on enable. Staff may explicitly queue
an unattempted notice less than 24 hours old after reviewing its recipient/timing.
Timed-out/interrupted sends become `review_required`; never blindly retry a possibly
accepted send. `accepted` is not `delivered`. Delivery is shown only when existing
email receipts or SMS credit-ledger receipts confirm it. Provider support determines
receipt availability. No live guardian messages are sent during fixture QA.

## Inventory and volunteer guide

Inventory tracks total, issued, damaged and lost quantities with an attributed
issue/return ledger. It does not implement individual asset serial-number tracking.
The Volunteer guide tab provides the orientation walkthrough and a print action.
Practice with a separate training event and fictional contacts, not real children.

## Release and reuse

Changes are additive: one default-false event flag and new Junior-owned tables.
Existing events stay disabled; generic scan/checkout behaviour is untouched.
Use the actual production release baseline, not a main branch missing deployed fixes.
Deploy backend and frontend through GitOps after PostgreSQL, authorization,
legacy-flow and browser checks. Preserve previously served frontend assets.

For the NCNMO pilot, enable only the intended event with sending paused and an empty
JP roster. Complete confirmed classrooms, named staff grants, actual child/guardian
intake and provider delivery checks before operational use. Reuse the module by
configuring another event; never copy child records or attendance as a template.

Rollback: turn off the Junior event flag and pause sending, then restore prior image
digests through GitOps if necessary. Retain additive tables and audit history; do not
drop them during application rollback. A disabled mode blocks new operations, so
do not disable it during live child custody without a supervisor's handover plan.
