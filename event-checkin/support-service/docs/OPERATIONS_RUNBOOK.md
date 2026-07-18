# Festio AI Support — Staging Operations Runbook

## Service ownership

- Chatwoot owns conversations, contacts, inbox state, public messages, private notes, assignments, and priority.
- `support-service` owns organizer identity signing, webhook validation, deterministic routing, and enqueueing.
- `support-worker` owns classification, retrieval, drafting, Chatwoot postback, retries, and escalation.
- the application Redis owns queues, deduplication, cache, quotas, leases, completion markers, and counters.
- `local-ai` provides untrusted structured classification/summarization in shadow mode.
- Gemini provides grounded answer generation for staging public replies.

## Important Redis keys

| Key/prefix | Purpose | Typical retention |
| --- | --- | --- |
| `support:ai:jobs` | Ready queue | Until claimed |
| `support:ai:processing:<worker>` | Worker-owned in-flight jobs | Until completion/recovery |
| `support:ai:retry` | Delayed retries | Until scheduled time |
| `support:ai:dead` | Exhausted jobs | Manual review/replay |
| `support:message:<message_id>` | Webhook idempotency | 24 hours |
| `support:reply:done:<message_id>` | Completed-response marker | 7 days |
| `support:faq:<version>:<hash>` | Normalized answer cache | 24 hours |
| `support:concurrency:*` | Distributed leases | Lease duration |
| `support:ai:org:<hash>:<hour>` | Per-organization quota | 1 hour |
| `support:metrics:*` | Aggregate counters | Persistent until reset |

Never inspect or print raw job payloads during routine operations; they contain organizer message text.
Use `scripts/dead_letter.py list`, which intentionally emits only safe identifiers.

## Staging configuration policy

Required:

- `CHATWOOT_BASE_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_ID`;
- `CHATWOOT_API_ACCESS_TOKEN`, `CHATWOOT_HMAC_SECRET`, `CHATWOOT_WEBHOOK_TOKEN`;
- `GEMINI_API_KEY` when AI drafting is enabled;
- a strong `SUPPORT_GRAFANA_PASSWORD` in ignored `.env`.

Current safe staging posture:

- `SUPPORT_AI_GATING_ENABLED=true`;
- `SUPPORT_LOCAL_AI_ENABLED=true`;
- `SUPPORT_LOCAL_AI_SHADOW_MODE=true`;
- `SUPPORT_LOCAL_AI_DRAFTING_ENABLED=false`;
- `SUPPORT_AI_AUTO_SEND=true` for staging validation only;
- `SUPPORT_LOCAL_AI_AUTO_REPLY=true` has no effect while local drafting is disabled.

Do not copy staging auto-send settings to production. This runbook does not authorize a production deploy.

## Start/recreate staging services

```bash
docker compose --profile local-ai up -d local-ai support-service support-worker
docker compose --profile support-observability up -d \
  support-prometheus support-alertmanager support-grafana
```

After code/config changes, rebuild and recreate only the scoped staging services:

```bash
docker compose build support-service support-worker
docker compose up -d --no-deps --force-recreate support-service support-worker
```

Wait for `support-service` and `local-ai` health before sending a test webhook.

## Health and readiness checks

```bash
docker compose ps support-service support-worker local-ai \
  support-prometheus support-alertmanager support-grafana
curl -fsS http://127.0.0.1:9091/-/ready
curl -fsS http://127.0.0.1:9094/-/ready
curl -fsS http://127.0.0.1:3001/api/health
```

The support API health check verifies both PostgreSQL and Redis. The worker has no dedicated readiness endpoint;
confirm it is running, its heartbeat key exists, and queue age/depth are stable.

## Required pre-release validation

```bash
python scripts/evaluate.py
pytest tests -q
python scripts/staging_smoke.py
docker compose config -q
```

Also run an isolated Chatwoot test that verifies:

1. the webhook returns `queued` quickly;
2. one public response appears for a safe documented question;
3. no private-only result is mistaken for a visitor-visible answer;
4. an undocumented contact question receives public escalation acknowledgement;
5. a sensitive question invokes no generative model and marks the conversation urgent;
6. redelivering the same Chatwoot message ID creates no duplicate response.

## Failure triage

### Widget accepts messages but no response appears

1. Inspect the Chatwoot conversation and distinguish public outgoing messages from private notes.
2. Check queue, processing, retry, and dead-letter depths in Grafana/Prometheus.
3. Check worker logs using identifiers only; do not paste organizer message content into tickets.
4. Confirm `SUPPORT_AI_AUTO_SEND` is present in the worker environment, not only the API environment.
5. If the job exhausted retries, correct the dependency failure, replay it, and ensure a visible fallback was posted.
6. Check duplicate/completion keys for the exact Chatwoot message ID.

### Answer is truncated or malformed

- Confirm `GEMINI_MAX_OUTPUT_TOKENS=1400` reaches the worker.
- Confirm thinking budget is zero and the completeness guard is active.
- Remove the affected cache entry or change the knowledge version; malformed cached answers are rejected automatically.
- Keep local drafting disabled.

### Answer is unrelated or invented

- Identify the selected section and compare it with the latest webhook message.
- Add explicit support facts to `app/support_policy.md` when the fact is a stable business/support policy.
- Improve the source Help guide for product behavior; do not patch generated `knowledge_base.md` directly.
- Add the exact question and expected route/section/outcome to the evaluation dataset.
- Treat invented contact, billing, security, or account facts as a release blocker.

### Queue backlog or old job alert

- Verify Redis and worker health.
- Inspect local-model timeout rate; shadow classification must not block correctness, but it adds latency.
- Scale worker concurrency only within Gemini/local provider capacity and conversation-order constraints.
- Never delete queue/processing lists to clear an alert. Recover or replay jobs safely.

### Dead letters

```bash
docker compose exec support-worker python scripts/dead_letter.py list
docker compose exec support-worker python scripts/dead_letter.py replay --job-id <job-id>
```

Replay only after the cause is fixed. Completion/message keys protect against duplicate processing, but verify the
Chatwoot conversation before replaying any job that may already have a public response.

## Monitoring and alerts

- Prometheus: port `9091`.
- Grafana: port `3001`; credentials come from ignored staging environment.
- Alertmanager: port `9094`.
- Alerts: dead letters, sustained backlog, oldest-job age, and repeated local timeouts.

Alertmanager currently uses a local receiver. Configure and test an external staging destination before relying
on alerts for unattended operations.

## Secret and privacy handling

- `.env` and `backend/.env` are ignored and must never be committed or pasted into logs/reports.
- Rotate the webhook token after any access-log exposure. Uvicorn access logging is disabled because Chatwoot's
  shared token is in the configured webhook query string.
- Redis organization identifiers are hashes; do not change them back to raw emails.
- Model-bound transcripts redact common emails, phone numbers, and secret assignments. This is minimization, not
  a complete DLP system; never promise that arbitrary free text contains no personal data.
- Do not include raw organizer messages in structured logs, metrics labels, alerts, or dead-letter listings.

## Rollback

- To stop public AI replies while keeping agent assistance: set `SUPPORT_AI_AUTO_SEND=false` and recreate worker.
- To disable local inference: set `SUPPORT_LOCAL_AI_ENABLED=false` and recreate API/worker.
- To stop all drafting while preserving visible escalation behavior, set `SUPPORT_AI_ENABLED=false`; current webhook
  handling routes genuine questions to a human job rather than silently returning.
- Do not delete Chatwoot data or Redis queues as a rollback method.

