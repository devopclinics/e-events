# Scoped seven-component image release

`release-engagement.yml` is a manual image-publication workflow, separate from
the unchanged general `release.yml`. It does not create Git tags, publish
`latest`, deploy services, or enable providers or automatic client messaging.

The seven versioned tags in the existing `dclinics/events` repository are:

- `backend-4.0.47`
- `frontend-4.0.47`
- `marketing-4.0.47`
- `dashboard-4.0.47`
- `support-4.0.47`
- `messaging-4.0.47`
- `setup-4.0.47`

## Preconditions and fail-closed checks

The reviewed full SHA must match the dispatch SHA, checkout, and fetched
`origin/main`. The requested numeric version must equal the committed
`event-checkin/VERSION`. A branch or tag dispatch is not sufficient.

Before registry login or image upload, the helper checks all six existing public
Firebase repository variables and both existing public support embed variables,
creates all seven sanitized contexts, and
requires the expected public Docker Hub repository plus an explicit,
component-specific tag-not-found response for every tag. Existing tags,
redirects, authorization failures, unknown 404 bodies, network errors, and
malformed responses block publication. Registry visibility and absence are
preflight observations, not an atomic lock against other publishers.

The frontend also requires `VITE_CHATWOOT_BASE_URL` (an HTTPS origin) and
`VITE_CHATWOOT_WEBSITE_TOKEN` (the public website embed identifier) from GitHub
Actions repository variables. An operator must verify that these identify the
existing authenticated support inbox, not the anonymous sales inbox, and that
its origin differs from the deployed Festio origin. Never put a Chatwoot API
token, HMAC secret, or another credential in either variable. Missing or invalid
values block publication instead of silently compiling support out of the app.
The preflight also runs the exact frontend configuration parser before registry
checks, avoiding Python/browser URL parsing differences (such as invalid IDNA).
Variable presence and inbox identity still require operator review; this
workflow does not retrieve, create, or change repository variables.

These values are compiled by Vite, not read from the running nginx container.
Providing them only as runtime environment variables cannot restore the widget.
Support still requires an authenticated organizer route, the existing runtime
`support_chat_enabled` switch, and signed support identity. Both sales-chat
gates remain hard-false; no support/sales fallback or identity bridge is added.

Contexts contain only allowlisted committed blobs. Dirty/untracked files,
dotenv/npmrc files, nested secret/credential files, Git metadata, generated
artifacts, and local dependencies are never copied. Selected symlinks,
non-regular Git modes, embedded credential patterns, missing required assets,
and unreviewed Dockerfile COPY/ADD inputs fail preparation. Required files are
not silently rewritten. These conservative checks do not prove arbitrary code
is secret-free; source review remains required.

Support's context explicitly includes both support-guidance Markdown files,
its seven existing scripts, and `evaluation/questions.jsonl`. Its documentation,
observability files, test fixtures, and unrelated assets are excluded.

## Runtime configuration remains separate

Backend, Support, Messaging, and Setup require their database configuration at
runtime rather than accepting embedded credentials. Dashboard requires only
the dedicated split read-only configuration:

- `DASHBOARD_DB_HOST`
- `DASHBOARD_DB_PORT`
- `DASHBOARD_DB_NAME`
- `DASHBOARD_DB_USER`
- `DASHBOARD_RO_DB_PASSWORD`

The verified existing runtime connection is `postgresql+asyncpg` to host `db`,
port `5432`, database `checkin`, as user `dashboard_ro`, using the existing
`DASHBOARD_RO_DB_PASSWORD`. These values must be supplied by deployment
configuration; the source does not add credential or endpoint defaults. The
user field is required and constrained to the existing `dashboard_ro` role,
not a configurable general-purpose database user. No explicit TLS options are
introduced; existing driver defaults remain unchanged.

Dashboard must not use a general `DATABASE_URL` fallback. The offline AST guard
requires a dedicated required `SecretStr` password, the required literal
`dashboard_ro` role, and the reviewed split-field `URL.create` engine
construction. Database grants, not the field names or this
workflow, enforce read-only access. This workflow neither creates/rotates
credentials nor changes database grants or deployment configuration.

All images carry source, reviewed revision, version, and component OCI labels.
The frontend retains hard-false sales-chat flags and public-configuration
provenance labels. Marketing retains its disabled outbound/scheduler image
defaults. Only the existing Docker Hub credential references are used; no
credential is placed in a context or build argument.

## Offline verification and recovery

Run the standard-library suite without network access or registry credentials:

```sh
python3 -m unittest discover -s .github/tests -p 'test_scoped_release.py' -v
```

The suite covers every component, negative configuration/path/mode/COPY cases,
mocked registry outcomes, exact workflow labels/tags, and preflight ordering.
It never builds or publishes an image. A local worktree test pass is not the
reviewed-main SHA/VERSION preflight.

The workflow always summarizes the outcome and available digest for all seven
image steps. A failure can leave partially published or uncertain results.
Inspect all seven tags before any retry; never overwrite an existing tag or
assume a failed upload did not execute. Publishing images does not establish
deployment success, Chatwoot compatibility, or runtime configuration readiness.

## Identity upgrade and deployment coordination

The backend and four API adapters require a literally verified email claim for
email-based account fallback or allowlist elevation. A different existing
Firebase UID is never overwritten. Correctly UID-linked normal login and
explicit stored administrator roles remain intact. Dashboard authorization
proof stays request-local and its database access remains SELECT-only.
Marketing also requires verified identity for human tokens and trusted CRM
email/profile/consent capture. Old human Marketing tokens need refreshing;
the narrowly identified backend service-token path is retained.

Deploy the backend and Marketing together before considering the outbox gate.
Unverified demo/signup requests remain separate pending claims, not permission
to edit an existing lead or send marketing. Historical account roles and lead
changes are not silently repaired or revoked by this release. There is no new
schema migration in these follow-up identity changes.

Backend prospect ingress/outbox, Marketing outbound/scheduling, and frontend
sales-chat gates remain OFF for this release. Existing unrelated guest-message
services are not activated or reconfigured by the code changes. Image
publication is not permission to enable these features.

Before rollout, verify the candidate images, existing runtime configuration,
read-only Dashboard connection, Marketing SQLite backup-copy migration, and
provider/browser compatibility. Keep the Marketing PVC preserved on failure;
do not blindly restart an older Marketing image that ignores the OFF gates or
an older API image with the unfixed identity checks. Deployment recovery belongs
to the reviewed infrastructure procedure, not this image-publication workflow.
