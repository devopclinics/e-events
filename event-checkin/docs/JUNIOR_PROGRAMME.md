# Junior Programme

Staff-only, event-scoped child roster and custody/movement workspace at `/junior-platform`.
Parents receive updates without using Festio. Guest List owns child and guardian identities and contact details. JP attaches its
operational profile to the same guest IDs. With a configured JP start date, convention
arrival is recorded separately before daily drop-off begins. Without that setting,
a verified drop-off can also complete convention admission. Each drop-off records
shared dated attendance and starts JP custody for that day. Existing explicitly recognized juniors appear
automatically, without creating duplicate guests.

## Event setup

Open Event Setup → Junior Programme. The mode defaults off on every existing and
new event. Administrators configure classrooms and grant roles to existing event
staff. Classrooms and guardian adulthood still require staff confirmation. Existing
Guest List junior flags/types and guardian links identify juniors; do not infer
classrooms or mark unrelated adults as children from their names.

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
retained from NCNMO. Existing Guest List badges work in JP; regenerated JP badge
QRs use the same guest token. Badges identify the child and never authorize pickup.
Names corrected through either screen appear in both. Guardians are selected from
Guest List or created once there. Guardian verification/notification policy remains
in JP; pickup grants use the existing event guardian authorization map.

1. Find/add child and record convention check-in. For NCNMO, JP drop-off starts the next day. On each JP day, record dropping-off adult and relationship (optional drop-off phone).
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
not automatically to the dropping-off/collecting person. Addresses and SMS
permission are read from the linked guardian’s current Guest List record before
each send. Removing an existing pickup grant immediately blocks JP release. Free-text clinical notes and departure reasons never enter message bodies.

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
The Volunteer guide tab provides a visual orientation gallery with screen examples,
role filters, workflow diagrams, stop rules and a printable visual PDF.
Practice with a separate training event and fictional contacts, not real children.

## Release and reuse

Changes are additive: one default-false event flag and Junior-owned operational tables. Nullable
Guest List links are added without rewriting attendance history.
Existing events stay disabled; generic scan/checkout behaviour is untouched.
Use the actual production release baseline, not a main branch missing deployed fixes.
Deploy backend and frontend through GitOps after PostgreSQL, authorization,
legacy-flow and browser checks. Preserve previously served frontend assets.

For the NCNMO pilot, enable only the intended event with sending paused and the existing
Guest List juniors linked to JP operational profiles. Complete confirmed classrooms, named staff grants, actual child/guardian
intake and provider delivery checks before operational use. Reuse the module by
configuring another event; never copy child records or attendance as a template.

Rollback: turn off the Junior event flag and pause sending, then restore prior image
digests through GitOps if necessary. Retain additive tables and audit history; do not
drop them during application rollback. A disabled mode blocks new operations, so
do not disable it during live child custody without a supervisor's handover plan.


## Screening bands and complete temporary cycles

Every screened child needs a standard screening wristband. Allergy and accommodation bands are additional: both needs mean three bands. Classroom arrival requires the standard band plus both applicable desk clearances. Record a missing standard band with the dedicated screening-band action; it does not reset desk clearances. Every new drop-off starts a fresh screening-band check; historical movement snapshots are preserved.

Clinic and Other each follow departure -> return to JP -> classroom arrival when class resumes. Each step records its volunteer and timestamp. A child remains away until the return is recorded. If leaving after returning, use verified pickup rather than inventing classroom arrival. Separate return queues and the child’s movement cycle make pending steps explicit.

## Volunteer shift reminders

Supervisors use Volunteer shifts to select an existing Junior Platform Team member and station. No Guest or Contact List entries are created. Configure custom minutes before the shift, a repeat frequency/window, exact reminder instants, or a combination. Duplicate times are collapsed; at most 20 reminder times are allowed per shift. Dates require timezones and are stored in UTC; the UI labels device-local input and event-local display.

Select Email, SMS, WhatsApp, MMS or multiple channels. Email uses the current Team email; phone-channel consent is recorded separately for the volunteer shift. WhatsApp requires an approved organization/shared template and its variables; MMS requires a public HTTPS image. Automated calls have no transport and are not offered as a working channel.

Shift activation and the event’s volunteer-sending switch are separate, initially off, and independent of guardian or convention notification switches. Dispatch rechecks membership, Junior Platform role, active account, consent, provider readiness, event safety and credits. Removed staff, changed shifts, expired times and paused schedules cannot fan out. Edits cancel unattempted old-generation reminders. A provider attempt is committed before dispatch; uncertain outcomes require review and are never automatically replayed. Delivery receipts distinguish Accepted from Delivered. Missed reminders are not sent once the shift begins, or when more than five minutes late.

Volunteers keep children supervised and queues moving through prompt, recorded handoffs. Late relief is escalated to the lead; a reminder does not replace an in-person handover.


### Linked guardian at drop-off

Drop-off defaults to an existing linked guardian (parents listed first). Staff can select another linked guardian or choose Another person to enter a separate handoff record. The server resolves linked names, relationships and phone numbers from the current shared guardian record; scanner roles do not receive private contact fields. Staff must still verify the person in front of them, and verify an adult sibling’s age. Recording another person at drop-off does not create a Guest, change guardian contacts, opt them into messages, or grant pickup authorization.


## Convention admission and daily programme start

Adding names, linking a guardian, opening a record, or beginning a new calendar day does not admit anyone. Convention check-in invokes the existing admission rules. With no separate JP start date configured, a witnessed drop-off can also admit a child who has not already been admitted. Cancelled passes, inactive events, required check-in steps, group-pass rules and seating policies remain in force. If daily attendance is enabled, its event-date window also applies. No event schedule or general daily-scanner feature switch is changed by JP.

The verified drop-off explicitly opts that junior into the canonical AttendanceRecord daily ledger: one mark per guest/event/local date, reused if a normal daily scan already recorded it. Convention admission, daily attendance, JP movement and guardian notice creation share one transaction. Conventional admission messages are suppressed for this JP path; the independently controlled guardian outbox handles JP notices. Existing convention admission timestamps and seats are preserved on subsequent days or re-entry. Broadcast occurs only after commit.

Programme dates use the event timezone. A child released on an earlier day appears as Not arrived today, with fresh screening and wristband confirmation required. This is a read view, not a destructive midnight reset: stored release, original admission, restricted profile notes and dated movement history remain intact. Confirming the next drop-off starts the new programme day.

Unfinished prior-day custody is never silently released or hidden. Staff see a prior-day warning; a supervisor must reconcile the actual return/pickup before a new daily drop-off. Outing and temporary-departure reconciliation rules remain in force. Old movements with no programme-date column retain their original timestamps and are not backfilled with guessed dates. Stale-day forms and replays of a previous day’s drop-off request cannot start a new day.

### Separate convention arrival and JP start

Set the event-scoped `dropoff_start_date` to the first JP day (NCNMO: 2026-12-25, following convention arrival on 2026-12-24). Staff record `convention_checkin` on arrival: this admits the shared Guest and records canonical daily attendance, but creates no JP custody, programme date, screening or wristbands. Drop-off is blocked before the configured date and until convention admission is recorded. From the start date, each JP day requires a witnessed drop-off and screening. Late arrivals can complete convention check-in, then drop-off. Unset events retain combined admission/drop-off; existing general scanner and Guest List admission still count.

## Festio Juniors web app and practice

The reusable staff app is Festio Juniors. `/junior-platform` remains the full Festio workspace; `/juniors/` offers a simplified installable view with the same authenticated event-scoped APIs and permissions. The dedicated manifest has its own ID and `/juniors/` scope, separate from GuestHub. Installation is browser-dependent. A scoped service worker provides only a reconnect page, never a child-record cache or offline movement queue.

An explicit practice event uses `is_test=true` plus `setup_preferences.junior_practice_source` referencing the scheduled event. Rehearsal copies identities and guardian policies, not admission, custody, medical notes, QR tokens, communication contacts or billing state. Its schedule starts before today so convention check-in and daily drop-off can both be practised now. For an arrival-only rehearsal, set its drop-off start date to tomorrow, then return it to today to continue. The scheduled event remains unchanged. Guardian and volunteer sending are blocked in settings and again at delivery even if flags are misconfigured. New practice records are isolated in their own shared Guest List; staff still need access to that event.
