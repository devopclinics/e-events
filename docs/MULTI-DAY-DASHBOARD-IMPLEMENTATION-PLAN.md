# Festio Multi-Day Dashboard Implementation Plan

## Objective

Give Festio an event command center that supports both single-day events and multi-day conventions, without risking the current Results page while it's built.

The dashboard must accurately distinguish:

- Overall registration from daily attendance.
- Today's distinct check-ins from current on-site occupancy.
- First-time arrivals from returning attendees.
- Event admission from venue, session, meal, and Experience activity.
- Message attempts from confirmed provider delivery.
- One-time actions from repeatable daily occurrences.

## Architecture decision (revised 2026-07-22)

The command center is built as a **new standalone service** (`dashboard-service`), not as an in-place rewrite of `backend/app/routers/dashboard.py` and `frontend/src/pages/DashboardPage.jsx`. Those stay completely untouched until the new page has proven itself; then the Results nav item is switched over and the old route/page is deleted.

This mirrors an existing pattern in the codebase rather than inventing a new one. `messaging-service` already runs as its own FastAPI container that connects to the *same* Postgres database as `backend` (via `env_file: ./backend/.env`, `depends_on: db`), declares its own lightweight SQLAlchemy model classes for just the tables it touches, and decodes the same JWT `backend` issues rather than calling back into it over HTTP. `dashboard-service` follows that exact template — `festiome-service`'s pattern (its own dedicated Postgres, own migrations) does **not** apply here, since dashboard data lives in tables `backend` already owns.

```
event-checkin/dashboard-service/
├── app/
│   ├── main.py       # FastAPI app, /api/results/* routes
│   ├── models.py     # read-only mirrors: Guest, ScanEvent, Zone, Event,
│   │                 #   GuestExperienceProgress, GuestMenuChoice, MenuCategory
│   ├── auth.py        # decode backend's JWT secret, check org role via a read query
│   └── database.py
├── Dockerfile
└── requirements.txt
```

- **DB access:** a new Postgres role, `dashboard_ro`, granted `SELECT` only on the tables the service reads. Enforced at the database layer, not just by convention — this service can never write to guest data even if a bug tries to.
- **docker-compose / k8s:** new service block (`depends_on: db`, no database of its own), new Deployment in the festio-infra Helm chart, its own `/health`.
- **Proxy:** new `location /api/results/ { proxy_pass $results_upstream; }` block in `proxy.conf`, matching the existing `/api/messaging/`, `/api/festiome/` blocks.
- **Frontend:** a new Results page behind a nav toggle, calling `/api/results/*` only. `dashboard.py` / `DashboardPage.jsx` are not modified during Track A.

### Why this split matters: two tracks, not one

Investigating the current codebase changed the shape of this plan. A lot of what looked like new backend work in the original draft already exists:

- `ScanEvent` (guest, zone, direction in/out, denied, denial reason, timestamp) already exists and is already partially used for occupancy queries.
- Zone occupancy, peak-period, flow, and per-guest journey analytics are **already fully built** as the Venue Access Intelligence add-on (`backend/app/routers/access.py`) — just not surfaced on the dashboard.
- `Event.event_end_date` and `Event.timezone` already exist (shipped 2026-07-17).
- The Experience system already has a `session_attendance` step type with its own check-in-window logic — session-level attendance tracking, independent of event admission, is largely solved if each session is modeled as its own `ExperienceStep`.

That means **Attendance, Overview, and Alerts are pure reads over data that already exists** — a new service can build the whole command-center view shown in the mockup by reading `backend`'s database, with zero changes to `backend` itself.

**Meals is the one place that doesn't hold.** `Guest.meal_served` is a single boolean, decoupled even from *which* menu category was served — a guest with breakfast, lunch, and dinner categories has exactly one served flag for all three, forever. There is no way to show a Meals card broken out by day and meal type without recording fulfillment somewhere new. That requires a schema change and a new write path (a "mark served" action used at the serving station), and that code has to live in `backend`, not in a read-only service. See **Track B** below for the surgical version of this — it's smaller than the original draft's plan.

## Metric definitions

Unchanged from the original draft — establish these before implementing:

- **Expected today:** Guests eligible to attend during the selected event day.
- **Checked in today:** Distinct guests with at least one accepted event-entry scan during the selected day.
- **On-site now:** Guests whose latest accepted event-level scan is an entry rather than an exit.
- **First-time arrivals:** Guests whose first accepted event-entry scan occurred during the selected day.
- **Returning attendees:** Guests checked in during the selected day whose first event attendance occurred on an earlier day.
- **Checked out:** Distinct guests with an accepted event-level exit scan during the selected day.
- **Session attendance:** Attendance at a program session, independent of event admission.
- **Meal served:** One fulfillment record for a specific guest and a specific menu category (day + meal type).
- **Experience completion:** Completion of a specific one-time step or scheduled step occurrence.

All day boundaries are calculated in `Event.timezone` and converted to UTC for database queries.

---

## Track A — `dashboard-service` (read-only, additive, ships first)

Nothing in this track touches `backend`, `frontend/src/pages/DashboardPage.jsx`, or existing data. It can be built, deployed, and iterated on with zero production risk to the current Results page.

### A1. Service scaffold

- `dashboard-service` FastAPI app, `dashboard_ro` Postgres role, proxy route, health check, k8s Deployment.
- Scope parser (shared logic, importable module within the service):

```text
event_id
start_at
end_at
day
venue_id
timezone
```

  Validates requested dates against the event's range, resolves local day boundaries in `Event.timezone`, produces UTC bounds, supports entire-event / one-day / custom-range, and enforces org/event access via the JWT-derived user + a read-only org-role check.

- URL carries the scope so views are bookmarkable/shareable: `/dashboard?event=abc&day=2026-07-23&venue=all&tab=meals`.

### A2. Attendance analytics

Read from `ScanEvent` (already has guest/event/zone/direction/timestamp/denied/deny_reason):

- Distinct guests checked in within scope.
- Current on-site occupancy (latest accepted scan per guest).
- First-time vs. returning attendees.
- Hourly arrivals/exits.
- Attendance by event day.
- Occupancy by zone/venue — read the existing `access.py` occupancy queries directly (same tables, no new logic needed).
- Attendance by ticket type / section.
- Denied scans by reason, gate, staff member.
- Peak arrival periods — reuse `access.py`'s existing peak-bucketing logic.

```http
GET /api/results/events/{event_id}/analytics/attendance
    ?start=2026-07-23&end=2026-07-23&venue_id=...
```

```json
{
  "scope": { "start_at": "2026-07-23T05:00:00Z", "end_at": "2026-07-24T05:00:00Z", "timezone": "America/Chicago" },
  "expected": 1020, "checked_in": 904, "on_site": 682,
  "first_time": 143, "returning": 761, "checked_out": 222,
  "hourly": [], "by_day": [], "by_zone": [], "denials": []
}
```

### A3. Program (session) attendance — reads only

Where each session in the program is its own `ExperienceStep` (the normal case), session-in-progress counts, registered-vs-attended, and room occupancy come straight from `GuestExperienceProgress` + the step's existing `config` (capacity, venue/room, time window). No new table needed for this slice.

```http
GET /api/results/events/{event_id}/analytics/program
```

Returns sessions in progress/upcoming, registered vs. attended, room occupancy vs. capacity, walk-in attendance, no-show rate, attendance by track, capacity warnings.

*Caveat:* if a program ever needs the same session to recur identically across multiple days (not just distinct sessions per day), that still needs the occurrence model in Phase 5 of the original draft. Not needed for the mockup as shown, since each card there represents a distinct scheduled session.

### A4. Experience completion — reads only

Completion funnel by step, by day, by ticket type/tag/cohort, blocked/failed/skipped/overridden counts, guests requiring intervention, average time between steps — all reads over the existing `GuestExperienceProgress` table.

### A5. Command-center overview endpoint

Composite endpoint backing the Overview tab in the mockup:

```http
GET /api/results/events/{event_id}/command-center?day=2026-07-23&venue_id=...
```

```json
{
  "scope": {}, "attendance": {}, "alerts": [],
  "meals": {}, "program": {}, "experience": {},
  "venue_occupancy": [], "attendance_by_day": []
}
```

Returns compact summaries only; detailed tabs use A2–A4's dedicated endpoints. Short-lived caching for expensive aggregates in `dashboard-service` itself (it owns no write path, so no invalidation-on-write plumbing is needed there — a short TTL plus the live-update stream in A7 is enough).

The `meals` block in this response is intentionally coarse until Track B ships (see below) — total-served count only, no per-day/per-type breakdown.

### A6. Operational alerts

Shared alert contract, computed by `dashboard-service` from reads:

```text
id, type, severity, title, description, count, action_label, action_url, created_at, resolved_at
```

Initial alert types achievable from existing data: failed invitations, guests without contact info, tables/rooms over capacity (from `access.py` occupancy), venues approaching capacity, unsigned required consent (from `GuestExperienceProgress`), blocked/failed Experience steps, low message-credit balance (`Event.message_credits`), excessive denied scans (`ScanEvent`). "Missing meal selections" (shown in the mockup's Needs Attention panel) is achievable now too — it only needs `GuestMenuChoice` presence/absence, not the fulfillment tracking Track B adds.

Every alert links to a filtered resolution screen; don't show alerts the organizer can't act on.

### A7. Live updates

The existing SSE stream already fans out through Redis (see scalability hardening work). `dashboard-service` subscribes to the same Redis pub/sub rather than re-implementing fan-out, and re-emits typed events to its own frontend clients:

```text
attendance.changed, occupancy.changed, meal.served, session.entered, experience.completed, alert.changed
```

Prefer "refetch the affected section" over patching individual totals client-side. Keep periodic reconciliation as a fallback for missed events.

### A8. Frontend

```text
frontend/src/pages/results/
├── ResultsPage.jsx
├── ResultsScopeBar.jsx
├── OverviewTab.jsx
├── AttendanceTab.jsx
├── InvitationsTab.jsx      # reads existing invite/RSVP data — no new backend needed
├── MealsTab.jsx            # coarse until Track B
├── ProgramTab.jsx
├── ExperienceTab.jsx
├── OperationsTab.jsx
└── components/
    ├── MetricCard.jsx
    ├── AttentionPanel.jsx
    ├── AttendanceChart.jsx
    ├── OccupancyBar.jsx
    ├── ProgressFunnel.jsx
    ├── ResultsSkeleton.jsx
    └── EmptyFeatureState.jsx
```

Requirements: keep event/day/venue/tab in the URL; update all overview cards on scope change; show feature tabs only when the relevant feature is enabled; intentional setup prompts for available-but-disabled features; alerts link directly to filtered resolution workflows; accessible definition tooltip on every metric; section-level loading/failure states (one failed endpoint doesn't blank the page); mobile prioritizes alerts + current-day attendance; dark-mode support throughout.

Ship behind a nav toggle so the existing Results page keeps working for every event while this is validated.

---

## Track B — Meals fulfillment (touches `backend`, ships after Track A proves out)

### Why the original `meal_services` table design was more than needed

The original draft proposed a brand-new `meal_services` table (id, event_id, category_id, name, service_date, starts_at, ends_at, venue_id/zone_id, capacity, status) sitting alongside a brand-new `guest_meal_services` table. But `MenuCategory` already models almost exactly this: it already has `day_label` (multi-day grouping — categories sharing a label render under one day tab), `name` (typically encodes the meal type, e.g. "Day 2 Lunch"), `selection_type`/`min_selections`/`max_selections`. What it's missing is nothing to do with *scheduling* — organizers already group breakfast/lunch/dinner into separate categories per day. What's actually missing is **fulfillment tracking**: nothing records that a specific guest's specific category selection was served.

So Track B doesn't need a new "service occurrence" table at all — it needs one new table that hangs fulfillment state off the *existing* `MenuCategory`:

### New `guest_meal_fulfillment` table

```text
id
guest_id
category_id           -- FK to the existing menu_categories.id
status                -- eligible | served | skipped | denied
served_at
served_by_user_id
override_reason
created_at
updated_at
```

Unique constraint on `(guest_id, category_id)` — one fulfillment record per guest per meal category, regardless of how many items/combinations they picked within it (a multi-select category can produce several `GuestMenuChoice` rows for one guest; fulfillment stays a single row). An authorized re-serve creates an audit note via `override_reason` rather than a duplicate row.

This is deliberately smaller than the original draft: no new `starts_at`/`ends_at`/`capacity`/`venue_id` columns on day one. If organizers later want per-station capacity limits or a draft/open/closed service lifecycle, add those as nullable columns to `MenuCategory` in a follow-up — don't build it speculatively now, since nothing in the mockup's Meals card needs it (it needs eligible/served/remaining/dietary-alert counts, not station capacity).

**Eligibility** = distinct guests with at least one `GuestMenuChoice` row against that category. **Served** = guests with a `guest_meal_fulfillment` row in status `served` for that category. **Remaining** = eligible minus served minus skipped/denied. **Dietary alerts** — confirm whether a dietary/allergy field already exists on `Guest` or `GuestMenuChoice` before building this count; if not, it's a small additive field, not a blocker for the rest of Track B.

### New write path

A "mark served" action, exposed at the serving station (the mockup's "Open meal service" button): staff picks a category (Breakfast/Lunch/Dinner tabs, scoped to the selected day via `day_label`), scans or looks up a guest, and marks their fulfillment row `served`. This is genuinely new UI + endpoint work in `backend`/`frontend` (likely `backend/app/routers/menu.py` + a lightweight serving-station page), not something `dashboard-service` can provide on its own — `dashboard-service` only ever reads `guest_meal_fulfillment` once it exists.

### Migration

- Add `guest_meal_fulfillment` as a new, nullable-relationship table — no changes to existing tables.
- Keep `Guest.meal_served` for backward compatibility; dual-write to it (`meal_served = True` once *any* category is marked served for that guest) during the compatibility window.
- Backfill: for events with exactly one non-display-only meal category, backfill a `served` fulfillment row for every guest with `meal_served = True`. For events with multiple categories, the boolean can't tell us *which* category was served historically — leave those unbackfilled and document the gap; there's low real-world exposure today since multi-day/multi-category configurations are brand new (no production event has exercised this yet).
- Retire `Guest.meal_served` reads only after the new Meals tab has run in parallel and matched expectations.

### Meals analytics (once Track B ships)

Eligible guests, guests who selected, missing selections, served/remaining counts, dietary alerts, item/combination demand, service rate over time, duplicate/denied attempts. Interface: selectors for event day, meal type (Breakfast/Lunch/Dinner or whatever categories exist for that day), and station if capacity tracking is added later. Overview shows only the active/next service with a link to the full Meals tab.

---

## Track C — Experience step occurrences (touches `backend`, lowest priority)

Only needed if a workflow step must repeat identically across multiple days (e.g., a literal "Day 2 check-in" step distinct from "Day 3 check-in" using the *same* step definition). `GuestExperienceProgress` is unique per `(guest_id, step_id)` today, so a repeatable step needs:

```text
experience_step_occurrences: id, event_id, workflow_id, step_id, occurrence_date,
  starts_at, ends_at, venue_id/zone_id, capacity, status, created_at, updated_at
guest_experience_progress.occurrence_id   -- new nullable FK
```

Consent, badge collection, and registration remain event-wide one-time steps. Daily check-in, meals-as-a-step, room access, and material collection become occurrence-based where organizers explicitly mark a step repeatable. Existing progress migrates to a default occurrence or stays event-wide.

Deprioritized relative to Track B: nothing in the shared mockup requires a *repeating* step (each session/step shown is distinct), so this only matters once a real event needs it. Build reactively, not speculatively.

---

## Migration and compatibility (all tracks)

1. Track A ships additively behind a nav toggle; the existing dashboard endpoint and page are untouched and keep serving every event.
2. Track B adds `guest_meal_fulfillment` as a new nullable-relationship table; dual-writes to `Guest.meal_served` during the compatibility window.
3. Track C, if/when needed, adds new tables + a nullable FK; existing Experience progress is unaffected.
4. Compare old vs. new attendance/meals totals on real events before removing anything.
5. Only after the compatibility window closes: switch the Results nav to the new page, delete the old dashboard route/page/queries.

All migration scripts must be idempotent and preserve existing guest, scan, menu, and Experience history.

## Performance and observability

- Indexes: scan events by event+timestamp, scan events by event+guest+timestamp, `guest_meal_fulfillment` by category+status, `GuestExperienceProgress` by step+status.
- Track: `dashboard-service` endpoint response time, query count/slow queries, SSE connections and dropped messages, cache hit rate, section-level failure rate, cached-vs-reconciled value drift.
- Load-test at 100 / 1,000 / 10,000 guests, with concurrent scanning and (once Track B ships) concurrent meal-service stations.

## Testing

**Backend:** event days crossing UTC midnight; DST transitions; guests attending multiple event days; multiple entries/exits in one day; latest scan being an exit; denied scans excluded from attendance; first-time vs. returning classification; occupancy by venue/zone; duplicate meal-fulfillment attempts (unique constraint holds); breakfast/lunch/dinner fulfilled independently once Track B ships; session attendance independent of event check-in; alert thresholds and resolution links; org/event access isolation; `dashboard_ro` role genuinely cannot write.

**Frontend:** changing the selected day updates every Overview section; venue filtering; scope retained through refresh/navigation; disabled-feature states; empty/upcoming/live/ended events; partial API failures (one section fails, rest of page still renders); live updates + periodic reconciliation; alert navigation; desktop/tablet/mobile; keyboard nav, contrast, labels, tooltips.

**Acceptance scenarios:**

1. A guest attends all three days and appears once in each day's checked-in count.
2. The same guest is first-time on Day 1 and returning on Days 2–3.
3. Checking into a workshop session does not change event-level admission.
4. Once Track B ships: receiving breakfast does not mark lunch or dinner served.
5. Exiting the venue reduces current occupancy without erasing daily attendance.
6. A denied scan does not count as attendance.
7. Every Overview alert opens the exact guests/room/service/workflow requiring action.
8. `dashboard-service` continues to serve reads even if `backend` is mid-deploy (no shared process, only a shared DB).

## Recommended delivery order

1. `dashboard-service` scaffold: scope parser, `dashboard_ro` role, proxy route, health check.
2. Attendance analytics + Attendance tab (A2).
3. Overview + operational alerts (A5, A6) — this alone reproduces almost the entire shared mockup.
4. Program and Experience reads (A3, A4) — mostly free, same session/step data already exists.
5. Live updates (A7) and frontend polish (A8).
6. Track B: `guest_meal_fulfillment` + serving-station UI — the one piece that necessarily touches `backend`.
7. Track C: Experience step occurrences — only if/when a real event needs a literally repeating step.
8. Migration cleanup: retire the legacy dashboard route/page once parity is proven.

Steps 1–5 ship a fully working multi-day command center — matching essentially everything in the shared mockup except the Meals card's per-meal-type breakdown — without a single change to the current backend or its data.

## Implementation principle

Timestamped occurrences (`ScanEvent`, `GuestExperienceProgress`, and now `guest_meal_fulfillment`) are the source of truth for multi-day reporting — permanent guest-level booleans can't represent repeated attendance, meal service, or session entry across a convention. But don't build new occurrence infrastructure where an existing table (`MenuCategory`, distinct `ExperienceStep`s) already models the "occurrence" organizers need — extend what's there before adding a parallel schema.
