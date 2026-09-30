# Festio Complete Guided Platform Upgrade Plan

**Date:** September 30, 2026
**Status:** Phases 1–6 implemented on the guided-setup feature branch and deployed to staging for acceptance
**Goal:** Make every Festio capability procedural, discoverable, resumable, and understandable without requiring users to learn the product’s internal module structure.

## 1. Product model

Festio should ask **“What do you want to accomplish?”** and generate an ordered setup recipe from the answer. The guide must orchestrate existing services and data. It must not create duplicate guest, ticket, session, website, gift, donation, seating, or event records.

Every recipe uses the same structure:

1. Explain the outcome and prerequisites.
2. Collect only information that is not already present in Event Setup.
3. Deep-link to or embed the existing workspace.
4. Derive completion from live server data.
5. Show blockers and their resolution.
6. Preview the guest, staff, presenter, or public result.
7. Provide a safe test or rehearsal.
8. Publish or activate.
9. Show the next operating action.
10. Close out and report.

Every step has six possible states: **locked, ready, in progress, blocked, complete, or skipped**. Required steps cannot be manually skipped. Optional steps can be skipped with an explanation.

## 2. Complete capability-to-phase map

| Product capability | Guided recipe | Phase |
|---|---|---:|
| Organizations, profile, workspace | Organization readiness | 1 |
| Event creation, dates, venue, type, status | Event foundation | 1 |
| Team, roles, event assignments | Team readiness | 1 |
| Billing, plan, credits, add-ons, entitlements | Capability readiness | 1 |
| Existing-event resume and setup status | Setup Guide foundation | 1 |
| Guests, manual entry, import, sync, deduplication | Build the audience | 2 |
| RSVP, questions, categories, plus-ones, approval | Launch RSVP | 2 |
| Ticket products, payouts, checkout, discounts, orders | Launch Ticket Sales | 2 |
| Festio Pass, QR delivery, admission information | Issue guest passes | 2 |
| Email, SMS, WhatsApp, MMS | Connect communication channels | 2 |
| Inbox, broadcasts, schedules, reminders | Communicate with guests | 2 |
| Routing, consent, decline/rejection, thank-you | Communication automation | 2 |
| Design templates and branding | Choose event design | 3 |
| Event Website | Publish an event website | 3 |
| RSVP/invitation page | Publish an invitation experience | 3 |
| Flyer, email preview, Festio Pass design | Create event materials | 3 |
| GuestHub | Launch the guest home | 3 |
| FestioMe | Launch the guest community | 3 |
| Speakers and public speaker page | Publish speakers | 3 |
| Partners, sponsors, and public partner page | Publish partners | 3 |
| Planner, budget, vendors, procurement, contracts | Plan event delivery | 4 |
| Timeline, milestones, runsheet, documents | Prepare event operations | 4 |
| Tasks, owners, team coordination, messages | Coordinate the team | 4 |
| Seating, floor plan, table groups, assignment | Plan seating | 4 |
| Meals, items, orders, kitchen fulfillment | Plan meals and orders | 4 |
| Deliveries, packing, vendors | Plan logistics | 4 |
| Venue zones, gates, access rules, capacity | Configure venue access | 4 |
| Check-in, devices, manual lookup, walk-ins, checkout | Prepare check-in | 4 |
| Experience workflows, consent, journeys, attendance | Build the guest journey | 4 |
| Gift List, gifts, cash funds | Publish a gift list | 4 |
| Giving Hub, pledges, payment channels | Launch giving | 4 |
| Finance confirmation and reconciliation | Reconcile contributions | 4 |
| Conference settings and public calls | Launch Conference Center | 5 |
| Abstracts, reviews, tracks, sessions, rooms | Build the programme | 5 |
| Speaker operations, releases, meetings | Operate speakers | 5 |
| Exhibitors, sponsors, booths, galleries | Operate conference partners | 5 |
| Festio Live activities and question bank | Create live engagement | 5 |
| Presenter, control room, channels, displays | Rehearse and run live | 5 |
| Presenter materials | Prepare presentation resources | 5 |
| Certificates | Issue certificates | 5 |
| Live responses and analytics | Analyze engagement | 5 |
| RSVP, ticket, attendance, communication results | Measure event results | 6 |
| Operational, seating, order, access results | Close event operations | 6 |
| Giving and finance reports | Close giving | 6 |
| Exports and event archive | Close and archive event | 6 |
| Organization templates and duplication | Reuse a successful setup | 6 |
| Academy and contextual Help | Learn in context | 6 |
| API keys, public API, webhooks | Connect external systems | 6 |
| Calendar, spreadsheet, cloud and provider integrations | Integration center | 6 |
| Console, trials, pricing, accounts, operators | Platform operations | 6 |
| Media library and reusable assets | Organization media | 6 |
| Setup analytics and abandonment | Improve onboarding | 6 |

This table is the scope ledger. A phase is incomplete if any assigned capability lacks a route, recipe, status rule, help content, preview/test path, or explicit “not available” state.

## Phase 1 — Universal guide, organization, and event foundation

### User outcome

A first-time or returning organizer can establish a valid event workspace, understand which capabilities are available, choose desired outcomes, assign responsibility, and resume from one clear next action.

### 1.1 Organization readiness recipe

Organization profile → primary contact → timezone/currency defaults → sender/provider status → billing owner → plan and credits → readiness result.

**Completion evidence:** organization exists; required profile fields exist; billing and provider states are returned from their current services.
**Blockers:** missing administrative permission, suspended organization, unavailable provider, or plan restriction.

### 1.2 Event foundation recipe

Event name/type → attendance model → start/end/timezone → venue/address → capacity → organizer/host → event status → save draft.

**Completion evidence:** valid persisted event record.
**Important behavior:** venue and other reusable details flow automatically into websites, passes, communications, check-in, and programme pages.

### 1.3 Team readiness recipe

Choose required roles → invite or select members → assign event access → select owners for registration, communication, operations, finance, and live programme → verify permissions.

**Completion evidence:** accepted or pending team assignment records; server-confirmed role access.

### 1.4 Capability readiness recipe

Choose outcomes → map outcomes to required modules → show included/gated/provider-dependent status → explain costs or credits → enable authorized capabilities → show unresolved blockers.

**Completion evidence:** current entitlements and event feature settings. Enabling a guide never bypasses entitlement enforcement.

### 1.5 Setup Guide shell

Outcome launcher → lifecycle navigation → status summary → blockers → next recommended action → open full workspace → contextual help → preview/test → resume.

### Phase 1 mockups required

- Outcome launcher for a new event.
- Existing-event setup dashboard.
- Organization and provider readiness panel.
- Event foundation procedure.
- Team ownership procedure.
- Capability selection and entitlement explanation.
- Mobile guide navigation.

### Phase 1 staging gate

- Existing Event Setup and all direct routes remain available.
- Event creation writes the same contract as the existing wizard.
- Event context is retained across guide links.
- Progress is derived from live data and survives refresh/device changes.
- Unauthorized users cannot view or mutate restricted steps.
- Feature flag disables the entire guide without data changes.
- Product approval is required before Phase 2 implementation.

## Phase 2 — Audience, RSVP, tickets, passes, and communication

### User outcome

An organizer can build an audience, choose free RSVP or paid admission, configure the form and communications, complete a realistic test, and launch registration.

### 2.1 Build the audience recipe

Choose source → manual entry, CSV/XLSX, Google Sheets, or OneDrive → download template → map columns → validate names/phones/emails/tags/ticket types → preview changes → import/sync → review duplicates/warnings → segment audience.

**Completion evidence:** guest count, import job result, sync health, and unresolved warning count.

### 2.2 RSVP recipe

Choose public or personal links → set deadline/capacity/approval → choose submitter fields → configure additional guests → create categories and category limits → add custom questions → configure orders/address collection where enabled → preview → submit test RSVP → verify guest/pass/confirmation → publish and share.

**Completion evidence:** RSVP enabled, valid form settings, public/personal link available, and test result recorded.

### 2.3 Ticket Sales recipe

Enable sales → choose currency/fees/tax → verify payment provider → create ticket products → set price/capacity/window/visibility → connect access type → configure attendee fields → discounts/add-ons → confirmation/pass delivery → refund/transfer rules → preview page/embed → test checkout → verify payment/order/guest/pass/message → publish → monitor orders and waitlist.

**Completion evidence:** enabled ticket configuration, verified selected payout account, active product, valid public page, and test order result.
**Unavailable behavior:** unsupported group-ticket, widget, discount, or abandoned-registration capabilities must appear as unavailable rather than simulated.

### 2.4 Festio Pass recipe

Choose design → select displayed event/guest/admission details → QR policy → delivery channels → wallet/download options where supported → preview named sample → test delivery → activate.

### 2.5 Channel connection recipe

Email sender → SMS provider → WhatsApp sender/templates → MMS availability → credit balance → consent requirements → send controlled test → verify final delivery state.

### 2.6 Guest communication recipe

Choose guest surfaces → configure FestioHub updates/host message/chat/posting → map message types to channel routing → create invitation/confirmation/reminder/admission templates → schedule broadcasts → configure decline/rejection and post-event messages → select test audience → preview → send test → activate automation.

**Message types covered:** invitations, admission notifications, RSVP reminders, approvals, deliveries, broadcasts, decline/rejection, and post-event thank-you/feedback.

### Phase 2 mockups required

- Audience import and warning-resolution flow.
- RSVP setup and test flow.
- Ticket Sales setup and test checkout flow.
- Festio Pass setup and delivery flow.
- Channel readiness and test-send flow.
- Communication routing and automation flow.

### Phase 2 staging gate

- RSVP and ticket records remain separate where their business models differ but create one consistent guest/admission result.
- Imports are idempotent and expose warnings before mutation.
- Provider acceptance is not reported as final delivery.
- Test sends use explicit controlled recipients.
- Checkout, refund, transfer, pass, and check-in regressions pass.
- Existing RSVP and ticket URLs remain valid.
- Product approval is required before Phase 3 implementation.

## Phase 3 — Design, public pages, GuestHub, and community

### User outcome

An organizer can create a complete, branded public and guest-facing experience without re-entering event, venue, speaker, programme, or registration data.

### 3.1 Design recipe

Choose template/collection → set logo/colors/fonts → select media → preview desktop/tablet/mobile → accessibility check → save organization or event design.

### 3.2 Event Website recipe

Use synced event identity → select page structure → choose sections → map programme/tracks/speakers/venue/registration → add section images → configure header/footer from available system destinations → fill identified content gaps → preview responsive page → SEO/share/accessibility checks → publish/version/rollback.

### 3.3 Invitation and RSVP-page recipe

Choose design → inherit event details → edit welcome/instructions → select cover → preview form and confirmation → test link → publish.

### 3.4 Event materials recipe

Flyer → email presentation → Festio Pass → social/share artwork → generated links/QR codes → preview/export/publish.

### 3.5 GuestHub recipe

Select guest modules → pass → personal programme → speakers → exhibitors/partners → Festio Live → activities → feedback → event information → venue/contact → confirm access rules → preview as registered guest → publish.

### 3.6 FestioMe recipe

Enable community → audience/privacy → profiles and discovery → channels/groups → moderation → announcements → guest chat and direct interaction → notification behavior → preview as guest/moderator → open community.

### 3.7 Speaker and partner public pages

Use existing profiles → choose visible fields → session or sponsorship relationships → photos/logos/links → ordering/categories → preview → publish → link automatically from website and GuestHub.

### Phase 3 mockups required

- Design selection and brand system.
- Event Website procedural studio.
- Reusable event material generator.
- GuestHub module picker and mobile preview.
- FestioMe privacy/moderation setup.
- Speaker and partner publishing flows.

### Phase 3 staging gate

- Event Setup remains the source for dates and venue.
- Conference/Experience remains the source for programme and sessions.
- Speaker and partner records are reused rather than copied.
- Published versions can be restored.
- All public routes work without authentication where intended.
- Mobile, accessibility, metadata, email-protection, and URL validation pass.
- Product approval is required before Phase 4 implementation.

## Phase 4 — Planning, event operations, check-in, gifts, and giving

### User outcome

Operations and finance teams can prepare and run the physical event from connected procedures while guests see accurate assignments and progress.

### 4.1 Planner recipe

Choose planning template → milestones → budget/categories → vendors → procurement → contracts → timeline → runsheet → documents → owners/alerts → readiness review → event closeout.

### 4.2 Tasks and coordination recipe

Create workstreams → assign owners → due dates/dependencies → attachments/messages → status review → overdue escalation → day-of view → completion.

### 4.3 Seating and floor-plan recipe

Choose terminology → create rooms/areas → upload or create floor plan → table groups → tables/capacity → category routing → partner linking → assignment rules → table fill order → manual exceptions → guest preview → conflict/capacity check → publish assignments.

### 4.4 Meals, merchandise, and orders recipe

Create categories/items → selection rules/deadlines → RSVP/GuestHub placement → kitchen/vendor views → table aggregation → fulfillment status → exceptions → closeout/export.

### 4.5 Logistics and deliveries recipe

Create shipment/packing categories → vendors → expected dates → guest addresses → packing list → dispatch → tracking → delivery confirmation → exception resolution → report.

### 4.6 Venue access recipe

Create zones → capacities → ticket/tag rules → gates → entry/exit direction → staff/device assignment → denial reasons → occupancy display → test allowed/denied credentials → activate.

### 4.7 Check-in recipe

Choose admission behavior → pass/QR readiness → manual lookup → walk-ins → automatic table assignment → check-out → scanner roles/devices → offline/failure procedure → multi-device race test → open stations → monitor arrivals/occupancy → close.

### 4.8 Experience recipe

Choose guest journey → create steps → prerequisites → consent → room assignment → souvenir/badge → session attendance → time gates → staff actions → guest progress view → rehearsal → activate → completion reporting.

### 4.9 Gift List recipe

Choose physical gifts/cash funds → add items/targets/instructions → privacy and claim rules → public page → RSVP/website placement → test claim/unclaim → publish → monitor and close.

### 4.10 Giving recipe

Campaign/goal → payment channels → giving amounts → donation versus pledge → anonymous/hidden amount options → instructions/provider connection → donor confirmation → GuestHub/website link → public progress → QR/projector → test contribution → publish.

### 4.11 Finance reconciliation recipe

Invite finance user → pending transactions → filter by channel/reference/date → verify or reject → retain audit history → update one contribution ledger → donor/pledge counts → projector totals → discrepancy review → export and close.

### Phase 4 mockups required

- Planner and event-command flow.
- Tasks and role ownership flow.
- Seating/floor plan procedure.
- Orders and kitchen procedure.
- Logistics procedure.
- Venue access and scanner rehearsal.
- Experience journey builder.
- Gift List and Giving decision flow.
- Finance reconciliation workspace.

### Phase 4 staging gate

- Existing assignments, orders, access rules, and donation tracker remain compatible.
- Gift and donation surfaces use one contribution record where intended.
- Check-in is idempotent across concurrent devices.
- Access denial and occupancy remain server-enforced.
- Finance confirmation alone changes confirmed totals.
- Projector, Giving Hub, Gift List, and reconciliation agree.
- Product approval is required before Phase 5 implementation.

## Phase 5 — Conference Center, Festio Live, presenters, and certificates

### User outcome

Programme teams can build a full conference, prepare presenters, rehearse audience engagement, operate live sessions, and issue verifiable certificates.

### 5.1 Conference foundation recipe

Conference identity → dates/venue inherited from Event Setup → programme team → tracks → rooms → audience types → submission and publication timeline → save.

### 5.2 Calls and abstracts recipe

Create call → question form → eligibility → dates → reviewers/rubric → public call page → test submission → open → review/decision → notify → convert accepted work to sessions.

### 5.3 Programme recipe

Tracks → sessions → dates/times → rooms/capacity → speakers → audience → conflicts → materials → attendee schedule → day tabs/filtering → preview → publish.

### 5.4 Speaker operations recipe

Profiles → invitations → consent/releases → bios/photos → session assignments → materials → meetings/tasks → missing-information report → presenter access.

### 5.5 Exhibitor and sponsor recipe

Packages/categories → organizations → contacts → booth/placement → assets → tasks/deliverables → public listing → attendee links → reporting.

### 5.6 Festio Live activity recipe

Choose poll/quiz/Q&A/word cloud/survey/rating/prediction/feedback → question bank or new content → response rules → anonymity/moderation → audience/timing → presenter assignment → GuestHub placement → preview/test.

### 5.7 Control room and display recipe

Select run-of-show activity → audience channel/QR → presenter device → moderator → projector/TV layout → realtime connection → fallback plan → rehearsal → open/close activity → moderate → move to next → retain results.

### 5.8 Presenter-material recipe

Assign presenter/session → upload slides/PDF or attach supported link/sheet → validate access → order materials → presenter view → projection/download policy → rehearsal → publish resources.

### 5.9 Certificate recipe

Choose certificate type → design/template → recipient fields → eligibility from registration/attendance/completion → approver/signature → preview sample → issue test → verify public code → batch issue → email/download → revoke/reissue → report.

### 5.10 Engagement analytics recipe

Response completeness → moderation outcomes → activity comparison → audience/track/session filters → export → share report → recommended follow-up.

### Phase 5 mockups required

- Conference start-to-publish flow.
- Abstract review and acceptance flow.
- Programme builder and attendee schedule.
- Speaker operations workspace.
- Exhibitor/sponsor workflow.
- Festio Live activity creation flow.
- Unified control room and rehearsal flow.
- Presenter materials workspace.
- Certificate design and issuance flow.
- Engagement insights flow.

### Phase 5 staging gate

- Session, speaker, track, room, and material records have one source of truth.
- Public programme and GuestHub reflect published programme data.
- Realtime presenter/control/display behavior works across separate sessions and replicas.
- Activity response rules and anonymity are enforced server-side.
- Certificate eligibility, verification, revocation, and delivery pass.
- Product approval is required before Phase 6 implementation.

## Phase 6 — Results, reuse, Help, and integrations

### User outcome

Teams can close an event, understand results, reuse proven structures, connect external tools safely, and receive contextual guidance throughout Festio.

### 6.1 Results recipe

Select event objective → RSVP/registration → ticket revenue → communication delivery → attendance/check-in → sessions/engagement → seating/orders/logistics → giving → feedback → exceptions → export/share.

### 6.2 Event closeout recipe

Stop sales/RSVP → close check-in/live activities → reconcile finance → finish tasks/deliveries → issue certificates → send thank-you/feedback → export records → archive event → retain public-page policy.

### 6.3 Reuse recipe

Choose source event/template → inspect included modules → explicitly include/exclude guests, content, programme, design, messaging, operations, and finance settings → scrub dates/private data → preview new structure → create draft → run readiness.

### 6.4 Contextual Help and Academy recipe

Every guide step shares a recipe ID with Help and Academy → short explanation → exact procedure → expected result → common errors → next step → deeper lesson/video → completion evidence.

### 6.5 Integration Center recipe

Choose integration → explain data direction and ownership → authorize/configure → map fields → least-privilege scope → test → health/status → sync history → retry/reconnect → disable without deleting Festio data.

**Covered integration families:** spreadsheet imports/sync, calendars/ICS, payment providers, email/SMS/WhatsApp/MMS providers, API keys, webhooks, public API, and future verified AMS providers.

## Internal platform programme — outside the organizer event flow

The following controls are intentionally excluded from Guided Event Setup. They remain available only through separate, role-protected platform administration workspaces.

### P.1 Platform operations

Organization/account search → trials/comps/credits → pricing/plans → add-on overrides → operators → suspensions → safe support access → audit log → guarded destructive actions.

### P.2 Platform media administration

Organization ownership → type/size/access validation → usage references → safe replacement → archive/delete safety. Organizer-facing event media should be exposed later through an organization-scoped workspace, without superadmin controls.

### P.3 Setup analytics

Time to first event → time to test → time to publish → completion/drop-off by recipe and step → blocker frequency → support requests → test-to-live conversion → recommended content/product improvements.

### P.4 Controlled production rollout

Internal staging → selected staging organizations → acceptance review → production code dark launch → pilot organizations → monitored expansion → default for new events → optional migration for existing events → later navigation simplification only after evidence.

### Phase 6 mockups required

- Unified results and closeout.
- Safe template/duplication flow.
- Contextual Help drawer and Academy handoff.
- Integration Center and connection health.

### Organizer Phase 6 gate

- All prior staging gates still pass in full regression.
- Existing direct routes and public links remain supported.
- Role and cross-organization isolation pass at API and UI layers.
- Organizer roles cannot access platform administration controls from Guided Event Setup.
- Existing direct routes and public journeys continue to pass regression.

### Separate internal platform gate

- Feature flags support organization-level enable/disable without deployment.
- Monitoring covers guide failures and all critical public journeys.
- GitOps deployment and rollback are rehearsed.
- Production pilot is explicitly approved before activation.

## 3. Shared implementation architecture

### Recipe registry

Each procedure is a declarative recipe shared by navigation, progress, Help, Academy, tests, and analytics:

```json
{
  "id": "rsvp.launch",
  "phase": 2,
  "label": "Launch RSVP",
  "roles": ["owner", "admin", "registration_manager"],
  "feature_gate": "rsvp",
  "prerequisites": ["event.foundation"],
  "steps": ["audience", "form", "questions", "preview", "test", "publish"],
  "workspace_route": "/guests-redesign?tab=invite",
  "help_topic": "rsvp.launch"
}
```

### Completion adapters

Each module owns read-only checks that translate live data into guide state. Examples:

- Event: valid identity, date, timezone, and venue state.
- Guests: import/sync state and warning count.
- RSVP: enabled, valid form, link, and test submission.
- Tickets: enabled, provider, product, checkout, and test order.
- Website: required source gaps, saved version, and published version.
- Check-in: admission configuration, staff/device readiness, and rehearsal.
- Giving: active channels, test contribution, and finance reconciliation.
- Festio Live: activity, audience, presenter/display readiness, and rehearsal.
- Certificates: template, eligibility, test issue, and verification.

The guide may store user-selected recipes, assigned owners, optional-step decisions, and test acknowledgements. Business records remain in their current owning services.

### Safety controls

- Organization/event feature flags.
- Read-only status calculation before inline mutation.
- Idempotent mutations and existing authorization.
- Deep links that preserve selected event and return path.
- No hidden auto-publishing.
- Explicit test versus live indicators.
- Route, API-contract, permission, responsive, accessibility, and critical-journey tests.
- Staging rehearsal before each phase approval.

## 4. Mockup and approval sequence

For each phase:

1. Produce the phase overview mockup.
2. Produce mockups for every recipe listed in that phase.
3. Review navigation, terminology, procedure, mobile behavior, and empty/error states.
4. Revise and approve the mockups.
5. Implement only that phase on an isolated branch.
6. Run focused and regression tests.
7. Deploy only to staging.
8. Demonstrate the acceptance gate with evidence.
9. Approve or revise.
10. Begin the next phase only after approval.

## 5. Overall definition of done

The programme is complete when every capability in the scope ledger can be discovered from an organizer goal; configured through a clear sequence; resumed safely; validated from real system state; previewed and tested; operated by the correct role; explained through contextual Help; measured after the event; and disabled or rolled back without breaking existing workflows or public links.
