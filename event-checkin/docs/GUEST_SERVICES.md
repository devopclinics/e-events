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
- The workspace requires a connection and refreshes every 20 seconds; it does not claim offline writes are saved.

## Validation

Backend regression coverage lives in `tests/test_guest_services.py`. Mounted UI tests live in `frontend/tests/guest-services.test.mjs`. The opt-in PostgreSQL test verifies additive migration, same-guest duplicate serving and competing guests against one remaining serving capacity. It accepts only an explicitly configured disposable localhost `guest_service_fixture*` database.

Shared Help is updated in `frontend/src/guideContent.mjs`; the support knowledge and internal media documentation are regenerated from that source. API contracts and frontend schema types include the new routes and request bodies.
