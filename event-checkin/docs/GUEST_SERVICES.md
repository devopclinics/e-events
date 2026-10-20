# Guest Services: table managers and conference room stewards

Guest Services assigns existing event staff to multiple tables or existing Venue Access zones. Several staff can share a location, with lead labels and optional UTC shift bounds. It does not create a second task system, seating plan, menu catalogue, order ledger or attendance ledger.

## Existing records reused

| Concern | Source of truth |
| --- | --- |
| Staff identity and event membership | `EventUser`, organisation membership and existing staff accounts |
| Table/seat allocation | `SeatingTable` and `Guest.table_id` / `seat_number` |
| Conference rooms and entry/exit | Existing `Zone`, ticket/guardian/capacity checks and `ScanEvent` |
| Event admission | Existing scanner admission and required-experience checks |
| Menu selection | `GuestMenuChoice` through the same validation helper as the guest-facing route |
| Meal completion | `GuestMealService`, per serving occurrence, using the existing fulfilment helper |
| Assistance, escalation and handover | Canonical `Task` and `TaskActivity`, including the normal assignment notification |
| Session attendance | Existing Experience session workflow; room movement never completes a session |

Only responsibility assignments, physical seating confirmation, operational audit entries and task-request idempotency links are new. An assistance link points at a canonical task: there is no independent request status or parallel queue. The existing Tasks board owns acknowledgement (`in_progress`), comments and completion (`done`).

## Organiser flow

1. Add staff in Team. Prepare tables in Seating or rooms/zones in Venue Access.
2. Open **Event operations → Guest Services → Assign staff**.
3. Select staff, keep restricted access enabled, and add tables or rooms. Multiple locations per person and multiple people per location are supported.
4. Enable event admission and meal assistance separately for tables, or entry/exit scanning for rooms. Optionally label a lead and set shifts in the operator's local time; the API normalises times to UTC.
5. Save. Conflicting event-wide guest, seat, menu and dashboard grants must first be removed in Team. Administrators and event managers retain their wider roles and cannot be relabelled as restricted staff.
6. Review coverage in the floor overview. Changes use optimistic concurrency; a conflicting save requires refresh.

Empty shifts mean ongoing responsibility. A shift ends exclusively at its end timestamp. Keeping scoped access enabled while removing all assignments fails closed; it does not restore ordinary scanner permissions. Deliberately disabling scoped access restores the member's original staff permissions.

## Staff flow

The workspace includes organiser setup notes and staff instructions from the shared Help source, with expandable steps on the page.

The mobile workspace lists assigned table guests and room occupants, expected/admitted/seated counts, menu selections and outstanding serving occurrences. Staff can mark seating, help select meals with guest agreement, mark a specific service served, or scan assigned table/room passes according to their grants. Staff do not move guests, override capacity or meal eligibility, edit event setup or export the guest directory through this workspace.

Requests for water, accessibility assistance, housekeeping, delays or shift handover create one normal task. Assign it to an event teammate or leave it in the team queue. A client-generated request key and database uniqueness protect retries from creating duplicate tasks. Shared task notes should not contain sensitive guest information.

Room occupants come from the latest accepted directional zone movement. A room assignment is not a session roster or session attendance grant. An event check-in scan, room entry and meal collection remain separate operations. Existing room access configuration must be enabled; the assignment itself does not activate an add-on.

## Access, consistency and migration

- Existing staff default to `guest_service_scoped=false`; no existing assignment is converted automatically.
- Every new action revalidates tenant membership, active assignment, guest's current table and action permission on the server. Ordinary staff retain the existing scanner behaviour and denial response contracts.
- Scoped staff cannot bypass restrictions using the event-wide paid-member guest operations, guest-directory grants, legacy offline manifest, daily/checkout scans or Experience runtime routes.
- New workspace responses omit guest contacts and pass credentials. Requests use existing event-team assignees.
- Admission retains the canonical required-step and seating checks. Operational guest mutations require an Event Pass.
- Guest and service row locks plus the existing unique fulfilment key prevent duplicate service records. Scoped serving checks eligibility, open state, serving window and capacity. Assisted menu selection locks each served category while permitting later unserved categories. Optional choices can be explicitly cleared; required and served choices cannot. Legacy served flags without category records remain locked for supervisor review. The existing public guest selection policy is preserved.
- `GuestSeatingPresence` confirms physical seating separately from admission and allocation. A guest moved to another table loses the old seating confirmation in the view. Corrections and assisted choices are auditable.
- Migrations are additive: metadata creates the new tables; the existing auto-patcher adds the false-default scope column. No guest, task, seat, menu or attendance records are copied or backfilled.
- The workspace checks for changed pages every 20 seconds while visible. Positive seating, meal-delivery and headcount observations can be queued on the staff device; pending is never presented as server-confirmed.

## Validation

Backend regression coverage lives in `tests/test_guest_services.py`. Mounted UI tests live in `frontend/tests/guest-services.test.mjs`. The opt-in PostgreSQL test verifies additive migration, same-guest duplicate serving and competing guests against one remaining serving capacity. It accepts only an explicitly configured disposable localhost `guest_service_fixture*` database.

Shared Help is updated in `frontend/src/guideContent.mjs`; the support knowledge and internal media documentation are regenerated from that source. API contracts and frontend schema types include the new routes and request bodies.

## Operations board and focused editors

Tables switches between a card board and a coverage canvas; the canvas is a responsibility diagram, not a second floor-plan editor. Staff, Rooms, Guests and Requests have separate views. Search and attention filtering use the existing scoped response. Help stays available in the Quick guide drawer. Empty assigned tables remain visible.

Edit assignments opens the existing per-location editor directly, preserving distinct grants, lead flags, shift bounds and member version. Table details use the existing Seating endpoint and carry category, order and optimistic version through unchanged; capacity reductions stay in Seating for allocation review. Guest care contains physical seating, agreed choices and per-service collection. Event admission and room movement still require the existing pass scanner. Requests create canonical Tasks and link to the existing board. No new local roster or task status store is introduced.

Edit name is limited to unclaimed `.invalid` placeholder identities with no Firebase UID or superadmin grant, staff membership in this organisation and exactly one organisation and event assignment. The protected endpoint requires a writable event supervisor, locks both member and user, checks the optimistic member version and audits the change. Shared, verified or real-email accounts are not renamed here; Team remains the place to replace placeholders with real sign-ins.

## Reliability corrections

Guest Services forwards guardian QR and permitted staff-selected identity verification to the canonical zone scanner, including its consent, guardian, capacity and ticket checks. The UI keeps the original junior, room and direction through the guardian step and requires an explicit identity confirmation before manual selection. Responses expose only the authorized guardian names/IDs needed for this workflow, not their pass credentials.

Assignment edits retain existing IDs, including legacy clients saving unchanged locations. Request acknowledgements use the caller's event membership and own idempotency key before requiring the old assignment to remain active; new requests still require active responsibility. Mutations and roster refreshes have separate acknowledgements. Connectivity errors mark the view stale and disable mutations; polling access loss clears the roster and closes operational panels. Action-specific denials first refresh scope rather than falsely declaring the entire membership lost.

Meal availability is computed by a shared server helper also used by scoped fulfilment. Workspace responses include availability/reason, serving-window bounds and remaining capacity; final eligibility, window and capacity checks remain authoritative under lock at collection time. Menu serialization and placeholder metadata are batched, and occupancy fetches only each guest/zone's latest accepted movement. Organiser-only setup checks highlight placeholder identities, unallocated guests, open collections missing windows and demo collections. No live staff identities, seating allocations or serving schedules are invented by these warnings.


## Large events and meal requests

Tables support an optional service section, search, covered/uncovered filters, a compact list, and 24-row pages. Supervisors with more than 24 tables start in Compact list; Board and Floor canvas paginate too. Guests and staff views are paginated. Section metadata is distinct from seating categories and allocation groups. Legacy table updates that omit `service_section` preserve it. The existing ORM migration runner adds its nullable column.

Meal requests are derived from GuestMenuChoice and MealService and progress in the existing GuestMealService ledger: pending (New), preparing, ready, served (Delivered). Kitchen and assigned table managers share these records; Tasks remain exclusively for assistance. Starting preparation requires admission, active event, eligibility, serving window, capacity, current assignment, current stage and an unchanged selection fingerprint. Preparing/ready records reserve capacity; delivery consumes the same reservation. Guest and assisted choice edits lock as soon as preparation starts. Existing direct serving remains available and respects reserved capacity. Repeated transitions acknowledge the existing result; stale or skipped transitions fail.

Guest Services and Kitchen show in-app alerts for new/changed choices and ready meals on their existing 20-second refresh. Alerts contain only current visible meal requests; initial load does not replay old changes. No background browser push, email or SMS is sent. The queue has stage/table filters and 25-request pages. Real event sections and staff identities must be supplied by the organiser.


## Meal attendance versus orders

Each MealService has `tracking_mode`: `orders` (the backward-compatible default), `headcount`, or `both`. The existing GuestMealService row gains nullable `attended_at` and `attended_by_user_id`; attendance does not change fulfillment_status, served timestamps, Guest.meal_served, seating, or event admission. No second attendance/order ledger is introduced.

Guest Services → Meal attendance shows assigned-table counts for meal-enabled managers, while supervisors and Kitchen see the whole event, including guests without tables. Expected means non-declined, eligible guests in the displayed scope. Attendance, not-yet-attended, distinct guest selections, preparing, ready, delivered, and attended-without-order counts remain separate. Recent attendance shows up to ten authorised guests for supervisor correction.

The attendance scan requires an Event Pass, active event, enabled meals, current meal permission, event admission, eligibility, an enabled headcount mode, serving window and attendance capacity. A service-row lock serializes capacity and the unique guest/service row makes repeated scans idempotent. Attendance capacity and order reservations are independent in Both mode; neither implies the other. Headcount-only service categories disappear from order forms when no occurrence of that category accepts orders.

Supervisors configure tracking and can correct an attendance mark with a meaningful reason and the original scan timestamp. Corrections retain original actor/time/reason in GuestServiceActivity and never undo delivery. Settings cannot hide existing attendance or in-progress/delivered orders; use Both to retain their visibility. Existing modes/settings remain unchanged on upgrade.


## Server pages and lightweight refresh

The modern client requests `paged=true` and a view. Guests are queried in stable 24-row SQL pages; meal requests use 25 guest/service pairs, with server stage, table and name/choice search filters. Room occupancy names use 50-row pages and a separate total from canonical latest accepted movements. Table cards and the dashboard use aggregate counts across the full authorised scope, not the loaded guest page. Attendance counts use database aggregates, including unallocated guests for supervisors. The legacy full response remains available for older clients during rollout.

Every read rechecks membership, supervisor rights, current assignments and shift boundaries before comparing a revision. The revision covers roster/menu/fulfillment/seating/scanner changes, team and location metadata, role scope and serving-window transitions. An unchanged response contains no roster payload. The client pauses hidden-tab polling, debounces guest search and forces a full read at least every two minutes. A guest/category choice index supports aggregate existence checks.

## Offline observations and replay

Previously loaded pages are cached in IndexedDB for the signed-in account and selected event (up to 12 pages per event, expiring after 12 hours). The staff service worker caches only the static Guest Services shell and build assets: it does not cache API responses or credentials. Offline reload uses the already signed-in Firebase identity and a matching session profile; a new sign-in requires connection. Explicit sign-out clears cached pages and the session profile. Pending action IDs stay partitioned to the original account and event.

Only positive `seated`, `served`, and `attendance` observations are queued. There are no queued admission/room scans, corrections, menu edits, preparations or setup changes. Count meal attendance by opening an already authorised guest; QR tokens are never persisted in the replay queue. Queued observations store operation/guest/table/service IDs, expected state fingerprints and captured time. They do not optimistically change confirmed counts. The queue is bounded to 100 operations and duplicate pending taps are coalesced. A browser storage failure is shown; it does not claim the observation was saved.

On reconnect the server checks current membership, active assignment, table, admission, paid access, event status, meal mode, eligibility, serving window and capacity. Changed table/state/choices or expired captures stop that action for review; dependent observations for the same guest wait. Separate actions from the same queue can advance their expected ledger timestamp only after a successful acknowledged action. Server receipts are unique per event, actor and client key and are committed atomically with the existing ledger writes. Concurrent retries return the same receipt; a lost response or later attendance/seating correction cannot cause a retry to reapply the original observation. Known access loss clears cached pages. Offline observations and sync times are written to GuestServiceActivity.

Full tests must include PostgreSQL capacity/receipt races, page totals independent of page size, scope changes during an unchanged poll, real browser IndexedDB/service-worker reload, account isolation, reconnect conflicts, responsive views and a representative large-event read workload. Production validation never invents staff assignments or mutates customer attendance solely for testing.
