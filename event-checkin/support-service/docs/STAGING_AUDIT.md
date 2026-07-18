# Festio AI Support — Staging Architecture and Quality Audit

Audit date: 2026-07-18  
Scope: staging only; no production deployment or production-state changes  
Primary components: Chatwoot, FastAPI support API, Redis, support worker, llama.cpp local inference,
Gemini fallback, Prometheus, Grafana, and Alertmanager

## Executive assessment

The staging solution implements the intended durable queue and hybrid local/Gemini architecture.
It is operational and materially safer than the original synchronous design. Webhooks return quickly,
jobs survive ordinary worker failures, sensitive topics bypass models, and Chatwoot remains the system
of record.

The audit found several user-visible and security defects during live conversation testing. These were
fixed in staging: private-only replies while auto-send was enabled, incomplete model output, incorrect
retrieval for broad questions, use of stale transcript text instead of the webhook question, silent
deferrals, duplicate-question suppression after a private response, hallucinated answers for undocumented
contact details, raw organization identifiers in Redis keys, unprotected JSON metrics, personal data in
model-bound transcripts, and webhook secrets in access logs.

Current release posture: suitable for continued staging evaluation. It is not a recommendation to deploy
to production. Local classification remains in shadow mode because observed CPU latency is too high and
the evaluation dataset is still synthetic.

## Current request flow

1. Chatwoot sends a `message_created` webhook to FastAPI.
2. FastAPI authenticates the shared token, validates the event/message shape, applies deterministic safety
   rules, checks idempotency and quota, and atomically appends a job to Redis.
3. A separate worker claims the job into a worker-owned processing list and holds global, organization,
   and conversation concurrency leases.
4. Sensitive, explicit-human, and undocumented contact-detail requests use a deterministic human route.
5. Greetings use a canned reply. Acknowledgements are intentionally ignored.
6. Other questions are classified by local inference in shadow mode. Shadow output is measured but cannot
   influence retrieval, escalation, or the published response.
7. Relevant documentation sections are selected; an exact normalized answer cache is checked.
8. Gemini drafts the answer with thinking disabled. A completeness validator rejects fragments and retries
   once. Unsupported facts must defer rather than substitute unrelated documentation.
9. Safe answers are posted publicly with an automated-assistant disclosure. Deferrals post a private agent
   note, a public acknowledgement, and urgent escalation.
10. Failures retry with exponential delay. Final failure enters the dead-letter list and attempts a visible
    human-escalation acknowledgement.

## Requirements traceability

| Original phase | Status in staging | Audit note |
| --- | --- | --- |
| 1. Stabilize service | Implemented | Durable Redis queue, message idempotency, limits, retries, DLQ, leases, startup secret validation, fallback behavior. |
| 2. Deterministic routing | Implemented | Human, sensitive, greetings, acknowledgements, known FAQ, contact-detail, and unsupported routes. |
| 3. Local inference | Implemented in shadow mode | Separate llama.cpp service; structured routing and summarization. Local drafting is disabled after quality failures. |
| 4. FAQ retrieval/cache | Implemented, lexical | Versioned section retrieval and normalized exact cache. No vector/embedding similarity yet. |
| 5. Low-risk local drafts | Deliberately disabled | The 3B staging model produced truncated/weak answers. It remains a classifier only. |
| 6. Gemini optimization | Implemented | Relevant sections, compact transcript, local summary, cache, quotas, token/cost metrics, cheaper-model setting. |
| 7. Agent assist | Implemented | Private notes include answer, intent, confidence, sources, reason, provider, and summary. |
| 8. Observability | Implemented | Metrics, structured identifiers, dashboard, alerts, Prometheus, Grafana, Alertmanager. External alert delivery is not configured. |
| 9. Testing/evaluation | Partially complete | Unit tests and 30-item synthetic routing evaluation exist. Real anonymized correctness evaluation and browser E2E remain. |
| 10. Rollout | Staging shadow phase | Public Gemini replies are enabled in staging; local classification remains shadow-only. No cohort mechanism is implemented. |

## Findings corrected during the audit

### User experience and correctness

- Worker auto-send variables were missing, causing public questions to receive private notes only.
- The local 3B model was authoring public replies despite insufficient quality; local drafting is now disabled.
- Gemini reasoning consumed the visible token budget; thinking is disabled and the output limit increased.
- Fragments and broken Markdown could be published; completeness validation and one regeneration are enforced.
- The worker derived the latest question from a potentially stale transcript; it now uses the webhook message.
- Broad onboarding questions retrieved an advanced Experience section; onboarding retrieval is explicit.
- Shadow-mode classifier hints influenced responses; shadow output is now observation-only.
- Deferrals and exhausted retries could be silent; both now produce visible escalation acknowledgements.
- Repeated questions were suppressed even when the original answer was private; repeats now reuse cache and reply.
- Undocumented contact questions could retrieve unrelated Gift List content; these now route deterministically to humans.

### Privacy and security

- Per-organization rate-limit keys contained raw email fallback identifiers; keys now contain hashes.
- Remote-model transcripts could contain email, phone, or common secret fields; these are redacted first.
- The JSON operations endpoint was unauthenticated; it now requires a platform superadministrator.
- The webhook query token appeared in Uvicorn access logs; access logging is disabled for support API/worker.
- Organizer text is explicitly treated as untrusted and cannot override support policy or request hidden prompts/secrets.

### Reliability and operations

- Prometheus is connected to Alertmanager and the Grafana administrator account is no longer on its default password.
- Retry, dead-letter listing/replay, local timeout, Gemini fallback, transcript summary, and worker recovery paths were exercised.
- A synthetic Chatwoot conversation verified public reply delivery and zero unintended public replies in review mode.

## Remaining risks and recommended gates

### High priority before any production consideration

1. Build an anonymized evaluation set from approved real support questions. Synthetic routing accuracy alone does
   not measure answer correctness, retrieval quality, tone, or real sensitive-topic recall.
2. Add a browser-level Chatwoot widget test that creates a real incoming Website inbox message, waits for a reply,
   and asserts that the reply is visible to the visitor—not merely present as a private note.
3. Establish an agent review scorecard and require a statistically meaningful sample for factual correctness,
   completeness, escalation correctness, and complaint rate.
4. Rotate the webhook token because historical staging access logs contained it before access logging was disabled.
5. Confirm the remote-model data-processing terms appropriate for organizer conversations before real customer use.

### Medium priority

1. Local inference is frequently 20–30 seconds on current CPU resources and has produced inconsistent FAQ labels
   across repeated live smoke runs. Keep shadow mode enabled; either allocate suitable inference hardware, use a
   smaller classifier, or replace model routing with deterministic/embedding logic.
2. Retrieval is lexical. Add curated aliases or embeddings only after an evaluation demonstrates measurable benefit.
3. Attachment-only messages are not understood. Add a visible “please describe the attachment” response or a
   separately reviewed OCR/image pipeline before claiming attachment support.
4. Alertmanager currently stores alerts locally; configure a staging Slack/email/PagerDuty receiver and test delivery.
5. Chatwoot inbox/token/webhook bootstrap is manual and drift-prone. Add a verified configuration checklist or safe
   automation after confirming supported Chatwoot APIs.
6. Implement an organization cohort/allowlist before any gradual public auto-reply rollout outside staging.

### Low priority

- Split `main.py` into routing, queue, providers, Chatwoot, metrics, and policy modules for maintainability.
- Replace aggregate counters with histograms where latency percentiles are needed.
- Record explicit answer outcome labels (answered, escalated, deferred, failed-visible-fallback) per job.

## Audit acceptance criteria

A staging release is acceptable only when:

- all automated tests and the deterministic sensitive-topic gate pass;
- support API/local inference are healthy and worker queue/dead-letter depths are zero;
- duplicate delivery creates at most one response per Chatwoot message ID;
- every genuine question produces a public answer or visible escalation acknowledgement;
- sensitive/contact/account-specific questions never reach an answer-generating model;
- answers are grounded, complete, and contain no invented contact/account facts;
- local shadow output cannot affect public behavior;
- no message content, personal data, API tokens, or webhook secrets appear in application logs.
