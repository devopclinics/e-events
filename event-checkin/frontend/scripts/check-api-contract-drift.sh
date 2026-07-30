#!/usr/bin/env bash
# Phase 3 (API contract pipeline) drift gate — run in CI, or manually before a
# release, to catch backend schema changes that were never reflected in the
# committed OpenAPI snapshot or generated frontend types. Exits non-zero (and
# prints a diff) if either is stale, without modifying the committed files.
# Plain `diff` is used so the gate also works in shallow CI checkouts.
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
frontend_dir="${repo_dir}/frontend"
contract_path="${repo_dir}/docs/api-contract/openapi.json"
types_path="${frontend_dir}/src/types/api.d.ts"
node_bin=${NODE_BIN:-node}
python_bin=${PYTHON_BIN:-python3}

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

if [[ "${CONTRACT_EXPORT_MODE:-auto}" != "local" ]] \
  && command -v docker >/dev/null 2>&1 \
  && docker inspect event-checkin-backend-1 >/dev/null 2>&1; then
  echo "Exporting OpenAPI document from the running backend container..."
  docker exec -i event-checkin-backend-1 python - < "${repo_dir}/backend/scripts/export_openapi.py" > "${tmp_dir}/openapi.json"
else
  echo "Exporting OpenAPI document from the local backend environment..."
  (
    cd "${repo_dir}/backend"
    PYTHONPATH=. "$python_bin" scripts/export_openapi.py
  ) > "${tmp_dir}/openapi.json"
fi

if ! diff -q "$contract_path" "${tmp_dir}/openapi.json" > /dev/null 2>&1; then
  echo "DRIFT: docs/api-contract/openapi.json is stale relative to the live backend." >&2
  diff -u "$contract_path" "${tmp_dir}/openapi.json" 2>&1 | head -60 >&2 || true
  echo "Regenerate the snapshot with backend/scripts/export_openapi.py, then regenerate frontend types." >&2
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
