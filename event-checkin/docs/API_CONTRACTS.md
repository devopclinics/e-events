# API contract pipeline (Phase 3)

Source of truth: the FastAPI backend's Pydantic schemas (`backend/app/schemas.py`).
Everything below is generated from them — nothing here should be hand-edited.

```
Pydantic schemas (backend/app/schemas.py)
       ↓  backend/scripts/export_openapi.py
docs/api-contract/openapi.json      (committed — 316 paths, 251 named schemas)
       ↓  frontend/scripts/generate-api-types.mjs
frontend/src/types/api.d.ts         (committed — one TS interface/type per schema)
```

## Why this shape, not a full TypeScript migration

The governing migration doc asks for "generated TypeScript request/response
types." This frontend is plain JS/JSX with no build-time TypeScript, and
converting ~19 already-shipped redesign pages plus the entire legacy app to
`.tsx` is a separate, large decision — not something to force through as a
side effect of adding contract types. Instead:

- `frontend/src/types/api.d.ts` is a plain ambient declarations file. It has
  no JS output and needs no build step or bundler change.
- Any `.js`/`.jsx` file can reference a type via JSDoc, with zero setup:
  ```js
  /** @type {import('../types/api').GuestOut[]} */
  const guests = await api.listGuests(eventId)
  ```
- `frontend/jsconfig.json` makes editors (VS Code, etc.) resolve those JSDoc
  types and offer real autocomplete/hover info against the real API shape,
  today, without converting a single file extension.
- `checkJs` is deliberately `false` repo-wide — turning on strict checking
  globally would surface a large number of pre-existing mismatches across
  code that predates this pipeline, all at once, which is disruptive rather
  than useful. A file can opt in individually with a `// @ts-check` comment
  at its top once its types are clean; that's the incremental adoption path,
  not a repo-wide flag flip.

## Scope

Only `components.schemas` (the 251 named request/response models) are
converted — not a full per-path request/response map keyed by method+URL.
Every `api.js` function's payload and return value is already one of these
named schemas, so this covers what `adaptX()` functions and call sites
actually consume. It does not (yet) generate a typed wrapper for `api.js`
itself, and it does not add runtime validation (Zod or similar) — both are
real gaps the phase's own text calls out ("use runtime schemas... where
the OpenAPI definition is incomplete"), left for a later, deliberately scoped
pass rather than bundled in here.

## Commands

```bash
# Regenerate the committed OpenAPI snapshot from the live backend container
docker exec -i event-checkin-backend-1 python - < backend/scripts/export_openapi.py \
  > docs/api-contract/openapi.json

# Regenerate frontend/src/types/api.d.ts from that snapshot
cd frontend && npm run generate:api-types
# (or directly: node scripts/generate-api-types.mjs)

# Drift gate — fails (exit 1) if either file is stale relative to the live
# backend; safe to run in CI, doesn't modify anything on failure
cd frontend && npm run check:api-contract
```

Run the drift gate before any deploy that touched `backend/app/schemas.py`.
If it fails, regenerate both files (commands above) and commit the results —
that diff *is* the API contract change, and should be reviewed as one.

## Known gap this doesn't close

`WEBHOOK_EVENT_TYPES` in `BillingRedesignPage.jsx` and similar hardcoded
option lists elsewhere are still manually kept in sync with backend enums
(e.g. `routers/webhooks.py:SUPPORTED_EVENT_TYPES`) — this pipeline gives you
the type to check against, but doesn't yet fail a build when a hardcoded
frontend list falls out of sync with it. A future step could add a small
lint rule or test asserting specific hardcoded arrays match their generated
enum type; not done here.
