# FestioHub, Festio Pass, FestioMe, and Check-in — Staging Implementation Plan

## Scope and guardrails

This plan applies to **staging only**. It redesigns four separate surfaces without changing the meaning of
existing RSVP, ticket, admission, Experience, seating, program, or entitlement rules:

1. **FestioHub** — the guest's event journey and content.
2. **Festio Pass** — the guest's admission credential.
3. **FestioMe** — the event community, conversations, groups, and engagement.
4. **Check-in** — the staff scanner and station workflow.

Presentation settings may reorder or hide eligible modules. They must never enable a feature, bypass an
entitlement, change Experience dependencies, alter admission outcomes, or expose staff-only data to guests.

## Delivery strategy

Implement behind staging-only rollout flags and ship in independently testable slices. Existing events and
unknown configuration versions must render the current safe defaults. No production deployment, production
migration, or production data change is included.

## Phase 0 — baselines and test fixtures

- Capture the current mobile behavior of `InvitePage.jsx`, Festio Pass, and `ScannerPage.jsx`.
- Add staging fixtures for:
  - a basic RSVP-only event;
  - an event with a QR pass but no Experience;
  - an Experience event with several dependent steps;
  - a long multi-day Live Program;
  - seating/table assignments;
  - child/adult age groups and souvenir eligibility;
  - disabled and partially enabled feature combinations;
  - check-in, check-out, section scanning, and offline/error states.
- Record current API responses and admission decisions as regression snapshots.
- Add four temporary rollout switches: `guest_hub_v2`, `festio_pass_v2`, `festiome_v2`, and
  `staff_checkin_v2`.

**Exit:** staging fixtures cover every supported event family and existing admission tests remain green.

## Phase 1 — shared capability and presentation contracts

### Backend

Return a normalized, server-authoritative capability object for guest surfaces. It should be derived from the
existing event toggles and entitlements, not stored independently.

Example:

```json
{
  "guest_hub": true,
  "pass": true,
  "experience": true,
  "live_program": true,
  "messages": false,
  "seating": true,
  "orders": false
}
```

Add a separate versioned FestioHub presentation document:

```json
{
  "version": 1,
  "default_tab": "activity",
  "default_tab_rule": "activity_when_next_action_exists",
  "modules": [
    { "key": "guest_pass", "visible": true, "variant": "compact" },
    { "key": "next_action", "visible": true },
    { "key": "activity_progress", "visible": true },
    { "key": "live_program", "visible": true, "variant": "now_plus_two" },
    { "key": "messages", "visible": true }
  ]
}
```

- Validate module keys, variants, duplicates, required modules, and maximum module count.
- Intersect layout visibility with server-derived capabilities on every read.
- Ignore disabled modules even if stale layout data says they are visible.
- Fall back to a versioned default for missing, invalid, or newer unknown layouts.
- Store presentation separately from event workflow configuration.
- Add read/update endpoints with organizer authorization and optimistic concurrency or `updated_at` checking.

### Frontend

- Introduce shared selectors such as `canRenderModule(capabilities, key)`.
- Keep surface-specific components separate; do not create one universal guest/staff screen.
- Add analytics events for tab selection, module opening, scan result, next scan, and collapsed-step expansion.

**Exit:** capability and layout contract tests prove that toggles remain authoritative and old events require no
manual migration.

## Phase 2 — FestioHub v2

Refactor the guest hub currently rendered from `frontend/src/pages/InvitePage.jsx` into focused components:

- `GuestHubShell`
- `GuestHubTabs`
- `GuestPassSummary`
- `GuestNextAction`
- `GuestActivityProgress`
- `GuestProgramPreview`
- `GuestProgramFull`
- `GuestMessages`

Behavior:

- Tabs are **Pass**, **Activity**, **Program**, and **Messages**, filtered by capabilities.
- Default to Activity when an actionable next step exists; otherwise default to Pass.
- The initial Activity view shows one next action, assignments, progress, and only “Now + two next.”
- The complete agenda renders only in Program and should use lazy rendering/windowing for long programs.
- Install and notification prompts move into a secondary menu and do not interrupt event-day activity.
- Preserve deep links such as `#guest-hub`; add stable tab query/hash handling where useful.
- Preserve all existing guest completion, consent, messaging, and retry behavior.
- Make server-returned layout order the render order after capability filtering.

**Exit:** ten or more program items do not increase Activity's initial height; the guest's next step appears in
the first mobile viewport; hidden/disabled features cannot be reached by URL manipulation.

## Phase 3 — Festio Pass v2

Build the pass as an admission-first surface, separate from FestioHub:

- Keep the QR code dominant and preserve the existing QR payload and scanning compatibility.
- Show identity and admission status.
- Conditionally show ticket/category, entry, table/seat, age group, and one next-action summary.
- Render fields only when both enabled and populated.
- Keep Program and Activity as links/tabs; never expand the full agenda in the pass.
- Continue honoring existing Design Studio pass visibility settings.
- Test print/download, brightness, low-connectivity, expired/revoked pass, and already-admitted states.

**Exit:** existing QR codes scan unchanged, optional fields do not leave empty gaps, and no staff-only eligibility
or action control is exposed.

## Phase 4 — FestioMe v2

FestioMe remains an independently deployed, failure-contained service. GuestHub may link to it and display a
small derived preview, but must not become a second community client or read FestioMe's database directly.

### Product structure

- Add a capability-gated **Community** entry point in FestioHub when the add-on is entitled, enabled, not
  administratively blocked, and available to the current guest.
- The FestioHub community card may show unread count, latest announcement summary, and joined-group count.
- Opening Community enters the dedicated `/festiome/guest` experience with its existing short-lived guest
  session exchange.
- Keep channels, direct messages, membership, discovery, polls, reactions, attachments, search, reports,
  moderation, and notification preferences inside `FestioMePage.jsx` and the FestioMe service.
- Provide an obvious route back to the guest's FestioHub and Pass.
- Staff/organizer navigation remains role-aware and separate from the guest entry.

### Guest experience

- Introduce a mobile-first community home with event identity, unread activity, announcements, joined groups,
  and discoverable groups.
- Keep the active conversation focused: channel header, messages, composer, attachment/poll tools, and thread
  context; move administration into secondary panels.
- Clearly distinguish announcements, public discussions, private groups, staff-only channels, and direct
  messages.
- Preserve group rules and join-policy acceptance before content access.
- Add useful empty, loading, disconnected, expired-session, read-only, and service-unavailable states.
- Do not show operational admission, eligibility, or scanner controls in FestioMe.

### Organizer and moderation experience

- Preserve owner/admin/moderator roles and least-privilege controls.
- Organizers can create groups/channels, configure visibility and join policy, review requests, and invite or
  remove members.
- Moderators can review reports and moderate content without receiving unrelated event administration rights.
- Destructive actions require confirmation and leave an audit trail where supported.

### Integration and reliability

- Keep the current signed token exchange and event/pass validation as the only guest-session entry.
- Preserve the durable outbox for guest sync and announcements; retry asynchronously and idempotently.
- Do not make FestioHub, Pass, RSVP, or Check-in availability depend on FestioMe health.
- If FestioMe is unavailable, hide its preview data or show a contained retry state while all other surfaces
  continue normally.
- Do not duplicate community message bodies in the primary Festio backend; use narrow summary contracts only.
- Treat `festiome_addon_enabled`, `festiome_enabled`, blocked communication settings, membership, and service
  availability as separate gates and test every combination.

**Exit:** an eligible guest can move from FestioHub to FestioMe and back without re-identifying; unauthorized or
ineligible guests cannot obtain a session; a FestioMe outage has no effect on Pass, Hub, RSVP, or Check-in.

## Phase 5 — staff Check-in v2

### Scan response

Extend the existing scan result schema additively. Do not change the admission decision fields.

Suggested additions:

```json
{
  "guest_summary": {
    "age_group": "10+",
    "ticket_label": "General",
    "room": "Main Hall",
    "table": "Sapphire 4"
  },
  "eligibilities": [
    { "key": "souvenir", "label": "Souvenir", "status": "eligible" }
  ],
  "station_action": {
    "step_id": "...",
    "label": "Issue name tag",
    "completion_allowed": true
  },
  "remaining_action_count": 2
}
```

- Derive age group from stored guest/response data; never ask staff to infer it.
- Derive eligibility on the server using configured event rules.
- Filter the priority action by the staff member's current station and permissions.
- If station configuration is absent, use a deterministic safe priority order.
- Return only authorized fields; do not leak private responses that are unnecessary for operations.

### Scanner UI

Refactor `ResultCard` in `frontend/src/pages/ScannerPage.jsx`:

- Keep admission status, name, and time prominent.
- Show compact configured identity, assignment, age group, and eligibility fields.
- Show one station action; place other Experience steps in a collapsed disclosure.
- Keep **Scan next guest** sticky and always reachable without scrolling.
- Retain manual search, recent scans, camera errors, duplicates, check-out, and section modes.
- Never render FestioHub, the guest QR pass, or Live Program in the scanner result.
- Optimistically complete station actions only with rollback and a visible error if the API fails.

### Station configuration

- Reuse existing Experience step/staff permission models where possible.
- Add a station-to-action mapping only if the current model cannot express it.
- Support a station selector with a remembered per-device choice.
- Validate that staff can only choose assigned/authorized stations.

**Exit:** staff see admission, age group, eligibility, assignment, and one relevant action in one viewport; the
next scan action remains visible; admission behavior is byte-for-byte/API-regression compatible.

## Phase 6 — organizer FestioHub layout editor

Add the editor to Design Studio:

- Drag modules to reorder.
- Show/hide eligible optional modules.
- Choose allowed compact variants.
- Select the default tab and conditional default behavior.
- Preview common mobile/tablet widths with fixture guest data.
- Save draft, publish, reset to safe default, and warn about unsaved changes.
- Disable controls for features that are off and explain which event toggle enables them.
- Offer a FestioMe community entry/preview module only when all FestioMe capability gates pass.
- Keep mandatory pass/access modules locked where required.
- Provide keyboard-accessible reorder controls in addition to drag-and-drop.

Publishing updates presentation only. It must not toggle event features or modify Experience step order.

**Exit:** a layout can be drafted, previewed, published, reloaded, and reset; turning a feature off immediately
removes its module without deleting its saved position.

## Phase 7 — testing and staging validation

### Automated

- Backend unit tests for validation, fallback, authorization, capability intersection, age groups, eligibility,
  station filtering, and additive schema compatibility.
- API integration tests for old events, unknown layout versions, disabled features, and unauthorized access.
- Frontend component tests for tabs, conditional modules, sticky controls, disclosures, and error recovery.
- End-to-end tests for RSVP → pass → scan → station completion → updated guest activity.
- End-to-end tests for FestioHub → FestioMe guest session → group/channel interaction → FestioHub return.
- FestioMe boundary tests for entitlement, administrative block, membership, token expiry, cross-event access,
  durable synchronization, and service outage containment.
- Regression tests for manual check-in, check-out, self-check-in, section scanning, consent, and offline recovery.
- Accessibility checks for focus order, keyboard reorder, screen-reader labels, contrast, and touch targets.

### Manual staging matrix

Validate at minimum:

| Event type | FestioHub | Pass | FestioMe | Check-in |
|---|---|---|---|---|
| RSVP only | Basic guest content | QR/identity | Absent unless enabled | Basic admission |
| Experience | Activity-first | One next action | Community entry | Station action |
| Long program | Compact preview | Program link only | Unaffected | No program |
| Seating | Assignment module | Table/seat | Unaffected | Assignment summary |
| Child/adult rules | Guest-safe category | Configured age group | Membership rules | Age and eligibility |
| Features toggled off | Modules absent | Fields absent | Entry absent | Actions absent |
| FestioMe outage | Hub remains usable | Unaffected | Contained retry state | Unaffected |

Test small phones, tablets, desktop scanner stations, weak network, camera denial, duplicate scans, and rapid
back-to-back scans.

## Phase 8 — staging rollout and sign-off

1. Enable internal accounts only.
2. Run seeded-event QA and compare admission audit records with the baseline.
3. Enable selected staging organizers and collect task-time/error metrics.
4. Run an event-day simulation with separate guest and staff devices.
5. Fix severity 1–2 issues and repeat the simulation.
6. Obtain product, operations, accessibility, and security sign-off.

Rollback is by disabling the relevant v2 switch. Additive database fields remain harmless and no event workflow
data should need reversal.

## Recommended work packages

1. **Foundation:** fixtures, rollout switches, capability/layout schema, migrations, API validation.
2. **FestioHub:** component extraction, tabs, program separation, conditional layout rendering.
3. **Festio Pass:** admission-first component and conditional modules.
4. **FestioMe:** community home/conversation UX, Hub entry, service isolation and session handling.
5. **Check-in API:** age/eligibility/station-action derivation and authorization.
6. **Check-in UI:** compact result, sticky next scan, collapsed remaining actions.
7. **Layout editor:** draft/publish/reset, preview, accessible ordering.
8. **Quality:** automated matrix, performance/accessibility checks, staging simulation.

Work packages 2, 3, and 4 can proceed after the foundation contract stabilizes. Check-in UI can start against
mocked responses while its API work is underway. The layout editor should follow FestioHub's module registry so
both use the same keys and validation rules. FestioMe work must preserve its existing deployment and database
boundary.

## Definition of done

- The four surfaces remain visibly and technically separate.
- Existing feature toggles and entitlements remain authoritative.
- All supported event configurations degrade safely when data or features are absent.
- Existing QR and admission behavior is unchanged.
- No full program appears in Pass or Check-in.
- No staff-only controls or eligibility data appear in guest surfaces.
- FestioMe remains independently deployable and cannot take down Hub, Pass, RSVP, or Check-in.
- FestioHub exposes only a gated FestioMe entry/summary, never a duplicate community implementation.
- FestioHub layouts are versioned, validated, reversible, and presentation-only.
- The complete automated and manual staging matrix passes.
- No production systems or production data were touched.
