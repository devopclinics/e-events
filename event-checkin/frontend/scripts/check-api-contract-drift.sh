#!/usr/bin/env bash
# Phase 3 (API contract pipeline) drift gate — run in CI, or manually before a
# release, to catch backend schema changes that were never reflected in the
# committed OpenAPI snapshot or generated frontend types. Exits non-zero (and
# prints a diff) if either is stale, without modifying the committed files.
# (This repo has no git history, so this compares against a temp copy rather
# than `git diff` — plain `diff`, not git, is the source of truth here.)
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
frontend_dir="${repo_dir}/frontend"
contract_path="${repo_dir}/docs/api-contract/openapi.json"
types_path="${frontend_dir}/src/types/api.d.ts"
node_bin=${NODE_BIN:-/home/dev/.vscode-remote-containers/bin/1b50d58d73426c9171299ec4037d01365d995b78/node}

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

echo "Exporting live OpenAPI document from the backend container..."
docker exec -i event-checkin-backend-1 python - < "${repo_dir}/backend/scripts/export_openapi.py" > "${tmp_dir}/openapi.json"

if ! diff -q "$contract_path" "${tmp_dir}/openapi.json" > /dev/null 2>&1; then
  echo "DRIFT: docs/api-contract/openapi.json is stale relative to the live backend." >&2
  diff -u "$contract_path" "${tmp_dir}/openapi.json" 2>&1 | head -60 >&2 || true
  echo "Run: docker exec -i event-checkin-backend-1 python - < backend/scripts/export_openapi.py > docs/api-contract/openapi.json" >&2
  exit 1
fi

echo "Regenerating frontend types from the committed contract..."
"$node_bin" "${frontend_dir}/scripts/generate-api-types.mjs" --out "${tmp_dir}/api.d.ts" > /dev/null
if ! diff -q "$types_path" "${tmp_dir}/api.d.ts" > /dev/null 2>&1; then
  echo "DRIFT: frontend/src/types/api.d.ts is stale relative to docs/api-contract/openapi.json." >&2
  diff -u "$types_path" "${tmp_dir}/api.d.ts" 2>&1 | head -60 >&2 || true
  echo "Run: node frontend/scripts/generate-api-types.mjs, then commit the result." >&2
  exit 1
fi

echo "API contract is up to date: ${contract_path} and ${types_path} both match the live backend."
