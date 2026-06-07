# Phase 1 — Multi‑Tenancy Foundation (implementation plan)

_Status: PLAN for review. No code written yet. Last updated 2026‑06‑06._

Goal: introduce a tenant boundary (Organization) so each customer only ever sees
their own events/guests, replacing the current global `admin` superuser. This is a
**prod data migration on a live DB** — plan, review, then implement behind care.

---

## 1. Current state (verified)

- `User.role` ∈ {`admin`,`official`} is **global**. `admin` = platform superuser.
  - `events.py:list_events` → admins get **all** events.
  - `events.py:_get_accessible_event` → admins **bypass** the per‑event check.
  - `auth.py:require_admin` / `require_official` gate routes on the global role.
- `EventUser` junction scopes `official` users to specific events (with
  `can_reassign_seats`, `can_manage_menu`).
- First Firebase sign‑in auto‑creates `User(role="official")` (`auth.py`). The
  existing admin was promoted manually in the DB.
- No `Organization` entity. All event‑scoped routers mount under `/api/events`
  (events, guests, seating, menu, dashboard). `scanner` (`/api/scan`) and
  `invite` (`/api/invite`) are **public token flows** — no account auth.

## 2. Target data model

New tables / columns (additive — existing child data stays scoped by `event_id`):

```
Organization
  id            str pk (uuid)
  name          str
  slug          str unique            # for URLs / subdomain later
  region        str  = "US"           # "US" | "NG" (drives billing/compliance)
  currency      str  = "USD"          # "USD" | "NGN"
  plan          str  = "free"         # future: free|pro|business
  created_at    datetime

Membership            # user ↔ org, org‑scoped role  (replaces global User.role)
  id            str pk
  org_id        fk -> organizations.id
  user_id       fk -> users.id
  role          str  = "staff"        # owner | admin | staff
  created_at    datetime
  UNIQUE(org_id, user_id)

Event
  + org_id      fk -> organizations.id   # NEW; index

User
  + is_platform_superadmin  bool = False  # operator (you) only; NOT customer admin
  # keep `role` column during transition; stop reading it once Membership lands
```

Notes:
- `org_id` on `Event` is the **only** new FK needed — guests/tables/menu/RSVP all
  hang off `event_id`, so they inherit the tenant via their event.
- `EventUser` stays: it's now *intra‑org* per‑event staff permissions.
- Roles: **owner** (billing + everything), **admin** (manage events/guests), **staff**
  (assigned events only, via `EventUser`). Maps cleanly onto today's behavior.

## 3. Migration & backfill (the risky part)

Your pipeline auto‑patches plain ORM columns and runs manual `SCHEMA_PATCHES`
before the prod swap (fail‑fast). Steps:

1. Add ORM models/columns above. `Base.metadata.create_all` makes the new tables;
   auto‑patch adds `events.org_id` (nullable initially) + `users.is_platform_superadmin`.
2. **Backfill (manual `SCHEMA_PATCHES` / one‑off script run in Phase 5 of deploy):**
   - Create one default Organization (e.g. "Default Org") if none exists.
   - `UPDATE events SET org_id = <default> WHERE org_id IS NULL`.
   - Insert a `Membership` for every existing `User` into the default org:
     current global `admin` → role `owner`/`admin`; `official` → `staff`.
   - Promote the operator account to `is_platform_superadmin = TRUE`.
3. After backfill, a follow‑up patch sets `events.org_id` **NOT NULL** (separate
   deploy, once verified — same pattern as the `email DROP NOT NULL` change).

Backfill must be **idempotent** (guard on "default org exists", `IS NULL` updates)
so re‑runs are safe. Verify counts before flipping NOT NULL.

## 4. Access‑control refactor

Single choke point instead of per‑route checks:

- New dependency `get_current_membership(user)` → the caller's org(s)/role.
- New dependency **`resolve_event(event_id, user)`** → loads the Event **and**
  asserts `event.org_id` is in the caller's orgs (404 if not, to avoid leaking
  existence). Replaces `_get_accessible_event` and the scattered
  `db.get(Event, event_id)` calls in event‑scoped routers.
- Replace `require_admin` semantics: gate on **org role** (`owner`/`admin`) for the
  caller's org, not the global flag. `require_official` → "is a member of the org".
- `create_event` sets `org_id = caller's org`; auto‑adds creator `EventUser`.
- `list_events` → events where `org_id ∈ caller's orgs` (drop the admin‑sees‑all
  branch). Platform superadmin path is separate + audited.
- Routers to update (all under `/api/events`): events, guests, seating, menu,
  dashboard — swap their event lookups to `resolve_event`.
- `scanner` / `invite`: unchanged logic (token‑scoped to one event), but add a
  belt‑and‑braces check that the token's event still exists/active. No org auth
  (guest‑facing).

## 5. Signup / onboarding change

- First sign‑in today creates `User(role="official")` with no org. New flow:
  on first sign‑in, **create an Organization + owner Membership** for that user
  (org name defaults to their name/company; region/currency chosen in onboarding).
- Existing users are handled by the backfill (all land in the default org).
- Org admins invite teammates **into their org**; `EventUser` continues to grant
  per‑event staff scope within the org.

## 6. Isolation guarantees & tests

- **Automated tenant‑isolation tests** (must be green before launch): user in Org A
  gets 404 on Org B's event / guests / dashboard / scanner data; `list_events`
  never returns cross‑org events; create/update always stamps the caller's org.
- Consider Postgres **RLS** as defense‑in‑depth later (policy on `org_id`).
- Namespacing: cover‑image uploads under an org‑scoped path; rate limits per org.

## 7. Rollout (small, reversible deploys)

1. **D1:** add tables + nullable `org_id` + superadmin flag (no behavior change).
2. **D2:** backfill default org + memberships (idempotent); verify counts.
3. **D3:** switch access control to org‑scoped (`resolve_event`, list_events, role
   gates) + signup‑creates‑org. Ship isolation tests.
4. **D4:** set `events.org_id` NOT NULL once verified.

Each step is independently deployable via `./deploy.sh`; D3 is the behavioral cutover.

## 8. Risks & mitigations

- **Cross‑tenant leak if a route is missed** → centralize on `resolve_event`; grep
  for every `db.get(Event` / `select(Event)` and route them through it; isolation
  tests cover each router.
- **Backfill on live data** → idempotent, `IS NULL`‑guarded, dry‑run counts first;
  NOT NULL only after verification (D4).
- **Locking yourself out** → set `is_platform_superadmin` on the operator account in
  the same backfill; keep a separate, audited superadmin path.
- **Firebase = one identity pool across tenants** → fine for shared‑schema SaaS;
  identity ≠ tenant. A user could belong to multiple orgs (Membership is many‑to‑many).

## 9. Out of scope for Phase 1 (later phases)

Per‑event entitlements/caps, billing (Stripe/Paystack), message credits, white‑label,
subscriptions. Phase 1 is **isolation only** — no pricing behavior changes.

## 10. Pre‑implementation checklist

- [ ] Confirm role names (owner/admin/staff) and what each can do.
- [ ] Confirm operator (platform superadmin) account email(s).
- [ ] Confirm default‑org name for the backfill.
- [ ] Decide multi‑org membership now vs single‑org (recommended: allow many).
- [ ] Snapshot/backup prod DB before D2/D4 (the db‑backup container exists).
