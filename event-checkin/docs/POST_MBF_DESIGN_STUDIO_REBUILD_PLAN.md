# Post-MBF Design Studio Rebuild Plan

Status: **DEFERRED / DO NOT IMPLEMENT**

Owner approval required: **Yes**

Target window: **After the MBF Summit has concluded and the owner explicitly authorizes implementation**

## 1. Purpose

Rebuild the redesigned Design Studio into a simpler, safer workflow:

1. Theme
2. Layout
3. Customize
4. Review and Publish

The new experience will use a persistent, real guest preview and make draft, saved, and published states unambiguous. The work also hardens design persistence, publication verification, version history, and rollback.

This document is a future implementation plan. Creating or approving this plan does **not** authorize code changes or deployment.

## 2. MBF production freeze

Until the activation gate in section 3 is satisfied:

- Do not implement this redesign.
- Do not refactor the Design Studio save or publish paths.
- Do not change the Guest Hub theme contract or rendering behavior for this project.
- Do not migrate existing design records.
- Do not change check-in, scanning, consent automation, messaging, programmes, or guest links as part of this project.
- Do not deploy a feature flag, database migration, or dormant version of the rebuild.
- Production fixes required for MBF must remain small, isolated, independently tested, and unrelated to this rebuild.

Planning, screenshots, mockups, and read-only investigation are allowed during the freeze. Application and infrastructure changes are not.

## 3. Activation gate

Implementation may begin only when every item below is true:

- [ ] The MBF Summit is formally declared complete by the event owner.
- [ ] Time-sensitive MBF check-in, consent, programme, messaging, and Guest Hub operations have ended.
- [ ] The owner gives explicit written approval to start the Design Studio rebuild.
- [ ] A production backup or export of design records and published versions is verified.
- [ ] Current staging and production image tags are recorded.
- [ ] A dedicated branch and isolated staging test event are selected.
- [ ] A rollback owner and release window are assigned.

Do not infer approval from the date. The unchecked list remains a hard stop.

## 4. Product outcome

The completed Design Studio should provide:

- A clear four-stage workflow instead of eight competing top-level tabs.
- One source of truth for Theme and FestioHub/GuestHub appearance.
- An always-visible live preview with desktop and mobile modes.
- Honest statuses for editing, saving, saved, save failed, draft, publishing, and published.
- Atomic updates that cannot lose nearby edits.
- A publish operation that verifies the complete version before declaring success.
- Published-version history and a safe restore operation.
- A test-send workflow for email design.
- Accessible keyboard, screen-reader, contrast, and mobile behavior.

## 5. Proposed information architecture

### Stage 1: Theme

- Search and category filters.
- Theme cards with accurate mini-previews.
- One action: **Use this theme**.
- Applying a theme atomically saves its theme ID, colors, typography, and default layout.
- Advanced users may change individual choices later without reapplying the entire theme.

### Stage 2: Layout

- RSVP/event-page hero layout.
- FestioHub layout.
- Pass layout.
- Section order and visibility.
- Desktop/mobile preview control.
- No duplicated GuestHub and FestioHub theme selectors.

### Stage 3: Customize

Use collapsible sections:

- Colors and typography
- Wording
- Cover image and image positioning
- GuestHub modules
- Festio Pass
- Flyer
- Email

Each section shows a short summary when collapsed. Autosave is authoritative; manual retry appears only after failure.

### Stage 4: Review and Publish

- Full-page preview of every affected surface.
- Readiness checklist based on the current draft, not an older server response.
- Clear list of changes since the published version.
- Test email and guest-preview links.
- Confirmation showing the version that will be created.
- Post-publish verification across the complete design contract.
- Restore a prior published version.

## 6. Technical architecture

### 6.1 Canonical draft model

Define one canonical design payload containing:

- selected theme/template
- flyer template
- colors
- typography
- wording
- page configuration
- GuestHub style and modules
- pass options
- asset and flyer configuration

All editor actions derive from this current draft. No action may rebuild a request from a stale server snapshot.

### 6.2 Serialized save coordinator

Implement one save coordinator for the entire editor:

- Debounce ordinary field edits.
- Serialize requests so responses cannot arrive out of order.
- Coalesce newer edits while a request is running.
- Track a server revision or ETag.
- Reject or reconcile revision conflicts.
- Retry only safe transient failures.
- Preserve the draft locally when connectivity is lost.
- Never display “All changes saved” until the server confirms the exact current revision.

Theme selection, palette application, image updates, and template selection must use this coordinator or a single atomic endpoint.

### 6.3 Draft preview

- Replace cross-tab `sessionStorage` handoff with a short-lived, scoped preview token.
- Tokens must be event-specific, user-authorized, expiring, and read-only.
- Inline and full-tab previews must resolve the same draft revision.
- The preview must visibly state that guests cannot see draft changes.
- Preview endpoints must never mutate or publish a design.

### 6.4 Publication

Safe publication sequence:

1. Flush and confirm the current draft revision.
2. Validate the complete draft server-side.
3. Create an immutable published version.
4. Read that exact published version back.
5. Compare the complete normalized contract.
6. Mark success only after verification.

If post-publish verification fails, the UI must report that a version was created but verification failed. It must not claim that nothing was published.

### 6.5 Version history and restore

- Store immutable published snapshots.
- Record version, actor, timestamp, and optional note.
- Allow previewing an older version.
- “Restore” creates a new draft from an older snapshot; it does not rewrite history.
- Republishing the restored draft creates a new version.

## 7. Delivery phases

### Phase 0: Post-event baseline

- Record production/staging versions and current contracts.
- Export representative design records.
- Capture screenshots of all current surfaces.
- Run the existing Design Studio, Guest Hub, scan, consent, and messaging tests.
- Document current failures before modifying anything.

Exit gate: baseline evidence is complete and reproducible.

### Phase 1: Contract and persistence hardening

- Define canonical draft and published-version schemas.
- Add revision/conflict handling.
- Add atomic theme application.
- Implement publication validation and version history.
- Add restore APIs.
- Keep the current interface in place.

Exit gate: API tests prove no lost updates, no partial theme application, deterministic publication, and safe restore.

### Phase 2: Save coordinator

- Build the serialized client save coordinator.
- Convert existing editor actions one at a time.
- Add offline/error recovery and accurate status messages.
- Remove competing direct-save paths after parity is proven.

Exit gate: race and failure tests pass under delayed, reordered, duplicated, and failed requests.

### Phase 3: New Design Studio interface

- Build Theme, Layout, Customize, and Review/Publish stages.
- Implement the persistent live preview.
- Consolidate GuestHub and FestioHub controls.
- Add collapsible customization groups.
- Preserve every existing supported field.

Exit gate: feature parity matrix is complete; no current design field is lost.

### Phase 4: Preview and communication surfaces

- Add secure full-tab draft preview tokens.
- Add representative guest/pass/flyer previews.
- Add email test-send capability.
- Clearly label representative versus exact provider-rendered previews.

Exit gate: the same draft revision is visible in inline and full-tab previews.

### Phase 5: Accessibility and responsive verification

- Keyboard-only workflow.
- Focus visibility and logical focus order.
- Accessible names and field associations.
- Screen-reader status announcements without excessive repetition.
- Serious/critical automated accessibility scan.
- Mobile widths, tablet widths, desktop, zoom, and long-text testing.
- Color contrast validation for user-selected palettes.

Exit gate: accessibility and responsive regression suites pass.

### Phase 6: Feature-flagged staging rollout

- Deploy behind an organization/event-scoped feature flag.
- Enable only for an isolated QA event first.
- Run automated suites and manual organizer workflows.
- Soak for at least 48 hours with logging and error monitoring.
- Compare saved and published payloads against the legacy editor.

Exit gate: no unresolved critical/high defects and rollback rehearsal succeeds.

### Phase 7: Controlled production rollout

- Deploy code with the feature flag off.
- Verify production health without exposing the new editor.
- Enable for internal/test organizations.
- Expand gradually to a small organizer cohort.
- Monitor save failures, conflicts, preview failures, publish failures, and restores.
- Make it the default only after the agreed observation period.
- Retain the legacy editor during the rollback window.

Exit gate: owner explicitly approves general availability.

## 8. Required test matrix

### Persistence

- Rapid edits followed immediately by theme selection.
- Rapid edits followed immediately by publish.
- Slow request followed by a newer save.
- Network loss during autosave.
- Refresh while saving.
- Two browser tabs editing the same event.
- Image upload while other fields are unsaved.
- Partial API failure during theme application.

### Publication

- Complete draft is saved before publishing.
- All fields match the immutable published version.
- Verification failure accurately reports whether publication occurred.
- Repeated confirmation cannot publish twice accidentally.
- Restore creates a new draft and preserves history.

### Preview fidelity

- Event page
- GuestHub/FestioHub
- Festio Pass
- Flyer PNG/PDF sizes
- Invitation and confirmation emails
- Cover image crop/focus
- Theme colors and typography
- Hidden/visible sections and modules

### Regression protection

- Existing guest links remain valid.
- Guest Hub rendering remains compatible with existing saved themes.
- QR passes and scan/check-in are unaffected.
- Consent completion and check-in blocking are unaffected.
- Programmes, speakers, messaging, and notifications are unaffected.
- No design migration is required merely to view an existing event.

## 9. Observability

Add structured events and dashboards for:

- draft save attempts, latency, success, failure, and conflicts
- autosave queue depth and retry count
- preview-token creation and preview failures
- publish attempts, versions, validation failures, and verification failures
- restore attempts and outcomes
- client errors by Design Studio stage

Do not log guest tokens, preview secrets, email bodies, or sensitive design content.

## 10. Rollback plan

- Keep the legacy Design Studio route available during rollout.
- Control the new editor with an independently reversible feature flag.
- Do not destructively migrate current design records.
- New schema fields must be additive until general availability is complete.
- If production error thresholds are exceeded, disable the flag first.
- Restore the previous frontend/backend image tags only if disabling the flag is insufficient.
- Published guest surfaces must continue reading the last valid published snapshot throughout rollback.

## 11. Definition of done

The rebuild is complete only when:

- No known path can silently overwrite newer design edits.
- Theme application is atomic.
- Save status always reflects the exact current draft.
- Publish status accurately reflects server reality.
- The complete published contract is verified.
- Previous versions can be restored safely.
- Inline and full-tab previews show the same draft revision.
- Existing event designs render without destructive migration.
- Mobile, accessibility, failure, race, and regression suites pass.
- Staging soak and production canary gates pass.
- The owner approves general availability.

## 12. Explicitly out of scope

- Changes to MBF programmes or schedules
- Changes to guest records or existing guest links
- Check-in/scanner redesign
- Consent automation changes
- WhatsApp/SMS/email delivery infrastructure changes
- FestioMe or Festio Live redesign
- Unrelated navigation or billing work

These areas may receive separate emergency fixes, but they must not be bundled into this project.
