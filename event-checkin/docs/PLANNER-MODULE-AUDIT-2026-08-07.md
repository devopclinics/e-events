# Festio Planner Module — Evidence-Based Audit

Date: 2026-08-07  
Scope: repository and local staging-runtime inspection; no application, database, configuration, or UI changes  
Classification vocabulary: Complete, Partial, UI Only, Backend Only, Broken, Missing, Duplicate, Not Applicable

## 1. Executive summary

Festio is not yet a complete professional event-planning platform when judged against the requested `Plan → Budget → Assign → Coordinate → Execute → Monitor → Report` workflow. It is a strong event-operations platform with substantial reusable capabilities, but the dedicated planner module is currently a compact six-tab microservice: Dashboard, Budget, Vendors, Timeline, Runsheet, and Documents.

The most important finding is architectural duplication. Festio has two task systems:

- Core tasks support real user IDs, cross-event “My Tasks,” subtasks, comments, attachments, activity history, assignee notifications, optimistic concurrency, and task status actions.
- Planner tasks support milestones, priority, a vendor link, and a free-text `assigned_to` value, but none of the richer core task collaboration workflow.

These systems do not synchronize. A task created in Planner does not enter My Tasks, notify a real assignee, carry comments/attachments, or appear in core task reporting. Building more workflow features on `planner_tasks` would deepen the duplication.

The planner dashboard is accurate for its own small database, but it is not a command center. It does not aggregate event details, guest/RSVP status, team workload, approvals, seating readiness, communications, incidents, inventory, check-in, ticket revenue, feedback, or cross-event portfolio status.

Security and authorization need attention before broad production rollout. All event members who can obtain a planner token can create or modify budgets, vendors, payments, milestones, tasks, runsheets, and documents. Only some deletion operations require the coarse `admin` role. There are no capability-level controls for sensitive financial or document data. Document download uses an unguessable public URL instead of authenticated or expiring access. Uploads have no explicit file type or size limit.

### Overall planner-readiness score: **44/100**

Recommended production posture: keep Planner feature-gated. It is suitable for a trusted internal event team using lightweight budgeting, vendors, milestones, runsheets, and a basic document vault. It should not yet be marketed as a complete multi-client professional planner workspace or event-day command center.

## 2. Feature-area scores

| Feature area | Score | Classification | Summary |
|---|---:|---|---|
| Planner dashboard | 45 | Partial | Live rollups for planner-local budget, vendors, tasks, documents, milestones, and runsheet only |
| Tasks and workflows | 35 | Duplicate / Partial | Planner milestones work, but duplicate the substantially richer core task engine |
| Budget and financial planning | 45 | Partial | Basic budget/categories/items/quotes/actuals; no approvals, income, tax, attachments, audit, exports, or reminders |
| Vendor management | 45 | Partial | Event vendors and payments work; no org directory, RFQ workflow, portal, communications, compliance, deliverables, or e-signature |
| Timeline, agenda, and runsheet | 35 | Partial | Ordered single-day time-of-day list; no dates, conflicts, dependencies, notifications, export, or guest publishing |
| Venue, floor plan, and seating | 60 | Partial | Strong reusable core floor/seating capabilities, but weak planner integration and no layout version history |
| Team and volunteer coordination | 45 | Partial | Core teams/tasks exist; no planner workstreams, shifts, availability, volunteer attendance, or planner workload rollup |
| Guest and protocol planning | 75 | Partial | Strong guest/RSVP/seating/experience platform; planner does not surface or coordinate it |
| Documents and approvals | 30 | Partial | Upload/list/download/status/expiry work; security, versioning, approval, annotation, e-signature, and reminders are absent |
| Inventory, rentals, gifts, logistics | 35 | Partial | Shipments, registry, experience completion exist elsewhere; no general inventory/custody/returns/damage workflow |
| Communication and notifications | 70 | Partial | Strong platform channels/templates/delivery reporting; planner records do not trigger them |
| Event-day command center | 45 | Partial | Scanner/check-in operations are strong; planner runsheet/tasks/vendors/incidents are not combined into one live view |
| Incident and issue management | 5 | Missing | No meaningful incident model or end-to-end incident workflow found |
| Reporting and evaluation | 50 | Partial | Attendance/feedback/export capabilities exist elsewhere; no consolidated final planner report or event comparison |
| Platform-wide quality | 40 | Partial | Responsive basics and event scoping exist; granular RBAC, validation, audit, realtime, offline, scale, and E2E coverage are insufficient |

## 3. Architecture and current workflow map

```text
Organization / Event membership
        |
        +--> Core backend
        |     +-- Guests, RSVP, approvals, seating, floor plan
        |     +-- Core tasks, subtasks, comments, files, activity, notifications
        |     +-- Team/event permissions
        |     +-- Messaging, templates, delivery logs
        |     +-- Check-in, Experience, sessions, feedback, shipments, registry
        |     +-- Reports and exports
        |
        +--> short-lived event-scoped planner JWT
              |
              +--> Planner service / separate database
                    +-- Budget + categories + items + quote map
                    +-- Event-local vendors + payment schedule
                    +-- Milestones + duplicate planner tasks
                    +-- Single-day runsheet
                    +-- Document metadata + local file storage
                    +-- Planner-local dashboard rollups
```

Current planner workflow:

1. An administrator enables `event.planner_enabled`.
2. Any org owner/admin or assigned event member can open Planner.
3. The core backend mints a 15-minute token scoped to one event and one org.
4. The frontend calls the planner service directly.
5. The user manually creates budget data, event-local vendors, milestones/tasks, runsheet entries, and documents.
6. Planner data stays in the planner database and is not projected into core Tasks, Communications, Results, Scanner, Experience, or portfolio views.

## 4. Evidence inventory

### Dedicated planner functionality confirmed

- Feature flag and guarded navigation: `Event.planner_enabled`, Planner shell gate.
- Event-scoped JWT exchange and event-ID checks in all authenticated planner routers.
- Budget envelope, categories, line items, estimated/actual totals, status, vendor link, and quote comparison.
- Event-local vendor records, status, contact information, amounts, deposits, ratings, and payment schedules.
- Milestones with completion percentage and lightweight tasks.
- Ordered runsheet entries with time, owner, cue, notes, and status.
- Document upload, event/vendor/type filtering, metadata editing, download, expiry date, and deletion.
- Dashboard rollups for budget, vendor counts, milestones, upcoming/overdue planner tasks, expiring documents, and next runsheet item.
- Responsive CSS breakpoints for dashboard and vendor grids.

### Reusable core capabilities confirmed outside Planner

- Organizations, event membership, event-specific permissions, and access revocation.
- Core tasks with real assignees, subtasks, comments, attachments, activity history, notification, conflict protection, and cross-event My Tasks.
- Guest imports, RSVP, approval/waitlist, households, tags/categories, table groups, tables, seats, floor plans, auto-assignment, and PDF floor-plan export.
- Communication templates across email/SMS/WhatsApp/MMS, targeting, consent, delivery state, retries, and audits.
- Check-in/scanner operations and real-time-oriented station UI.
- Experience workflows, rooms/sessions, session attendance, consent, souvenir steps, feedback, and audits.
- Shipping/logistics and registry capabilities.
- Attendance, feedback, guest, seating, and other exports in core modules.

### No complete implementation found

- General incident management.
- Planner portfolio dashboard for all assigned events.
- Staff/volunteer shift scheduling and attendance.
- General inventory/rental custody, damage, loss, and returns.
- Planner approvals for tasks, budgets, purchases, documents, or quotations.
- Consolidated final event report and cross-event comparison.
- Planner offline mode or real-time synchronization.

## 5. Detailed gap matrix

| ID | Feature Area | Requirement | Status | Frontend Evidence | Backend/API Evidence | Database Evidence | Role Tested | Problem or Gap | Business Impact | Severity | Recommendation |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PL-001 | Architecture | Unified tasks/workflows | Duplicate | Planner Timeline and core Task Board are separate | `/api/planner/{event}/tasks` and `/api/{event}/tasks` are unrelated | `planner_tasks` and `tasks` | Code-traced member/admin | Planner tasks do not notify, appear in My Tasks, or inherit collaboration features | Missed work and inconsistent source of truth | Critical | Retire planner task writes and use core tasks with planner metadata/milestones |
| PL-002 | Authorization | Financial access controls | Partial | Budget controls shown to every planner-page user | All create/update budget endpoints require only event scope | No budget ACL or approval fields | Token roles traced | Ordinary event members can change total budget and financial line items | Confidentiality and fraud risk | High | Add planner capabilities such as view/manage budget, vendors, documents, runsheet |
| PL-003 | Authorization | Consistent admin behavior | Broken | Delete controls are not role-aware | Several deletes require exact `role == admin`; writes do not | N/A | Owner is normalized to admin at token mint; event members become member | UI exposes actions that may 403; policy is coarse and inconsistent | Confusion and weak least privilege | High | Return capabilities in token/API and conditionally render controls |
| PL-004 | Documents | Secure file access | Partial | Plain anchor opens file URL | Download route deliberately has no auth and uses URL possession | UUID-prefixed filename in document row | Anonymous route test | Links are effectively bearer credentials with no expiry/revocation event except deletion | Contract/invoice leakage if URL is shared or logged | High | Authenticated fetch/download or short-lived signed URL with audit |
| PL-005 | Documents | Safe uploads | Partial | Generic file input | Upload reads full file into memory; no MIME allowlist or explicit size cap | Arbitrary file metadata | Code trace | Storage exhaustion, unsafe content, and memory pressure are possible | Security and availability risk | High | Enforce size/type, stream storage, scan files, and use object storage |
| PL-006 | Dashboard | Portfolio view | Missing | Current event only | JWT and dashboard are single-event scoped | All planner entities event-local | Code trace | Professional planners cannot manage concurrent client events | Core agency workflow blocked | High | Add org-scoped portfolio endpoint with assigned events, deadlines, risk and workload |
| PL-007 | Dashboard | Complete readiness | Partial | Seven planner-local cards | Aggregates only planner DB | No cross-service read model | Code trace | No guest, team, approvals, seating, communications, incidents, inventory, or check-in readiness | Late issues remain invisible | High | Build event-readiness projection from core and planner events |
| PL-008 | Tasks | Collaboration workflow | Partial | Planner task modal has title, text assignee, date, priority, status, notes, vendor | Simple CRUD only | Free-text `assigned_to` | Code trace | No users, collaborators, subtasks, comments, files, dependencies, reminders, history, or approvals | Tasks cannot coordinate a real team | Critical | Reuse core task engine and add milestones/dependencies/templates there |
| PL-009 | Tasks | Templates and recurrence | Missing | None | None in planner service | None | Code trace | Every event plan must be rebuilt manually | High setup time and inconsistent delivery | High | Event-type checklist templates, recurrence, and duplicate-event copy |
| PL-010 | Budget | Complete cost lifecycle | Partial | Total/category/item forms and quote table | Basic CRUD/rollups | Estimated, actual, paid_at, simple status | Code trace | No approved/committed states, tax, charges, discount, invoice linkage, approvals, or history | Financial reports are incomplete | High | Introduce cost lifecycle, purchase approvals, document links, immutable activity |
| PL-011 | Budget | Income and event economics | Missing | None | None | None | Code trace | Sponsorships, donations, ticket revenue, and other income cannot be planned together | No profit/loss view | High | Unified event financial plan with income sources and ticketing/registry links |
| PL-012 | Budget | Validation and currency | Broken | Currency is unrestricted text; numbers accept negatives | Schemas lack enum/range constraints | Numeric values accept invalid semantics | Code trace | Invalid statuses, negative amounts, and malformed currency can be persisted | Incorrect totals and reports | High | Strict enums, ISO currency validation, non-negative constraints, DB checks |
| PL-013 | Budget | Export/audit | Missing | No export control | No export or audit endpoint | No activity table | Code trace | Finance cannot reconcile or evidence changes | Weak governance | High | CSV/XLSX/PDF exports plus append-only budget audit history |
| PL-014 | Vendors | Organization vendor directory | Partial | Event card grid only | Vendors are event-scoped | `PlannerVendor.event_id` required | Code trace | Vendor profiles cannot be reused across events or clients | Duplicate entry and lost institutional knowledge | Medium | Org vendor directory plus event engagements |
| PL-015 | Vendors | Sourcing and contracting | Partial | Manual quote map and contract URL | No RFQ, proposal decision, signature, or portal workflow | Quote values are unstructured JSON | Code trace | Quotes are not vendor-submitted or auditable; contracts are links/files only | Manual email/spreadsheet workflow remains | High | Structured RFQs, quote versions, acceptance, e-signature integration, vendor portal |
| PL-016 | Vendors | Delivery and compliance | Missing | No schedule/compliance UI | No workflow | No compliance/deliverable fields | Code trace | Arrival, setup, teardown, insurance, licenses, and deliverables are not managed | Event-day vendor failures | High | Vendor engagements, deliverables, compliance documents, arrival status and reminders |
| PL-017 | Runsheet | Multi-day schedule | Broken | Only start/end time fields | Model has `Time`, no date/day/timezone | No event-day/date column | Code trace | Multiple days and overnight items cannot be represented unambiguously | Conference/religious multi-day plans fail | Critical | Store timezone-aware start/end datetimes and day grouping |
| PL-018 | Runsheet | Conflict/dependency/change handling | Missing | Manual arrows and status | No conflict detection, dependencies, notifications, or history | None | Code trace | Schedule collisions and late changes are not controlled | Event-day disruption | High | Conflict engine, dependency links, version/audit, targeted change notifications |
| PL-019 | Runsheet | Distribution/export | Missing | No print/export/publish | No export/public API | None | Code trace | Staff, vendors and guests cannot receive authoritative run sheets | Teams work from screenshots | High | Printable PDF/CSV, mobile read-only view, role/vendor share links |
| PL-020 | Venue | Planner integration | Partial | Floor/seating live in other navigation modules | Core APIs are functional but absent from planner dashboard/workflow | Core floor/table/group models | Code trace | Planner cannot see venue readiness alongside planning work | Fragmented workflow | Medium | Embed readiness/deep links and reuse rooms/zones rather than duplicate |
| PL-021 | Venue | Layout versions and safety | Partial | Floor plan editor/PDF exist elsewhere | No planner version approval flow found | One current floor plan | Code trace | No approved layout snapshot, rollback, emergency-exit validation | Operational and compliance risk | Medium | Versioned layouts, approval state, capacity/accessibility/emergency checks |
| PL-022 | Team | Workload and shifts | Partial | Core team and My Tasks exist; Planner does not use them | No shifts/availability/attendance in planner | No shift model found | Code trace | Cannot schedule volunteers or see workload across workstreams/events | Staffing gaps | High | Team workstreams, availability, shifts, check-in and workload projection |
| PL-023 | Guests | Planner protocol view | Partial | Strong Guest/RSVP pages elsewhere | Core APIs support many requirements | Rich core guest model | Code trace | Planner dashboard has no protocol, accessibility, dietary, transport or accommodation readiness | Important guest needs can be missed | Medium | Planner readiness cards and privacy-aware protocol filters over core guests |
| PL-024 | Documents | Versioning/approval/e-signature | Missing | Status dropdown only | No comments, versions, decision or signature endpoints | Single document row | Code trace | Contracts and approvals remain manual and unaudited | Legal/procurement risk | High | Document versions, approval requests, comments, signature integration and audit |
| PL-025 | Inventory | General inventory and rentals | Missing | None | Shipment/registry/experience features are narrow substitutes | No general inventory model | Code trace | Equipment, rentals, custody, losses and returns cannot be controlled | Cost loss and event-day shortages | High | Reusable inventory catalog, event allocations, movements, scans, custody and alerts |
| PL-026 | Communications | Planner-triggered automation | Backend Only / Partial | Communications UI is separate | Strong messaging backend; planner has no integration or jobs | No planner notification/outbox tables | Code trace | Task overdue, payment due, document expiry, vendor arrival and schedule change produce no automated messages | Manual follow-up and missed deadlines | High | Publish planner domain events to existing messaging/outbox system |
| PL-027 | Command center | Unified live operations | Partial | Scanner command UI and Planner runsheet are separate | No consolidated API or realtime planner feed | No incident/vendor-arrival/shift state | Code trace | Planner must switch modules and cannot see a shared operating picture | Slower response on event day | Critical | Mobile command center combining readiness, runsheet, attendance, staff, vendors, incidents and inventory |
| PL-028 | Incidents | Issue lifecycle | Missing | None | None | None | Code trace | No structured way to log, own, escalate, resolve, restrict or report incidents | Safety and accountability risk | Critical | Incident service/model integrated with tasks, alerts, media, audit and final reporting |
| PL-029 | Reporting | Final planner report | Missing | No planner report/export | Planner has no reporting endpoints | No snapshot/comparison model | Code trace | Cannot close an event with budget/vendor/team/incident lessons in one report | Weak client reporting and continuous improvement | High | Consolidated final report, exports, snapshots and cross-event comparisons |
| PL-030 | Realtime/offline | Shared event-day state | Missing | No polling, SSE/WebSocket, or offline queue in Planner | CRUD request/response only | No sync/version metadata on most entities | Code trace | Concurrent operators can overwrite or work from stale data; venue outages stop Planner | Event-day reliability risk | Critical | Realtime subscriptions, optimistic versions, offline read/cache and queued safe mutations |
| PL-031 | Quality | Automated workflow coverage | Partial | No Planner Playwright specs found | 18 planner tests pass | Test DB workflows not covered | Admin/member scope samples | Tests do not cover CRUD, role matrix, exports, mobile, scale, or scenarios | Regressions may reach production | High | API integration, browser, accessibility, role, concurrency, and scale suites |
| PL-032 | Scale | Pagination/search/filtering | Partial | Vendor cards and most tables have no search/filter/pagination | List endpoints generally return all rows; vendors/docs accept limited filters | No pagination indexes/contracts | Code trace | Large conferences/agencies will degrade and become hard to navigate | Scale ceiling | Medium | Server pagination, search, saved filters and indexed sort fields |

## 6. Workflow scenario results

These are evidence-based workflow traces through the available UI/API/model contracts. No shared staging records were mutated.

### Scenario A — Wedding planner

Works:

- Create the event in core Festio and enable Planner.
- Create a total budget, categories, cost items, estimated/actual values, and manual vendor quote comparisons.
- Add event-local vendors and payment schedules.
- Create milestones and simple tasks.
- Use core guest/RSVP, households, table groups, seating and floor-plan features.
- Upload planner documents and create a day-of runsheet.
- Use core check-in, messaging and attendance reporting.

Stops or needs workaround:

- Committee members are free-text planner assignees rather than linked users.
- Planner tasks do not appear in My Tasks or carry comments, subtasks, files or activity.
- Quotes, approvals, contracts/signatures and purchase approvals require email/manual work.
- Dietary/accessibility/transport/accommodation readiness is not summarized for the planner.
- Rentals/inventory, vendor arrival and incidents require spreadsheets/chat.
- No consolidated final client report.

Result: **Partial; workable for a trusted small team, not a complete professional workflow.**

### Scenario B — Multi-day conference

Works:

- Core Experience can represent sessions, rooms and attendance.
- Planner can track a simple budget, vendors, milestones and documents.
- Core scanner and reporting cover admission/session activity.

Stops or needs workaround:

- Planner runsheet has no date/day and cannot safely represent multiple days.
- Planner tasks are disconnected from speakers, sessions, rooms, volunteers and core tasks.
- No schedule conflict checking or automatic change notification.
- No shift planning, vendor arrival control, incident management or unified live command center.
- No portfolio/organization view across concurrent client events.

Result: **High-severity workflow breaks; not conference-planner complete.**

### Scenario C — Religious/community event

Works:

- Core free RSVP, approvals, guest groups, seating, communications, food/menu, registry, Experience/souvenir and check-in can be reused.
- Planner supports basic budget, vendors, milestones and runsheet.

Stops or needs workaround:

- No donation/income plan inside Planner.
- No committee workstreams or volunteer shifts/attendance.
- Welcome-pack inventory and distribution can be approximated with Experience steps but not stocked, damaged, returned or reconciled.
- No incident/escalation workflow.

Result: **Partial; many operational capabilities exist but are fragmented.**

### Scenario D — Professional event-planning company

Works:

- Organization/event tenancy and event-scoped planner tokens prevent simple cross-event IDOR.
- Individual event workspaces can be feature-gated.

Stops or needs workaround:

- No all-events portfolio dashboard, cross-event deadlines, planner workload or reusable vendor directory.
- Planner authorization has only admin/member and no client/vendor/volunteer/viewer data slices.
- Members can modify sensitive budget/vendor/document data.
- No restricted vendor portal in the planner workflow.
- No event-plan templates, final comparisons or reusable lessons.

Result: **Not ready for an agency operating multiple clients with differentiated access.**

## 7. Role and permission findings

| Role | Effective access found | Finding |
|---|---|---|
| Platform superadmin | Planner admin token | Broad access is expected, but no planner audit records changes |
| Organization owner/admin | Normalized to planner `admin` | Can perform all operations; capability-specific delegation is absent |
| Event manager | Normalized to planner `admin` | Same planner power as org administrators for that event |
| Event member/committee/volunteer | Planner `member` | Can create and update budgets, vendors/payments, tasks, runsheet and documents; excessive for many roles |
| Viewer | No distinct planner role | Missing read-only planner persona |
| Vendor | No planner token/portal | Missing restricted engagement, quote, document and deliverable workflow |
| Scanner | Scanner permissions exist in core | No appropriate reason or explicit path to planner data |

Positive finding: event IDs are embedded in short-lived JWTs and representative tests verify each planner router rejects a different event ID. Negative finding: event scope is not a substitute for functional authorization inside that event.

## 8. Mobile and event-day readiness

- The Planner dashboard and vendor grids have responsive breakpoints.
- Wide budget/runsheet/document tables rely on generic table styling and have no planner-specific mobile card transformation.
- No Planner PWA/offline cache, mutation queue, realtime feed, or stale-data indicator was found.
- Runsheet entries can be manually marked in progress/done, but there is no “now” logic tied to event timezone and no delayed state.
- No vendor arrivals, staff check-in, incidents, urgent escalation, inventory distribution, key-contact panel, or integrated venue map exists in Planner.
- The core Scanner page is considerably more event-day oriented, but it does not include planner runsheet/tasks/vendors.

Conclusion: Planner is mobile-responsive in layout, but not event-day resilient or command-center complete.

## 9. Security and privacy concerns

1. **High — financial over-permission:** ordinary event members can mutate budgets and vendor payments.
2. **High — document bearer links:** planner downloads are unauthenticated, non-expiring possession URLs.
3. **High — unrestricted uploads:** no explicit maximum size, MIME allowlist, malware scanning, or streaming write.
4. **High — missing planner audit:** financial, vendor, runsheet and document changes have no append-only actor history.
5. **Medium — input integrity:** status/currency/category/type values and non-negative monetary semantics are not enforced consistently.
6. **Medium — no field-level privacy:** sensitive vendor/contract/budget data cannot be hidden from selected event members.
7. **Medium — local filesystem storage:** operational durability and horizontal scaling depend on a shared volume; no object-store retention/version policy is present.

## 10. Duplicate and reusable functionality

### Must reuse instead of duplicate

- Core Tasks should become Planner’s task engine.
- Core EventUser/Membership permissions should supply planner capabilities.
- Core Messaging/outbox/templates should deliver planner reminders and schedule/incident alerts.
- Core FloorPlan, SeatingTable, TableGroup and Household should supply space/seating workflows.
- Experience sessions/rooms/attendance should supply conference agendas and session operations.
- Core guest/RSVP/approval/tags should supply protocol and readiness information.
- Core media/storage patterns should replace planner local uploads.
- Existing reports/exports should feed the final event report.

### Planner-specific data worth retaining

- Budget/categories/cost items, after strengthening the financial lifecycle.
- Event vendor engagements and payment schedules, ideally attached to an org vendor directory.
- Milestones as groupings over core tasks.
- Runsheet, after conversion to timezone-aware multi-day schedule records.
- Planner document metadata, after moving binaries and access control to shared secure storage.

## 11. Recommended target workflow

```text
Portfolio
  -> choose event / see risk, deadlines, workload, budget and readiness
Plan
  -> apply event template -> milestones + core tasks + budget skeleton + readiness checklist
Budget
  -> estimate -> request/compare quote -> approve/commit -> invoice -> pay -> actual -> reconcile
Assign
  -> real people/workstreams -> shifts -> dependencies -> approvals -> reminders
Coordinate
  -> vendors + documents + guest protocol + spaces + sessions + inventory + communications
Execute
  -> mobile command center -> runsheet -> attendance -> staff/vendors -> incidents -> inventory
Monitor
  -> realtime readiness, delays, alerts, capacity, delivery failures and financial exceptions
Report
  -> final budget, attendance, team/vendor performance, incidents, feedback, lessons and exports
```

## 12. Prioritized roadmap and acceptance criteria

### P0 — Required for a functional planner MVP

#### R1. Unify planner tasks with core Tasks — Large

- User problem: tasks disappear into two unrelated systems.
- Reuse: core Task, Subtask, TaskActivity, TaskAttachment, My Tasks, assignee notifications.
- Frontend: Planner milestones render/query core tasks; real user selector; task detail panel.
- Backend/database: add optional `milestone_id`, priority, vendor engagement and dependency metadata to core tasks; migrate planner tasks.
- Permissions: existing event membership plus planner task capabilities.
- Notifications: assignment, due/overdue, mention, approval and dependency-unblocked.
- Acceptance: a task created in Planner appears in My Tasks, supports comments/subtasks/files/history, notifies the assignee, and has one authoritative status everywhere.

#### R2. Capability-based planner authorization and audit — Large

- User problem: ordinary event members can modify confidential financial records.
- Reuse: core event membership/permission patterns and audit infrastructure.
- Frontend: hide/disable unauthorized actions and explain read-only access.
- Backend/database: enforce `planner_view`, `budget_manage`, `vendor_manage`, `documents_manage`, `runsheet_manage`, `incidents_manage`; append-only audit events.
- Acceptance: owner/admin/manager/planner/committee/volunteer/vendor/viewer matrices are tested; direct API calls cannot bypass UI restrictions; every mutation records actor/time/before-after.

#### R3. Multi-day timezone-aware runsheet — Medium

- User problem: current time-only records cannot run multi-day events.
- Reuse: event timezone utilities and Experience session conflict patterns.
- Frontend: day tabs, timezone label, conflict warnings, mobile “Now/Next”.
- Backend/database: timezone-aware start/end datetimes, dependency IDs, version and change history.
- Notifications: targeted change alert to owners/roles/vendors.
- Acceptance: overnight and multi-day items sort correctly in the event timezone; overlapping owner/room/vendor assignments warn; changes are audited and distributable.

#### R4. Secure planner documents — Medium

- User problem: contracts/invoices need controlled, durable access.
- Reuse: shared storage and signed/private download patterns.
- Frontend: preview/download through authenticated client; upload progress and validation.
- Backend/database: streamed uploads, MIME/size checks, scanning, signed expiry, versions, access log.
- Acceptance: unauthorized and expired links fail; files over limit or disallowed types fail; authorized access is audited; new versions preserve history.

#### R5. Input and financial integrity — Medium

- User problem: malformed statuses, currencies and amounts can corrupt planning totals.
- Reuse: ticketing financial validation and journal patterns where suitable.
- Backend/database: enums/checks, ISO currency, non-negative amounts, decimal-safe calculations, concurrency versions.
- Acceptance: invalid values are rejected at API and DB; concurrent stale writes return conflict; rollups reconcile across API/export/UI.

### P1 — Required for professional operations

#### R6. Portfolio dashboard and readiness projection — Extra Large

- User problem: agencies cannot manage multiple events or see whole-event risk.
- Reuse: events, guests, RSVP, tasks, seating, communications, planner finance/vendors/docs, ticketing, Experience and check-in.
- Frontend: org portfolio and event readiness drill-down with quick actions.
- Backend/database: cross-service read model updated by domain events; paginated org-scoped APIs.
- Acceptance: assigned events show stage, deadlines, workload, budget, vendor, guest, approvals, seating, communication, incidents and day-of readiness with source timestamps and direct actions.

#### R7. Complete budget/procurement workflow — Extra Large

- User problem: estimates and actuals alone do not control event spending.
- Reuse: planner budgets/vendors/documents, core payments/ticket revenue/registry where applicable.
- Frontend: estimate/approve/commit/invoice/pay/reconcile lifecycle, income and variance.
- Backend/database: purchase requests, approvals, taxes/charges/discounts, invoice links, income sources, activity journal.
- Notifications: approval, due, overdue and over-budget alerts.
- Acceptance: totals reconcile; approvals enforce limits; every cost/income change is auditable; CSV/XLSX/PDF exports match the UI.

#### R8. Vendor directory, engagements and portal — Extra Large

- User problem: event-local vendor cards do not support sourcing or delivery.
- Reuse: planner vendors/payments/documents, public restricted-token patterns, messaging.
- Frontend: org directory, event engagement, RFQ comparison, compliance, deliverables, arrival/setup/teardown, evaluation.
- Backend/database: vendor org profiles, engagements, quote versions, portal identities/tokens and communications log.
- Acceptance: vendor sees only assigned engagement; can submit quote/docs/status; planner compares/accepts with audit; compliance and payment deadlines alert.

#### R9. Event-day command center and incidents — Extra Large

- User problem: no unified operating picture or incident lifecycle.
- Reuse: scanner/check-in, floor plan, core tasks, messaging, Experience activity, planner runsheet/vendors.
- Frontend: mobile live readiness, now/next, arrivals, attendance, urgent tasks, incidents, map, key contacts and announcements.
- Backend/database: incident/category/severity/location/owner/timeline/restriction, realtime event stream and offline-safe actions.
- Acceptance: two devices synchronize promptly; offline safe actions recover idempotently; critical incidents escalate; sensitive incidents obey ACL; final report includes incident timeline.

#### R10. Inventory, rentals and distribution — Large

- User problem: equipment, welcome packs and rentals cannot be reconciled.
- Reuse: Experience completion, QR scanning, shipments and vendors.
- Frontend: catalog, event allocations, movements, custody, distribution, damage/loss/returns and low-stock views.
- Backend/database: inventory items, lots, locations, movements, custody and scan events.
- Acceptance: required/ordered/available/delivered/distributed/damaged/missing/returned quantities reconcile; scans are idempotent; overdue returns and low stock alert.

### P2 — Competitive differentiation

#### R11. Planner templates and automation — Large

- User problem: recurring event plans are rebuilt manually.
- Reuse: guided setup and Experience template patterns.
- Capability: wedding, conference, graduation, religious/community and multi-day templates; recurring tasks; event duplication; conditional automation.
- Acceptance: applying a versioned template creates mapped milestones/core tasks/budget/readiness without duplicates; event duplication copies selected planning data and remaps dependencies.

#### R12. Consolidated reporting and learning — Large

- User problem: clients lack one final record and planners cannot learn across events.
- Reuse: Results, ticketing sales, attendance, feedback, tasks, planner financials/vendors/incidents/inventory.
- Capability: final report builder, snapshots, comparisons, lessons learned, PDF/XLSX/CSV.
- Acceptance: report values trace to source modules and snapshot time; role-based redaction works; two or more events can be compared on normalized metrics.

### P3 — Future enhancements

- Integrated e-signature provider and contract clause workflows.
- Predictive budget/risk recommendations from completed events.
- Route/logistics optimization and venue digital twins.
- Vendor marketplace benchmarking and automated sourcing.

## 13. Test evidence and limitations

Executed:

- `planner-service`: **18/18 tests passed**.
- Staging planner service and database containers: running and healthy at inspected version `planner-2.3.158`.
- Static route/model/UI tracing across planner service, core backend, frontend API client and related Festio modules.

Coverage limitations:

- Existing tests cover pure budget/milestone/filename helpers, one event-scope guard per router, and anonymous missing-document behavior.
- No Planner Playwright/browser tests were found.
- No CRUD integration tests against a real planner database were found.
- No role matrix, capability, upload size/type, concurrency, export, accessibility, mobile, realtime, offline or performance tests were found.
- The four scenarios above are code-contract workflow traces; shared staging data was not mutated during this audit.

## 14. Production decision

**Conditional / limited release only.** Planner may remain available behind its existing per-event feature flag for trusted administrators who understand it is a lightweight planning notebook. Do not position it as a complete professional planner platform until P0 is complete. At minimum, address task duplication, capability authorization/audit, multi-day runsheets, secure uploads/downloads and financial validation before broad production enablement.
