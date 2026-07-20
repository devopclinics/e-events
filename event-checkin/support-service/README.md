# Festio Support Service

`support-service` is the AI-drafting half of the organizer support system. It
does not host the chat UI or store conversations itself — that's a self-hosted
[Chatwoot](https://www.chatwoot.com/) deployment (its own Postgres/Redis, see
`docker-compose.yaml`/`docker-compose.prod.yaml`, subdomain `chat.festio.events`).
This service:

1. Issues a signed identity for the frontend widget (`GET /api/support/identify`),
   so Chatwoot's agent inbox shows the real organizer, not an anonymous visitor.
2. Validates and durably queues Chatwoot webhooks whenever an organizer sends a message
   (`POST /api/support/webhooks/chatwoot`), drafts a reply with Gemini using
   the same content that powers the in-app Help guide, and either sends it
   directly to the organizer or posts it as a Chatwoot **private note** for
   a human to review, depending on the topic (see Guardrails below).

It is intentionally non-critical: if this service is down, Chatwoot's widget
and inbox keep working — agents just don't get an AI-drafted starting point.

## Documentation map

- [`docs/STAGING_AUDIT.md`](docs/STAGING_AUDIT.md) — architecture, requirements traceability, audit findings, and remaining release gates.
- [`docs/AI_SUPPORT_PLAYBOOK.md`](docs/AI_SUPPORT_PLAYBOOK.md) — response policy, answer formats, escalation rules, and quality scorecard.
- [`docs/OPERATIONS_RUNBOOK.md`](docs/OPERATIONS_RUNBOOK.md) — staging deployment, health checks, incident response, DLQ recovery, monitoring, and rollback.
- [`docs/KNOWLEDGE_MAINTENANCE.md`](docs/KNOWLEDGE_MAINTENANCE.md) — sources of truth, authoring standard, regeneration, retrieval, and review workflow.
- [`docs/FESTIO_COMPLETE_FEATURE_GUIDE.md`](docs/FESTIO_COMPLETE_FEATURE_GUIDE.md) — role-based master path covering every documented Festio feature.
- [`app/support_policy.md`](app/support_policy.md) — curated grounding and safety rules loaded directly into AI context.

## Runtime

Local compose (API and worker):

```bash
docker compose up -d db redis backend chatwoot-db chatwoot-redis chatwoot chatwoot-sidekiq support-service support-worker proxy frontend
```

This implementation is currently being validated in staging. Production rollout is intentionally outside the scope of this documentation and requires the gates in `docs/STAGING_AUDIT.md`.

## Environment

Shared with the rest of the app (via `env_file: ./backend/.env`):

- `DATABASE_URL`, `REDIS_URL`, `FIREBASE_CREDENTIALS`, `SUPERADMIN_EMAILS`

Support/Chatwoot/LLM-specific:

- `SUPPORT_AI_ENABLED=true` — kill-switch; set `false` to stop AI drafting instantly without a redeploy
- `SUPPORT_AI_AUTO_SEND=false` — safe default: Gemini suggestions are private notes until explicitly enabled
- `SUPPORT_AI_AUTO_SEND_ORG_ALLOWLIST=""` — comma-separated org_key cohort (org_id, or contact email if org_id isn't set). Empty means no org gets auto-sent replies even with `SUPPORT_AI_AUTO_SEND=true` — add orgs here one at a time for a controlled rollout, per `docs/STAGING_AUDIT.md`'s cohort-gate recommendation.
- `SUPPORT_AI_GATING_ENABLED=true` — sensitive billing/account/security topics are always routed to a human
- `SUPPORT_RUN_WORKER=false` on the API and `true` on the separate worker deployment
- `SUPPORT_JOB_MAX_ATTEMPTS=3` — failed jobs are retried, then moved to the dead-letter list
- `SUPPORT_AI_GLOBAL_HOURLY_CAP=500` and `SUPPORT_AI_HOURLY_CAP=20` — global and per-organization quotas
- `SUPPORT_AI_GLOBAL_CONCURRENCY=4`, `SUPPORT_AI_ORG_CONCURRENCY=1` — distributed Redis-backed concurrency leases
- `SUPPORT_LOCAL_AI_ENABLED=false`, `SUPPORT_LOCAL_AI_SHADOW_MODE=true` — safe local-classifier rollout defaults
- `SUPPORT_LOCAL_AI_AUTO_REPLY=false` — local models cannot publish replies unless separately enabled
- `SUPPORT_LOCAL_AI_DRAFTING_ENABLED=false` — keep the local 3B model limited to classification/summarization
- `SUPPORT_LLM_PROVIDER=gemini` — remote drafting provider (`gemini` or `zai`)
- `GEMINI_MAX_OUTPUT_TOKENS=1400` — visible response budget; Gemini thinking is disabled in code
- `SUPPORT_AI_HOURLY_CAP=20` — per-org Gemini drafts/hour before we skip drafting (logged, not an error)
- `CHATWOOT_BASE_URL` — e.g. `https://chat.festio.events`
- `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_ID` — numeric IDs, from Chatwoot's UI after the inbox is created
- `CHATWOOT_API_ACCESS_TOKEN` — Agent Bot / Platform API token, minted in Chatwoot's UI
- `CHATWOOT_HMAC_SECRET` — per-inbox Identity Validation secret, from Chatwoot's UI (enables `identifier_hash` in `/identify`)
- `CHATWOOT_WEBHOOK_TOKEN` — a secret **we** generate; pasted into Chatwoot's webhook URL config as `?token=...`
- `GEMINI_API_KEY` — start on the free tier to prototype; switch to a paid key (same env var) before routing real organizer conversations through it long-term, since the free tier may use prompts for model training
- `GEMINI_MODEL=gemini-3.5-flash` (default)
- `ZAI_API_KEY` — required when `SUPPORT_LLM_PROVIDER=zai`
- `ZAI_BASE_URL=https://api.z.ai/api/paas/v4` (default)
- `ZAI_MODEL=glm-4.5-air` (default)

## One-time Chatwoot bootstrap

After `chatwoot`/`chatwoot-sidekiq` are up and `db:chatwoot_prepare` has run
once, provision the account/inbox/agent-bot/webhook with:

```bash
BOOTSTRAP_ADMIN_EMAIL=ops@festio.events \
BOOTSTRAP_WEBHOOK_BASE_URL=https://festio.events \
  ./scripts/bootstrap_chatwoot.sh
```

This runs `scripts/chatwoot_bootstrap.rb` inside the `chatwoot` deployment via
`rails runner`, then pushes the resulting `CHATWOOT_ACCOUNT_ID`,
`CHATWOOT_INBOX_ID`, `CHATWOOT_API_ACCESS_TOKEN`, `CHATWOOT_HMAC_SECRET`, and
`CHATWOOT_WEBHOOK_TOKEN` straight to SSM (same per-key convention as
`festio-infra/scripts/push-secrets-eso.sh`), so ESO syncs them into
`festio-secrets` without any manual copy-paste. It's idempotent — every step
finds-or-creates by a stable key, so re-running after a partial failure (or
to rotate the webhook token) doesn't create duplicate accounts/inboxes. Set
`PUSH_TO_SSM=false` to only print the values (e.g. for staging's Compose
`.env` instead of k8s/SSM). See the script header for the full env var list
(admin/account/inbox naming, widget website URL, password override).

Chatwoot's internal models aren't a stable public API across CE releases —
if `chatwoot_bootstrap.rb` raises on a fresh `chatwoot/chatwoot:latest-ce`
image, a column/association moved; diagnose with
`kubectl exec deploy/chatwoot -- bundle exec rails runner "puts Inbox.column_names"`
(etc.) and patch the script. The manual UI fallback, if you need it while
that's being fixed:

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

Either way, verify it actually took with:

```bash
python scripts/verify_chatwoot_bootstrap.py
```

This checks all five env vars are set, that `CHATWOOT_ACCOUNT_ID`/`CHATWOOT_INBOX_ID`
resolve against Chatwoot's own API with the configured token, and that a
webhook subscribed to `message_created` with our `CHATWOOT_WEBHOOK_TOKEN` is
actually registered on the account. Re-run after any Chatwoot-side change
(new token, webhook edit) to catch drift immediately instead of at the next
crash or silently-missing reply.

## Knowledge base

`app/knowledge_base.md` is generated — not hand-written — by
`scripts/build_knowledge_base.mjs`, which reads `frontend/src/guideContent.mjs`
(the same structured content behind the in-app Help guide and `/guide.html`)
and flattens it to markdown. Regenerate and commit it whenever guide content
changes:

```bash
docker run --rm -v "$(pwd):/work" -w /work node:20-alpine node support-service/scripts/build_knowledge_base.mjs
```

`app/support_policy.md` is maintained separately for contact-channel facts,
support boundaries, terminology, escalation rules, and response-quality policy.
The service combines it with the generated guide, splits the result by heading,
and sends only relevant sections to Gemini. No vector DB is currently used.

## Routes

- `GET /health`, `GET /api/support/health`
- `GET /metrics` (Prometheus exposition), `GET /api/support/metrics` (JSON operations view)
- `GET /api/support/identify` (Firebase-authenticated)
- `POST /api/support/webhooks/chatwoot?token=...` (Chatwoot → us; shared-secret authenticated, not Firebase)

## Guardrails

- Sensitive billing, payment, account-access, security, and legal messages are routed directly to a human before any model is called.
- The prompt contains selected Help-guide/support-policy sections and a minimized conversation transcript. Common email addresses, phone numbers, and secret assignments are redacted before remote-model use. This is data minimization, not a guarantee that arbitrary free text contains no personal data.
- Per-org hourly cap on Gemini calls via the shared Redis, to bound cost/abuse risk.
- Queue insertion and Chatwoot-message deduplication are one atomic Redis operation. Jobs use exponential retry delays, a dead-letter list, restart recovery, distributed concurrency leases, and a seven-day completion marker.
- The webhook handler ignores `outgoing`/`private` messages, which is what stops our own posts from re-triggering another draft.
- **Explicit "talk to a human" requests skip Gemini entirely.** `ESCALATION_PHRASES` in `app/main.py` ("live agent", "real person", "talk to a human", ...) matches against the incoming message; a hit sends a canned acknowledgment (no AI drafting — this isn't a product question) and sets the conversation's Chatwoot priority to **urgent** so a human notices it faster.
- Set `SUPPORT_AI_AUTO_SEND=false` to go back to reviewing every reply by hand — no code change needed.

## Local inference rollout

The `local-ai` Compose profile and Helm deployment run the official llama.cpp
server outside the API process. The configured `support-router-3b` model is
Llama 3.2 3B Instruct Q4_K_M; Compose reads it from the persistent `/models`
volume and Kubernetes downloads it once into its model PVC. Local inference is
performed only by queued workers, never in the webhook request path.

1. Start with `SUPPORT_LOCAL_AI_SHADOW_MODE=true` and compare metrics.
2. Keep `SUPPORT_LOCAL_AI_AUTO_REPLY=false` while agents review suggestions.
3. Disable shadow mode only after the evaluation dataset shows zero sensitive-topic false negatives.
4. Enable private-note drafts before considering any auto-reply capability.
5. Enable `SUPPORT_AI_AUTO_SEND` only for a controlled organization cohort.

Run the deterministic release gate with `python scripts/evaluate.py`. The
anonymized dataset lives in `evaluation/questions.jsonl`; any sensitive false
negative makes the command fail.

Run the non-destructive live staging checks from the worker container:

```bash
docker compose exec support-worker python scripts/staging_smoke.py
```

This uses isolated smoke keys, validates Redis deduplication/concurrency, and
calls the local classifier without enqueueing a Chatwoot job.

Dead-letter jobs are stored in Redis list `support:ai:dead`. Inspect and replay
them only after correcting the provider or payload failure; the original
message and completion keys continue to prevent duplicate public replies.

```bash
docker compose exec support-worker python scripts/dead_letter.py list
docker compose exec support-worker python scripts/dead_letter.py replay --job-id <job-id>
```

## Staging observability

Start the staging dashboard and alert rules with:

```bash
docker compose --profile support-observability up -d support-prometheus support-alertmanager support-grafana
```

Prometheus is available on port `9091`; Alertmanager is on port `9094`; Grafana is on port `3001`. Change
`SUPPORT_GRAFANA_PASSWORD` from its staging fallback. The provisioned dashboard
shows queue age/depth, dead letters, cache rate, routing/provider activity,
timeouts, retries, and failures. Alert rules cover dead letters, sustained
backlog, old jobs, and repeated local-model timeouts. Alert delivery currently
uses a local staging receiver until an external destination is configured.
