# Phase 0 — Redesign Rollout: Inventory & Mutation Policy

Companion document to `/home/dev/events/FESTIO_ADMIN_REDESIGN_WIRING_PROMPT.md`
(the governing migration plan). This records what Phase 0 established, as
required by that plan's Phase 0 checklist ("record baseline legacy workflows",
"identify destructive and externally visible operations", "define a
consistent mutation policy").

## 1. Legacy `/admin` tab → redesign page-boundary mapping

Real `AdminPage.jsx` tabs (`activeTab` values) mapped onto the consolidated
redesign page boundaries already agreed in the governing doc's Phase 2 table:

| Legacy `AdminPage.jsx` tab | Redesign page boundary |
|---|---|
| overview | `AdminRedesignPage` |
| guests, invite | `GuestsRedesignPage` |
| communication, messages, features | `CommunicationsRedesignPage` |
| access, rules | `CheckinRedesignPage` |
| seating, menu, registry, logistics | `AddonsRedesignPage` |
| tasks, team | `TeamRedesignPage` |
| billing | `BillingRedesignPage` |
| experience | `ExperienceRedesignPage` |
| (New Event / Guided Setup entry points) | `SetupRedesignPage` |

Day-of/public/guest-facing surfaces (not `AdminPage.jsx` tabs, tracked
separately per the governing doc's Phase 7):

| Real page | Redesign page boundary |
|---|---|
| `ScannerPage.jsx` | `ScannerRedesignPage` |
| `KitchenPage.jsx` | `KitchenRedesignPage` |
| `SelfCheckinPage.jsx` | `SelfCheckinRedesignPage` |
| `FloorPlanPage.jsx` | `FloorPlanRedesignPage` |
| `ApiExplorerPage.jsx` | `ApiExplorerRedesignPage` |
| `VendorPage.jsx` / `RegistryPage.jsx` / `CalendarPage.jsx` | `PublicPagesRedesignPage` |
| `ResultsPage.jsx` | `EventResultsRedesignPage` |
| `ConsolePage.jsx` / `MediaPage.jsx` | `SuperadminRedesignPage` |
| `HelpPage.jsx` | `HelpRedesignPage` |
| FestioMe app | `FestioMeRedesignPage` |
| Design Studio | `DesignStudioRedesignPage` |

## 2. Destructive / externally-visible operations inventory

Real endpoints identified by grep across `backend/app/routers/`; these are
the operations the Phase 0 mutation policy (§3) applies to first, and the
ones every later-phase module must never fire without explicit user
confirmation and server-confirmed success.

| Operation | Endpoint | File:line |
|---|---|---|
| Manual invite send | `POST /{event_id}/send-invites` | `routers/events.py:1415` |
| Manual invite send (guests router) | `POST /{event_id}/guests/send-invites` | `routers/guests.py:2008` |
| Batch invite send | — | `routers/guests.py:2034` |
| Resend single invite | `POST /{event_id}/guests/{guest_id}/resend-invite` | `routers/guests.py:2084` |
| Broadcast message | `POST /{event_id}/broadcast` | `routers/events.py:1050` |
| Post-event thank-you send | — | `routers/events.py:1385` |
| Calendar link send | — | `routers/calendars.py:488` |
| Vendor notification send | — | `routers/logistics.py:343` |
| Org subscription checkout | `POST /subscription/checkout` | `routers/org_billing.py:87` |
| Org subscription cancel | `POST /subscription/cancel` | `routers/org_billing.py:131` |
| Event Pass checkout | `POST /checkout` | `routers/billing.py:136` |
| QR scan / admission | `POST /{qr_token}` | `routers/scanner.py:893` |
| Checkout scan | `POST /{qr_token}/checkout` | `routers/scanner.py:921` |
| Zone scan | `POST /{qr_token}/zone` | `routers/scanner.py:1220` |
| Suspend/reactivate org | `PATCH /orgs/{org_id}/active` | `routers/admin.py:448` |
| Delete org | `DELETE /orgs/{org_id}` | `routers/admin.py:485` |
| Remove org member | `DELETE /orgs/{org_id}/members/{user_id}` | `routers/admin.py:512` |
| Suspend/reactivate user | `PATCH /users/{user_id}/active` | `routers/admin.py:524` |
| Delete user | `DELETE /users/{user_id}` | `routers/admin.py:541` |
| Remove operator | `DELETE /operators/{user_id}` | `routers/admin.py:591` |
| **Redesign cohort change** (new, this phase) | `PATCH /orgs/{org_id}/redesign-cohort` | `routers/admin.py` (added Phase 0) |

None of these are touched by Phase 0 beyond the new cohort endpoint itself —
listed here as the baseline set that later-phase wiring must handle under
the mutation policy below, not as work done in this phase.

## 3. Mutation policy (adopted verbatim from the governing doc)

> Use confirmed server updates by default. Optimistic updates may be used
> only for low-risk, reversible presentation changes. Always wait for
> server confirmation for: Messaging, Invitations, Billing, Credits,
> Permissions, Deletion, Seating assignments, Event lifecycle, Check-in,
> Kitchen fulfillment, API-key management, Superadmin operations.

## 4. Rollback procedure

Instant, server-side, no redeploy, no DB rollback:

```
PATCH /orgs/{org_id}/redesign-cohort
Body: {"redesign_cohort": "legacy_only"}
Auth: platform superadmin (require_superadmin)
```

Every operator in that org loses redesign access on their next event fetch
(`GET /events`, already polled). Platform superadmins always retain access
regardless of any org's cohort (QA bypass, `User.is_platform_superadmin`).

## 5. Phase 0 mechanism reference

- **Column**: `Organization.redesign_cohort` (`backend/app/models.py`) — one
  of `legacy_only | redesign_opt_in | redesign_internal | redesign_cohort |
  redesign_default | legacy_retired`, default `legacy_only`.
- **Write endpoint**: `PATCH /orgs/{org_id}/redesign-cohort`
  (`backend/app/routers/admin.py`, superadmin-only, mirrors the existing
  `set_org_active` pattern).
- **Read path**: `_event_out_for_user()` (`backend/app/routers/events.py`)
  derives `EventOut.my_redesign_accessible` — no new GET endpoint, reuses
  the existing `GET /events` response `AdminPage.jsx` already fetches.
- **Frontend entry point**: a "Preview new design →" link in
  `frontend/src/pages/AdminPage.jsx`'s header, gated on
  `event?.my_redesign_accessible`, navigating to the existing, untouched
  `/admin-redesign` route.
- **Test org**: `backend/scripts/seed_redesign_test_org.py` — creates
  `slug=internal-redesign-qa` (distinct from the protected
  `DEFAULT_ORG_ID`), with one seeded draft event, run manually per
  environment.

Explicitly out of scope for Phase 0 (deferred to later phases per the
governing doc): wiring real data into `RedesignShell`/`mockEntitlements.js`,
per-state UX differences between the six cohort values (Phase 0 treats
anything other than `legacy_only` as a uniform "show the link" gate),
route-level gating of the `*-redesign` routes themselves, and any contract/
adapter/hook work (Phases 3-4).
