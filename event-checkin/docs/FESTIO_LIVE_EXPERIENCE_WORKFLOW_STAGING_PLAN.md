# Festio Live — Experience Workflow Engine Staging Plan

Status: **Architecture and visual-design phase**

Target: **Staging only until separate production approval**

First configuration: **MBF Summit 2026 — The Good Life: Are We Truly Happy?**

Non-negotiable rule: **MBF is configuration, never a generic-code dependency.**

## 1. Safety boundary

This plan does not authorize a production deployment. The initial implementation must be isolated to the existing Festio Live engagement domain and an explicitly selected staging event.

It must not create dependencies from RSVP, Guest Hub core, check-in, consent automation, messaging, Event Admin, or the core Experience programme onto workflow availability.

Before implementation:

- [ ] Architecture and conceptual mockups are approved.
- [ ] A dedicated branch is created from the agreed baseline.
- [ ] A staging-only feature flag defaults to off.
- [ ] A disposable staging event and display are selected.
- [ ] Existing Festio Live tests pass and image tags are recorded.
- [ ] Migration rollback is rehearsed against a disposable database.

Production remains blocked until staging acceptance evidence exists and the owner gives separate approval.

## 2. Architecture assessment

The workflow engine belongs inside `engagement-service`, not a new microservice.

Existing systems to reuse:

- event/org-scoped activities, questions and options;
- durable participants and idempotent responses;
- results, analytics and response counters;
- approved-only public word clouds and moderation;
- named displays and independently rotatable read-only tokens;
- presenter/moderator capability tokens;
- Redis/SSE per activity/display with HTTP polling fallback;
- independent engagement PostgreSQL, Redis, worker, migrations and probes;
- `LiveGuestPage`, `LiveDisplayPage`, `LiveControlPage` and `LiveBroadcastCanvas` shells.

The existing Guided Show sequences phases inside one activity. The new layer orchestrates multiple activities and presentation scenes; it does not replace Guided Show or response engines.

### Core decision

Separate configuration, history and execution:

1. **ExperienceWorkflow** — editable organizer-owned identity.
2. **WorkflowRevision** — immutable configuration snapshot.
3. **WorkflowRun** — server-authoritative execution of one revision on one display.

This preserves completed runs, enables templates/duplication and prevents live shows changing when a draft is edited.

## 3. Reuse map

| Need | Reuse | New layer |
| --- | --- | --- |
| Poll/multi-select/rating | Existing Activity, Question, Option, response APIs | Step links and active-interaction projection |
| Results/rankings | Existing result computation | Workflow result scene and comparison |
| Word cloud | Existing activity, moderation and approved-word pipeline | Scene wrapper and optional saved run artifact |
| Guest identity | Existing engagement guest/anonymous JWT | Run guest-state endpoint |
| Presenter authorization | Existing roles/capabilities | Workflow-specific capabilities and commands |
| Display security | Existing LiveDisplay token | Run assignment and workflow display state |
| Realtime | Existing SSE helpers, Redis and polling recovery | Run channel/events |
| Analytics | Existing activity analytics | Run reach, duration, drop-off and comparison |
| Media | Existing managed media patterns | Validated media config and fallback |
| Display | Existing full-screen shell | Generic workflow scene registry |
| Guest UI | Existing response controls | Active-step routing and waiting states |
| Organizer | Existing Festio Live shell | Experiences list, builder and templates |
| Presenter | Existing Live Control patterns | Timeline, notes, clock and run controls |

## 4. Integration diagram

```text
Organizer Builder
      |
      v
ExperienceWorkflow -> WorkflowRevision -> WorkflowStep
                                          |       |
                                          |       +-> configured scene
                                          +-> existing Activity / Question

Presenter -- capability token --> Workflow Run API
                                      |
                                      | durable transaction
                                      v
                                  WorkflowRun
                                      |
                       +--------------+--------------+
                       |                             |
                       v                             v
                 run-scoped SSE              existing Activity APIs
                       |                     responses / analytics /
                 +-----+------+              moderation / word cloud
                 |            |
                 v            v
            Live Display   Mobile Guest
```

PostgreSQL is authoritative. Redis notifications tell clients to refetch canonical HTTP state.

## 5. Data model

All tables remain inside the engagement database. Core IDs are opaque strings, not cross-database foreign keys.

### `experience_workflows`

```text
id, org_id, event_id, name, description
status: DRAFT | READY | ARCHIVED
theme_id, current_revision_id
created_by, created_at, updated_at
```

Live statuses belong to runs, not editable workflows.

### `workflow_revisions`

```text
id, workflow_id, revision_number
name, description, theme_config JSONB
estimated_seconds, created_by, created_at, published_at
```

Unique `(workflow_id, revision_number)`. A revision becomes immutable when referenced by a run.

### `workflow_steps`

```text
id, revision_id, sequence, step_key, step_type
title, subtitle, config JSONB
linked_activity_id, linked_question_id
duration_seconds, auto_advance
presenter_notes, is_hidden
created_at, updated_at
```

Unique `(revision_id, sequence)` and `(revision_id, step_key)`.

Initial types:

```text
HERO, POLL, POLL_RESULTS, VIDEO, QUOTE, SCRIPTURE, DIAGRAM,
COUNTDOWN, GAME, WORD_CLOUD, COMPARISON, CLOSING
```

Existing question types implement multi-select and rating; no duplicate response types are needed.

### `comparison_definitions`

```text
id, revision_id, step_id
question_a_id, question_b_id
comparison_type: OPTION_DISTRIBUTION
option_mapping JSONB, created_at
```

Validation requires compatible questions and complete option mapping. The builder should clone the before question to create the after question so wording/options cannot drift.

### `workflow_runs`

```text
id, workflow_id, revision_id, org_id, event_id, display_id
status: READY | LIVE | PAUSED | COMPLETED | ABORTED
current_step_id, active_activity_id, active_question_id
started_at, paused_at, pause_total_seconds, completed_at, started_by
state JSONB, lock_version, created_at, updated_at
```

`state` holds bounded runtime details such as countdown deadline, media cue and reveal state. Responses remain in existing response tables.

### `workflow_run_events`

```text
id, run_id, sequence, event_type, step_id
actor_id, actor_role, payload JSONB, created_at
```

Append-only audit trail for start, pause, resume, transitions, reveal, timers, media, jumps, completion and abort.

### `experience_templates`

```text
id, org_id nullable, name, description, category
structure JSONB, theme_config JSONB, is_system
created_by, created_at, updated_at
```

Templates exclude responses, participant identities, analytics, display tokens, event-specific runtime state and run history.

## 6. Runtime state machine

```text
Workflow: DRAFT -> READY -> ARCHIVED

Run: READY -> LIVE -> PAUSED -> LIVE -> COMPLETED
                \---------------------> ABORTED
```

Rules:

- Only a READY immutable revision can start.
- State commits before SSE publish.
- Commands require expected `lock_version` and idempotency key.
- Previous, next and jump are audited.
- Refresh restores step, interaction, timer and elapsed state from the server.
- Editing a workflow never changes a current or historical run.

## 7. Shared renderer contract

Builder Preview, Presenter Preview and Live Display use one registry:

```text
renderer = sceneRegistry[step.step_type]
renderer.validate(step.config)
renderer.render(step, runState, activityState, results, theme, mode)
```

Each renderer defines configuration validation, safe defaults, 720p–4K layout, reduced-motion behavior, media fallback, guest-action state and presenter actions.

No generic component, route, schema, metric or event name may contain `MBF`.

## 8. API outline

Organizer:

```text
GET/POST       /workflows
GET/PATCH      /workflows/{id}
POST           /workflows/{id}/duplicate
POST           /workflows/{id}/validate
GET/POST       /workflows/{id}/revisions
POST           /workflows/{id}/save-as-template
POST/PATCH     /workflow-revisions/{id}/steps
DELETE         /workflow-steps/{id}
POST           /workflow-steps/{id}/duplicate
POST           /workflow-steps/reorder
GET            /workflow-templates
POST           /workflow-templates/{id}/instantiate
```

Presenter:

```text
POST /workflow-runs
GET  /workflow-runs/{id}
POST /workflow-runs/{id}/start|pause|resume|next|previous|jump
POST /workflow-runs/{id}/reveal
POST /workflow-runs/{id}/timer/start|stop
POST /workflow-runs/{id}/media/play|pause
POST /workflow-runs/{id}/complete
```

Guest/display:

```text
GET /workflow-runs/{id}/guest-state
GET /workflow-runs/{id}/realtime-ticket
GET /workflow-runs/{id}/stream
GET /live/{display_code}/workflow-state?token=...
GET /live/{display_code}/stream?token=...
```

Public state excludes presenter notes, internal tags, moderation detail, actor identity and unauthorized participant counts.

## 9. Realtime

Events:

```text
workflow.started, workflow.paused, workflow.resumed,
workflow.step_changed, workflow.results_revealed,
workflow.timer_started, workflow.timer_completed,
workflow.media_changed, workflow.completed, workflow.aborted
```

Use one channel per run plus the existing display channel. An assigned display subscribes to both; existing activity events remain unchanged. Clients refetch canonical state after notifications.

## 10. Security

Proposed capabilities:

```text
experience.create, experience.edit, experience.delete,
experience.present, experience.view, experience.template
```

- Owner/admin follow the current role model.
- Presenter can run assigned workflows/displays but cannot edit/delete/templates.
- Every query enforces event and organization scope.
- Display token remains read-only and rotatable.
- Presenter notes never enter guest/display schemas.
- Configured text is sanitized; scripture/quotes are never executable HTML.
- Media uses managed asset IDs or validated allowlisted URLs.
- Arabic content carries language/direction metadata.
- Audit logs exclude access tokens and private answers.

## 11. Before/after comparison

Initial capability: `OPTION_DISTRIBUTION`.

For every mapped option calculate before and after percentages using their own response totals, then calculate the percentage-point difference.

Requirements:

- display both respondent totals;
- label change as percentage points;
- never imply causality;
- use direction colors, not moral good/bad colors;
- reject incompatible options without explicit complete mapping;
- never show fabricated values outside labeled preview/sample mode.

## 12. Product interfaces

Add `Experiences` to Festio Live navigation after Activities.

### Builder

- left step-type palette;
- ordered timeline with drag and accessible up/down controls;
- exact shared-renderer preview;
- schema-driven configuration and presenter notes;
- duplicate, hide, delete, duration and auto-advance;
- validation/readiness panel;
- TV, 1080p, projector and mobile preview modes.

### Presenter

- complete run-of-show timeline;
- current and next step;
- exact TV preview;
- private notes;
- previous, next, pause/resume, jump and finish;
- reveal/start timer/play media actions where relevant;
- total elapsed time and expected range;
- authorized response count and connection state.

### Guest

- interactive step: only the linked active interaction;
- non-interactive step: concise waiting message;
- answered state remains recorded;
- pause/complete messaging;
- canonical refresh/reconnect recovery;
- no presentation timeline or presenter notes.

## 13. Presentation design system

The approved mockup is the quality bar, expressed as generic theme configuration.

Reusable components:

```text
ExperienceStage, ExperienceSceneHeader, HeroScene, PollScene,
PollResultsScene, MediaScene, QuoteScene, ScriptureScene,
RelationshipDiagramScene, CountdownScene, PromptGameScene,
CommunityChoiceScene, RankedResultsScene, WordCloudScene,
BeforeAfterScene, ClosingScene, ResponseCounter, JoinQr, SceneProgress
```

Rules:

- one screen, one idea;
- 5–7% safe area and no scrolling from 1280x720 to 3840x2160;
- responsive `clamp()` typography;
- stable option colors from poll through results;
- consistent vector icons;
- restrained 300–700ms motion and reduced-motion mode;
- non-color result indicators;
- distinct mobile participant UI;
- builder preview uses the exact live renderer.

Initial themes: Festio Dark, Festio Vibrant, Elegant, Minimal, Warm, Youth and Custom Event Theme.

MBF uses a midnight base with mint, blue, purple, magenta, gold, green and coral in one theme object—not scattered constants.

## 14. MBF staging fixture

| # | Type | Scene | Reused interaction |
| --- | --- | --- | --- |
| 01 | HERO | Opening — Are We Truly Happy? | None |
| 02 | POLL | Happiness Before | Existing poll/question pipeline |
| 03 | POLL_RESULTS | Happiness Results | Step 02 results |
| 04 | POLL | Twenty Years — Are We Happier? | Existing poll/question pipeline |
| 05 | VIDEO | Harvard Study | Approved managed/allowlisted media only |
| 06 | SCRIPTURE | Qur'an 13:28 | Configured text and translation |
| 07 | SCRIPTURE / DIAGRAM | Hadith and Connection Framework | Generic renderers |
| 08 | POLL | 2 AM Connection Test | Anonymous poll |
| 09 | GAME / COUNTDOWN | Connection Challenge | Server timer; no response engine |
| 10 | POLL | Community Check | Existing poll |
| 11 | POLL | Twenty Years From Now | Existing multi-select, maximum three |
| 12 | WORD_CLOUD | Legacy | Existing moderated word cloud |
| 13 | POLL | Happiness After | Exact clone of step 02 question |
| 14 | COMPARISON | How Responses Changed | Steps 02 and 13 |
| 15 | CLOSING | The Good Life | None |

Private tags `HAPPINESS_BEFORE` and `HAPPINESS_AFTER` are configuration and never public payload fields.

## 15. Incremental delivery

### Phase 0 — Baseline and contracts

Capture current behavior, run existing tests, add the disabled staging flag, and finalize schemas/contracts.

Exit: baseline evidence saved; nothing user-visible enabled.

### Phase 1 — Domain and persistence

Add append-only migrations, validators, optimistic locks, idempotent commands, revisions, duplication/templates and cross-event reference protection.

Exit: domain tests prove lifecycle, historical integrity and copy safety.

### Phase 2 — Organizer APIs and Builder

Implement CRUD, revisions, templates, Experiences list, accessible timeline and schema-driven step editors.

Exit: two unrelated workflows can be built without code changes.

### Phase 3 — Shared presentation scenes

Build the generic registry, theme system and initial renderers shared by preview/display.

Exit: visual QA passes at all target display sizes.

### Phase 4 — Run and Presenter

Implement runs, locks, audit, elapsed time, notes, controls and existing-activity orchestration.

Exit: presenter runs the whole experience from one screen.

### Phase 5 — Display and realtime

Assign run to named display, add run events/state, preserve polling recovery and test two-display isolation.

Exit: TV follows state without refresh and recovers from disconnect.

### Phase 6 — Guest routing

Project only the active activity/question and reuse existing participation/moderation.

Exit: guests receive only relevant actions and refresh safely.

### Phase 7 — Comparison and saved artifacts

Implement real-denominator before/after and immutable approved word-cloud artifacts.

Exit: calculations and moderation are verified.

### Phase 8 — MBF staging configuration

Create theme and 15 steps as data, confirm media rights, validate Arabic with a knowledgeable reviewer, and rehearse the 18-minute run.

Exit: no generic code contains MBF assumptions.

### Phase 9 — Reusability proof

Build **Technology Conference Opening** through the same UI:

```text
Hero -> Poll -> Results -> Video -> Word Cloud -> Closing
```

Duplicate it to another staging event. Copy activities/questions safely; never copy responses, analytics, tokens or run state.

### Phase 10 — Staging acceptance

Run presenter + TV + three guests, refresh all clients, run two displays, inject Redis/SSE/AI/workflow failures, execute 500+ transitions, run for hours, load thousands of existing responses and soak for at least 48 hours.

Production remains blocked after staging completion until separately approved.

## 16. Required tests

### Domain/data

- allowed/forbidden transitions;
- immutable revisions;
- deterministic reorder;
- stale lock conflict and idempotent duplicate commands;
- template/duplicate data stripping;
- cross-event/org rejection;
- comparison mapping and unequal denominators;
- migration forward/rollback rehearsal.

### Realtime/recovery

- commit-before-publish;
- missed/duplicate/out-of-order events;
- Redis failure without state loss;
- SSE/poll recovery;
- presenter/display/guest refresh;
- timer reconstruction from server deadline;
- multi-run/display channel isolation;
- long-running listener/timer leak checks.

### Security/accessibility

- notes absent from public payload/network;
- display token cannot mutate;
- presenter cannot edit/delete/template;
- guests cannot enumerate runs;
- media validation and stored-XSS prevention;
- moderation before word-cloud display;
- event/org/session scoping;
- keyboard builder and non-drag reorder;
- focus, accessible forms, contrast, non-color results;
- Arabic RTL shaping and reduced motion.

### Screen matrix

TV: 1280x720, 1366x768, 1920x1080, 1920x1200, 2560x1440 and 3840x2160.

Mobile: 320, 375, 390 and 430px.

## 17. Observability

Add workflow metrics for active runs, transitions/outcomes, transition latency, errors, active presenters, display subscriptions, timer failures and state conflicts.

Structured logs include workflow/run/revision/step, transition sequence, request and authorized actor IDs. Exclude tokens, presenter-note content and private answers.

## 18. Staging deployment and rollback

- Additive migrations only.
- Flag off by default and scoped to staging event/org.
- Unique staging image tags for frontend, API and worker.
- Existing activity/display paths remain unchanged when no run is assigned.
- Rollback disables the flag and unassigns the run first.
- Previous images remain available.
- Do not run destructive down migrations on shared/live data.

## 19. Visual evidence and acceptance

Concept mockups are design inputs, not proof. Before readiness, capture actual staging screenshots of Opening, Happiness Poll, Results, Twenty Years, Harvard Video, Islamic Perspective, Connection Test, Connection Challenge, Community Check, Next 20 Years, Word Cloud, Before/After, Closing, Presenter, Builder and Mobile Poll.

Score the implemented staging screens against the approved design only after those screenshots exist. Static concepts cannot satisfy final acceptance.

Staging is done only when:

- workflow/revision/run architecture is reusable;
- MBF is configuration only;
- the Technology Conference workflow proves reuse;
- presenter, TV and guest behavior work end-to-end;
- existing response/analytics/moderation remain authoritative;
- comparison, refresh/reconnect and display isolation pass;
- long-run and failure-isolation tests pass;
- core Festio remains unaffected;
- the final staging report returns exactly one required readiness status.
