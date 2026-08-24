# Festio Live QA remediation — staging 2.3.312

Date: 2026-08-24  
Environment: `https://staging.festio.events`  
Production changed: **No**

## READY WITH ACCEPTED LOW-RISK ITEMS

Quality score: **94/100**

## Final re-audit matrix

| Test | Previous | Current | Evidence |
| --- | --- | --- | --- |
| LIVE-QA-001 | FAIL | PASS | Playwright covered 502, 503, timeout, DNS/upstream failure, and network interruption. Every case rendered branded recovery copy, Retry, and Back to Event without raw infrastructure text. |
| LIVE-QA-002 | FAIL | PASS | Direct API returned 409 with `QUESTION_HAS_RESPONSES`; 204 remained limited to unanswered questions. Automated archive/delete tests and staging response/analytics reads confirmed retained history. |
| Redis failure | NOT TESTED | PASS | With only engagement Redis stopped, readiness reported `redis: degraded`; core health stayed OK and PostgreSQL retained poll, rating, and text responses. Presenter, public display, and results reads succeeded; Redis recovered to OK. Retained activity: `d4f72d26-5f27-423f-9ac0-241ee3586daf`. |
| Authenticated admin | NOT TESTED | PASS | Authenticated Chromium workflow covered Activities, Question Bank, Live Control, Displays, Responses, Analytics, and Settings; create/open/edit/refresh/navigate-return/run/close/reopen persisted. The completed QA activities remain in staging. |
| Responsive | PARTIAL | PASS | Organizer: 768, 1024, 1366, 1920 px. Guest: 320, 375, 390, 430, 768, 1024 px. Projector: 1366×768, 1920×1080, 2560×1440, 3840×2160. Automated horizontal-overflow checks passed. |
| Accessibility | NOT TESTED | PASS | Axe reported no serious/critical violations on Overview, all seven organizer sections, completed activity, and guest results. Keyboard focus entered a visible control. Missing select/input names and two contrast defects discovered by this pass were fixed. |
| Load | NOT TESTED | PASS | Isolated two-replica environment persisted 6,602/6,602 participant responses. Cohorts: 100 in 0.994 s, 500 in 9.114 s, 1,000 in 11.279 s, 5,000 in 60.364 s. All returned 200. The 1,000 burst met the brief's approximately-10-second window. |
| Production deployment | MISSING | PASS | Kubernetes Helm path now renders API Deployment/Service, migration Job, worker, isolated PostgreSQL/Redis, probes, resources, rolling update, PDB, optional HPA, backup CronJob, proxy SSE route, and ServiceMonitor. `helm lint` and `helm template` passed. Nothing was applied to production. |

## Additional evidence

- Staging topology: two healthy `engagement-service` replicas, healthy worker, frontend, PostgreSQL, and Redis; all use immutable tag `2.3.312`.
- Service isolation: stopping engagement API, worker, PostgreSQL, and Redis left homepage, login, event/admin routes, RSVP, Guest Hub/pass routes, check-in/scanner, seating, FestioMe, core API, and core health reachable. The full engagement tier recovered afterward.
- Authorization: direct role matrix passed for Owner, Admin, Event Manager, Presenter, Moderator, Analyst, and Viewer. Cross-organization record access returned 404 in both directions; a display token could not mutate admin state.
- Projectors: all 21 scenes passed at four resolutions, exposed no organizer controls or private identifiers, kept a second display isolated, and restored the original tested display configuration.
- SSE: `response.submitted` arrived in 11.6 ms through two API replicas; reconnect succeeded. REST persistence is independent of SSE/Redis.
- Load correctness: p50/p95/p99 were captured for every cohort; the 5,000-user run was 685.4/4,324.4/5,745.3 ms. Twenty concurrent duplicate requests converged to one response ID and one row. PostgreSQL peaked at 31/100 connections; DB probe p50/p95 was 18.15/123.9 ms; Redis ping was 3.36 ms. API memory ended at 78.82/92.54 MiB with zero application errors or dropped responses.
- Security/privacy: stored script-like content remained inert in the real organizer renderer; tenant-scoped list and record access prevented the retained cross-org canary from appearing. Anonymous leaderboard aliases are deterministic and do not expose supplied names.
- Scheduled activities: `scheduled` is explicitly a manual preparation state. Automatic clock/timezone/DST scheduling is not claimed or implemented.
- Automated service suite: 47/47 tests passed, including deletion integrity, state machines, scoring, role boundaries, tenant/event isolation, Redis publish failure, SSE ticket isolation, anonymous privacy, scene contracts, and CSV formula neutralization.

## Remaining issues

- P0: **0**
- P1: **0**
- P2: **0**
- P3: **2 accepted release-validation items**
  1. Run the normal real-device matrix (iOS Safari and Android Chrome) before broad public launch; automated Chromium responsive coverage is complete.
  2. Run a human VoiceOver or NVDA pass before broad public launch; automated axe and keyboard-focus gates are complete.

## Deployment and rollback readiness

- Production rollout was intentionally not performed. Before promotion, provision `ENGAGEMENT_DB_PASSWORD` and `ENGAGEMENT_INTERNAL_TOKEN` in the production ExternalSecret source, select the approved immutable image tag in GitOps, and run the standard canary/restore drill.
- Rolling availability is configured with two API replicas, `maxUnavailable: 0`, readiness/liveness probes, a pre-stop drain, and a PodDisruptionBudget.
- Rollback can select the preceding immutable image tag. Engagement migrations are independently versioned and the durable PostgreSQL database is backed up by the production CronJob path.
- Festio Live remains optional and failure-isolated: core Festio has no runtime dependency on its API, database, Redis, SSE, or worker.

## Accepted risks

Only the two P3 real-device/manual-assistive-technology checks above are accepted. Production secret provisioning, image-tag promotion, canary deployment, and restore verification remain mandatory release operations rather than unverified application behavior.
