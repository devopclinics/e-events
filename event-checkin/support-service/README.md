# Festio Support Service

`support-service` is the AI-drafting half of the organizer support system. It
does not host the chat UI or store conversations itself — that's a self-hosted
[Chatwoot](https://www.chatwoot.com/) deployment (its own Postgres/Redis, see
`docker-compose.yaml`/`docker-compose.prod.yaml`, subdomain `chat.festio.events`).
This service:

1. Issues a signed identity for the frontend widget (`GET /api/support/identify`),
   so Chatwoot's agent inbox shows the real organizer, not an anonymous visitor.
2. Receives a Chatwoot webhook whenever an organizer sends a message
   (`POST /api/support/webhooks/chatwoot`), drafts a reply with Gemini using
   the same content that powers the in-app Help guide, and either sends it
   directly to the organizer or posts it as a Chatwoot **private note** for
   a human to review, depending on the topic (see Guardrails below).

It is intentionally non-critical: if this service is down, Chatwoot's widget
and inbox keep working — agents just don't get an AI-drafted starting point.

## Runtime

Local compose:

```bash
docker compose up -d db backend chatwoot-db chatwoot-redis chatwoot chatwoot-sidekiq support-service proxy frontend
```

Production deploy:

```bash
./deploy.sh --no-cache
```

The deploy pipeline builds and pushes:

- `dclinics/events:support-${VERSION}`
- `dclinics/events:support-latest`

(Chatwoot itself is a vendor image, `chatwoot/chatwoot:latest-ce`, pulled directly — not built by `deploy.sh`.)

## Environment

Shared with the rest of the app (via `env_file: ./backend/.env`):

- `DATABASE_URL`, `REDIS_URL`, `FIREBASE_CREDENTIALS`, `SUPERADMIN_EMAILS`

Support/Chatwoot/Gemini-specific:

- `SUPPORT_AI_ENABLED=true` — kill-switch; set `false` to stop AI drafting instantly without a redeploy
- `SUPPORT_AI_AUTO_SEND=true` — send safe-topic replies directly to the organizer; set `false` to fall back to private-note-only (human reviews everything, no auto-send at all)
- `SUPPORT_AI_HOURLY_CAP=20` — per-org Gemini drafts/hour before we skip drafting (logged, not an error)
- `CHATWOOT_BASE_URL` — e.g. `https://chat.festio.events`
- `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_ID` — numeric IDs, from Chatwoot's UI after the inbox is created
- `CHATWOOT_API_ACCESS_TOKEN` — Agent Bot / Platform API token, minted in Chatwoot's UI
- `CHATWOOT_HMAC_SECRET` — per-inbox Identity Validation secret, from Chatwoot's UI (enables `identifier_hash` in `/identify`)
- `CHATWOOT_WEBHOOK_TOKEN` — a secret **we** generate; pasted into Chatwoot's webhook URL config as `?token=...`
- `GEMINI_API_KEY` — start on the free tier to prototype; switch to a paid key (same env var) before routing real organizer conversations through it long-term, since the free tier may use prompts for model training
- `GEMINI_MODEL=gemini-3.5-flash` (default)

## One-time Chatwoot bootstrap (manual — no infra-as-code path for this)

Chatwoot has no documented way to create its first admin account, inbox, or
tokens via env vars/API before it's running. After `chatwoot`/`chatwoot-sidekiq`
are up and `db:chatwoot_prepare` has run once:

1. Open Chatwoot's setup wizard, create the first admin (agent) account.
2. Create a **Website** inbox. Copy its `website_token` (goes into the
   frontend widget config) and enable **Identity Validation** to get
   `CHATWOOT_HMAC_SECRET`.
3. Create an Agent Bot (or Platform API) access token → `CHATWOOT_API_ACCESS_TOKEN`.
   Note the account/inbox numeric IDs shown in the URL → `CHATWOOT_ACCOUNT_ID`/`CHATWOOT_INBOX_ID`.
4. Settings → Integrations → Webhooks: add
   `https://<app-domain>/api/support/webhooks/chatwoot?token=<CHATWOOT_WEBHOOK_TOKEN>`
   (a random secret you generate) subscribed to **Message Created**.
5. Fill these into secrets/`.env`, redeploy `support-service`.

## Knowledge base

`app/knowledge_base.md` is generated — not hand-written — by
`scripts/build_knowledge_base.py`, which reads `frontend/src/guideContent.mjs`
(the same structured content behind the in-app Help guide and `/guide.html`)
and flattens it to markdown. Regenerate and commit it whenever guide content
changes:

```bash
docker run --rm -v "$(pwd):/work" -w /work node:20-alpine node support-service/scripts/build_knowledge_base.mjs
```

No vector DB / embeddings — the whole guide comfortably fits in a single
Gemini Flash prompt at this size, so it's stuffed into the system prompt in
full rather than retrieved piecemeal.

## Routes

- `GET /health`, `GET /api/support/health`
- `GET /api/support/identify` (Firebase-authenticated)
- `POST /api/support/webhooks/chatwoot?token=...` (Chatwoot → us; shared-secret authenticated, not Firebase)

## Guardrails

- **Gated topics never auto-send.** `GATED_KEYWORDS` in `app/main.py` (billing, payments, refunds, account deletion, password/security, legal) matches against the organizer's incoming message; a hit always routes to a private note for a human, regardless of `SUPPORT_AI_AUTO_SEND`. Everything else is sent directly, with a disclosure line (`🤖 Automated reply from Festio's AI assistant`) so organizers always know they're talking to a bot.
- **The model's own deferrals are also caught.** If the draft itself contains a phrase like "can't access your account" or "a teammate will follow up" (per `SYSTEM_PROMPT`'s instruction on account-specific questions), that's treated the same as a keyword hit — a good-faith deferral never gets auto-sent as a non-answer.
- The prompt only ever contains the Help-guide knowledge base + conversation transcript, never raw account/billing data — the gating above is what keeps auto-sent replies confined to topics the knowledge base can actually answer correctly.
- Per-org hourly cap on Gemini calls via the shared Redis, to bound cost/abuse risk.
- The webhook handler ignores `outgoing`/`private` messages, which is what stops our own posts from re-triggering another draft.
- Set `SUPPORT_AI_AUTO_SEND=false` to go back to reviewing every reply by hand — no code change needed.
