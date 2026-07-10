# Festio Experience Platform Implementation Plan

_Status: implementation plan. Last updated 2026-07-04._

## 1. Objective

Transform the current EventQR/Festio event check-in product into an enterprise attendee journey platform without disrupting existing customers.

The core architectural move is to add an Experience layer: a configurable workflow engine that lets an organizer define attendee journey steps such as RSVP, approval, check-in, consent, souvenir pickup, badge pickup, room assignment, seating, meal choice, session attendance, certificate issue, and checkout.

This plan is intentionally incremental. The current codebase is a FastAPI backend, React/Vite frontend, PostgreSQL database, and small auxiliary services for messaging and design. The first implementation should extend this architecture before extracting new services.

## 2. Current Foundation To Reuse

Reuse these existing platform capabilities:

- Organizations, memberships, event teams, staff assignment, and operator console.
- Event lifecycle: draft, active, ended.
- RSVP and invite flows, including open and closed invite modes.
- Guest records, QR tickets, scanner admission, manual check-in, self check-in, and event pass gating.
- Seating tables, table groups, section-based scanning, and first-come-first-served assignment.
- Menu categories, menu choices, and kitchen dashboard.
- Messaging, guest hub, announcements, email, SMS, WhatsApp, and message credits.
- Logistics, registry, design studio, pricing plans, billing, and trial requests.
- Existing tenant isolation tests and entitlement tests.

Do not replace these with a new system. Wrap them as workflow step handlers.

## 3. Target Architecture

### 3.1 Experience Layer

Add an Experience layer inside `event-checkin/backend/app`:

- `models.py`: workflow definitions, workflow steps, guest progress, step events, and audit logs.
- `routers/experience.py`: admin and staff APIs for configuring and operating workflows.
- `services/experience.py`: workflow validation, condition evaluation, step execution, and progress state transitions.
- `schemas.py`: request and response models for workflow configuration and runtime actions.

The Experience layer should orchestrate existing modules instead of duplicating their business logic. For example:

- A `check_in` workflow step calls the existing scanner admission logic.
- A `room_assignment` or `seating_assignment` step calls the existing table/table-group assignment logic.
- A `meal_selection` step links to existing menu choice logic.
- A `message_guest` step uses existing messaging services.

### 3.2 Future Extraction Boundary

Keep the first version inside the FastAPI backend. Extract to a separate Experience Service only after the internal API and data model stabilize.

Extraction-ready boundaries:

- Workflow definition CRUD.
- Workflow runtime state transitions.
- Event log emission.
- Analytics projections.

## 4. Data Model

Add the following tables.

### `experience_workflows`

One workflow per event for the first release.

Fields:

- `id`
- `event_id`
- `name`
- `status`: `draft`, `published`, `archived`
- `version`
- `is_default`
- `created_by`
- `created_at`
- `updated_at`

Constraints:

- Unique active default workflow per event.
- Published workflows are immutable; editing creates a new version.

### `experience_steps`

Configurable steps inside a workflow.

Fields:

- `id`
- `workflow_id`
- `key`: stable identifier such as `main_checkin`, `consent`, `souvenir_pickup`
- `type`: `rsvp`, `approval`, `check_in`, `consent`, `souvenir`, `badge`, `room_assignment`, `seating_assignment`, `meal_selection`, `session_attendance`, `certificate`, `checkout`, `custom`
- `title`
- `description`
- `sort_order`
- `required`
- `enabled`
- `conditions`: JSON rule tree
- `config`: JSON step-specific settings
- `created_at`
- `updated_at`

### `guest_experience_progress`

One row per guest per workflow step.

Fields:

- `id`
- `event_id`
- `workflow_id`
- `step_id`
- `guest_id`
- `status`: `not_started`, `available`, `blocked`, `completed`, `skipped`, `failed`, `overridden`
- `completed_at`
- `completed_by_user_id`
- `completed_by_source`: `guest`, `staff`, `admin`, `system`, `offline_sync`
- `override_reason`
- `metadata`: JSON
- `created_at`
- `updated_at`

Constraints:

- Unique `(guest_id, step_id)`.
- Index `(event_id, guest_id)`.
- Index `(event_id, step_id, status)`.

### `experience_events`

Append-only operational event log.

Fields:

- `id`
- `event_id`
- `workflow_id`
- `step_id`
- `guest_id`
- `actor_user_id`
- `event_type`: `step_available`, `step_completed`, `step_skipped`, `step_failed`, `override_applied`, `offline_action_synced`
- `source`
- `payload`: JSON
- `occurred_at`

Use this for analytics, auditability, and future event-driven integration.

### `souvenir_inventory_items`

Inventory items managed per event.

Fields:

- `id`
- `event_id`
- `name`
- `sku`
- `variant`
- `quantity_total`
- `quantity_reserved`
- `quantity_distributed`
- `created_at`
- `updated_at`

### `souvenir_distributions`

Guest-level distribution log.

Fields:

- `id`
- `event_id`
- `guest_id`
- `inventory_item_id`
- `quantity`
- `distributed_by_user_id`
- `distributed_at`
- `source`
- `notes`

## 5. Workflow Step Types

Implement step types in this order.

### Phase 1 Step Types

- `check_in`: wraps existing QR/manual admission.
- `seating_assignment`: wraps existing seating and table group logic.
- `meal_selection`: exposes existing menu choice completion.
- `consent`: captures required acknowledgements or waiver acceptance.
- `custom`: staff/admin marks step complete with optional notes.

### Phase 2 Step Types

- `souvenir`: decrements event inventory and records distribution.
- `badge`: marks badge printed or picked up.
- `session_attendance`: tracks program/session QR scans.
- `checkout`: marks final departure or completion.

### Phase 3 Step Types

- `room_assignment`: extends table group concepts into room/block assignment.
- `certificate`: issues completion certificate after prerequisite steps.
- `message_guest`: triggers configured communication after a step.
- `webhook`: emits a signed webhook to customer systems.

## 6. API Plan

Add `app.routers.experience` and mount it at `/api/events`.

### Admin Workflow APIs

- `GET /api/events/{event_id}/experience/workflows`
- `POST /api/events/{event_id}/experience/workflows`
- `GET /api/events/{event_id}/experience/workflows/{workflow_id}`
- `POST /api/events/{event_id}/experience/workflows/{workflow_id}/publish`
- `POST /api/events/{event_id}/experience/workflows/{workflow_id}/clone`
- `PUT /api/events/{event_id}/experience/workflows/{workflow_id}/steps/{step_id}`
- `POST /api/events/{event_id}/experience/workflows/{workflow_id}/steps/reorder`
- `DELETE /api/events/{event_id}/experience/workflows/{workflow_id}/steps/{step_id}`

### Runtime APIs

- `GET /api/events/{event_id}/experience/guests/{guest_id}`
- `POST /api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}/complete`
- `POST /api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}/skip`
- `POST /api/events/{event_id}/experience/guests/{guest_id}/steps/{step_id}/override`
- `POST /api/events/{event_id}/experience/offline-sync`

### Analytics APIs

- `GET /api/events/{event_id}/experience/dashboard`
- `GET /api/events/{event_id}/experience/steps/{step_id}/guests`
- `GET /api/events/{event_id}/experience/export.csv`

## 7. Frontend Plan

Add workflow UI inside `event-checkin/frontend/src/pages/AdminPage.jsx` first, then split components after the shape stabilizes.

### Organizer Admin UI

Add an `Experience` tab with:

- Workflow status: draft or published.
- Step list with drag-and-drop reorder.
- Step enable/disable toggles.
- Step type selector.
- Required/optional toggle.
- Step condition editor for simple rules.
- Publish button.
- Version history.

Start with simple controls. Avoid a full visual node editor in the first release.

### Staff Runtime UI

Extend scanner/manual check-in screens:

- After scanning a guest, show the next required step.
- Staff can complete, skip, or escalate a step based on permission.
- Show blocked prerequisites clearly.
- Preserve the current fast green/admitted result for simple events.

### Guest UI

Extend invite/ticket pages:

- Show guest-facing required steps when relevant.
- Consent step can be completed by the guest.
- Meal-selection step can reuse existing menu UI.
- Hide staff-only steps from guests.

### Operator UI

Extend console later with:

- Feature flag controls.
- Workflow usage by tenant.
- Failed/offline sync diagnostics.

## 8. Permissions And Controls

Add step-level permissions:

- Organizer admins can configure workflows.
- Staff can complete allowed operational steps.
- Guests can complete guest-facing steps only.
- Platform superadmins can override any step, with mandatory reason.

Add event-level feature flags:

- `experience_enabled`
- `experience_workflow_builder_enabled`
- `souvenir_inventory_enabled`
- `program_attendance_enabled`
- `offline_experience_sync_enabled`

For compatibility, all flags default to off. Existing events behave exactly as they do today until enabled.

## 9. Migration Strategy

### Initial Migration

Add nullable workflow tables and feature flags. Do not change existing scanner, RSVP, seating, or menu behavior by default.

### Backfill

When `experience_enabled` is first turned on for an event:

1. Create a default workflow from existing enabled event features.
2. Add `check_in` if the event has paid check-in.
3. Add `seating_assignment` if seating is enabled.
4. Add `meal_selection` if menu is enabled.
5. Initialize progress rows for existing guests.
6. Mark already admitted guests as completed for `check_in`.
7. Mark seated guests as completed for `seating_assignment`.
8. Mark guests with menu choices as completed for `meal_selection`.

### Rollback

Turning off `experience_enabled` must leave legacy behavior intact. Keep workflow data but stop using it in runtime paths.

## 10. Offline Scanning And Sync

Add offline sync only after the online workflow runtime is stable.

Client-side requirements:

- Store pending scan and step actions in IndexedDB.
- Generate deterministic client action IDs.
- Show local pending status.
- Retry sync when connectivity returns.

Backend requirements:

- `POST /experience/offline-sync` accepts batched actions.
- Each action is idempotent by client action ID.
- Server returns accepted, rejected, duplicate, or conflict.
- Conflicts must not silently overwrite server state.

## 11. Program Attendance

Model sessions as workflow-compatible steps.

Add:

- `program_sessions`
- `session_tracks`
- `session_locations`
- `session_attendance`

Each session gets a QR code. Scanning the session QR puts staff into session attendance mode; scanning a guest pass records attendance for that session.

## 12. Analytics And Reporting

Build reports from `experience_events` and progress rows:

- Funnel completion by step.
- Guests blocked at each step.
- Staff throughput by step.
- Check-in rate over time.
- Session attendance.
- Souvenir inventory remaining.
- Override report.
- Offline sync conflict report.

Export CSV first. Add charts after the data model is stable.

## 13. Security And Compliance

Requirements:

- Preserve tenant isolation on every Experience API.
- Validate workflow JSON with strict schemas.
- Do not execute arbitrary expressions from workflow conditions.
- Audit every override and admin workflow publish.
- Make published workflow versions immutable.
- Keep PII out of low-level logs.
- Rate-limit public guest-facing workflow actions.
- Sign future webhook payloads.

## 14. Testing Plan

Backend tests:

- Workflow CRUD and publish.
- Step ordering and validation.
- Default workflow creation from existing event settings.
- Progress initialization for old guests.
- Check-in step integration with scanner admission.
- Condition matching for VIP, RSVP status, ticket type, and guest tags.
- Consent signing, version preservation, and signed-copy download.
- Scanner next-step output and staff completion of operational steps.
- Seating step integration with table group restrictions.
- Meal step integration with existing menu choices.
- Tenant isolation for every Experience endpoint.
- Staff permission boundaries.
- Idempotent offline sync.

Frontend tests:

- Admin can build and publish a basic workflow.
- Scanner still performs fast legacy check-in when Experience is disabled.
- Scanner shows next steps when Experience is enabled.
- Scanner can complete custom/operational next steps.
- Guest can complete consent.
- Mobile viewport does not overflow step controls.

Operational tests:

- Large event with 50,000 guests and 10 workflow steps.
- Concurrent scans at multiple entrances.
- Offline scan replay with duplicates and conflicts.

## 15. Delivery Phases

### Phase 0: Product Hardening And Naming

Outcome: current product remains stable while the new architecture is documented and gated.

Tasks:

- Add this implementation plan to docs.
- Decide whether public docs should continue using `EventQR` or move fully to `Festio`.
- Inventory all existing feature flags and entitlement gates.
- Add `experience_enabled` feature flag to events.

### Phase 1: Workflow Core

Outcome: an organizer can create and publish a simple workflow, and admins can inspect per-guest progress.

Tasks:

- Add workflow, step, progress, and event-log models.
- Add admin CRUD APIs.
- Add publish/version rules.
- Add default workflow generator.
- Add progress initialization.
- Add tenant isolation tests.

### Phase 2: Runtime Integration

Outcome: workflow steps can drive real event operations without breaking legacy check-in.

Tasks:

- Wrap scanner admission as `check_in`.
- Wrap seating/table group assignment as `seating_assignment`.
- Wrap menu choice completion as `meal_selection`.
- Add `consent` and `custom` steps.
- Extend scanner result UI with next-step state.
- Add dashboard summary.

### Phase 3: Inventory And Program Attendance

Outcome: Festio supports souvenir distribution and session attendance.

Tasks:

- Add inventory tables and APIs.
- Add `souvenir` step handler.
- Add program/session tables and APIs.
- Add session QR flow.
- Add attendance reports.

### Phase 4: Offline Operations

Outcome: staff can scan and complete steps during connectivity loss.

Tasks:

- Add IndexedDB pending action queue.
- Add idempotent offline sync endpoint.
- Add conflict handling UI.
- Add operational diagnostics.

### Phase 5: Enterprise Controls

Outcome: platform can support larger organizations and compliance-sensitive customers.

Tasks:

- Add workflow templates. **Implemented in the Admin Experience tab for VIP dinner, conference registration, wedding reception, and simple check-in.**
- Add advanced conditional rules. **Implemented for VIP, RSVP status, ticket type id/name, and guest tag include/all/exclude conditions.**
- Add role/permission controls per step.
- Add signed webhooks.
- Add immutable audit exports.
- Add performance dashboards.

### Current Non-Production Implementation Status

Completed in the Docker Compose test stack:

- Workflow lifecycle: draft, published, archived, unarchived, clone, and one-live-workflow enforcement.
- Workflow templates for VIP dinner, conference registration, wedding reception, and simple check-in.
- Guest journey collapse/expand and selected workflow collapse/expand.
- Consent forms with append-only versions; editing creates a new active version and preserves old signed text.
- Guest consent signing from the pass page with signed-copy download and email-link send.
- Runtime progress sync for check-in, seating assignment, meal selection, and consent signing.
- Conditions engine for VIP, RSVP status, ticket type id/name, and guest tags.
- Scanner next-step display and staff completion for custom/operational steps.
- Experience dashboard, audit list, workflow/status filters, audit filter, and CSV export.
- Focused backend tests for workflow rules, conditions, consent versioning/sign/download, scan next steps, and staff runtime completion.
- Browser smoke test against the Docker Compose test frontend.

Deferred until production work resumes:

- Production migration/release path.
- PDF attachment generation for signed consent copies.
- Offline queue and replay.
- Role/permission controls per step.
 
Completed after the non-production hardening pass:

- Signed consent PDF download and email attachment.
- Offline localStorage queue/replay for scanner Experience step completions.
- Offline scanner guest manifest, local QR admission for known guests, and queued backend replay when online.
- Per-step role controls via step `config.allowed_roles`.
- Analytics endpoint and admin summary for consent completion, bottlenecks, overrides, throughput, and timing.
- Consent signature list in the Experience UI.
- Gate scanner authorization now matches QR/manual scanner assignment rules: org owners/admins can scan, staff must be assigned to the event.
- Gate first-entry admission now goes through the standard admission engine for seating, notifications, Experience sync, and dashboard broadcast side effects.
- Scanner/runtime Experience next steps now honor `event.experience_enabled`; disabled/unpublished Experience does not surface non-operable steps.
- Scanner event configuration refreshes periodically and on window focus so status/mode changes do not require a page reload.
- Admin dashboard, analytics, guest journey, and CSV export now also honor `event.experience_enabled`.
- Step dependency enforcement is implemented through step config keys such as `depends_on`, `depends_on_keys`, or `prerequisites`; blocked steps do not appear as scanner next actions and cannot be completed until their prerequisites are complete.
- Analytics timing no longer uses progress-row creation time as a fake operational duration. Timing rows now report `not_collected` unless explicit `started_at` or `available_at` metadata exists.
- Scanner next-step output is no longer capped; staff can see the full pending runbook from the scanner result.
- Offline manifest now includes venue zones, gates, ticket-zone permissions, guest tag assignments, zone tag rules, and cached occupancy. Standard QR admission, manual zone scans, and gate scans can be queued locally and replayed through the normal online endpoints when connectivity returns.

Current launch constraint:

- Offline venue access uses an optimistic device-local decision. Capacity is checked against the device cache while offline; replay through the backend remains the source of truth if another device changed occupancy or event rules during the outage.

## 16. First Implementation Slice

The first shippable slice should be small:

1. Add `experience_enabled` to `Event`.
2. Add workflow, step, progress, and event-log tables.
3. Add API endpoints to create a default workflow for an event.
4. Add a read-only admin view of the workflow.
5. Backfill progress for check-in, seating, and menu from existing data.
6. Add tests proving legacy check-in is unchanged when `experience_enabled` is false.

This creates the foundation without changing the day-of-event critical path.

## 17. Acceptance Criteria

The implementation is ready for beta when:

- Existing EventQR/Festio event creation, RSVP, invite, payment, QR scan, seating, menu, and messaging flows still pass tests.
- A paid event can enable Experience without losing existing guests or check-in history.
- An organizer can publish a workflow with at least check-in, consent, seating, and meal steps.
- Staff can complete operational steps from a mobile scanner screen.
- Guests can complete a guest-facing consent step.
- Admins can see per-step completion counts and export the data.
- Platform operators can disable Experience for an event without data loss.
