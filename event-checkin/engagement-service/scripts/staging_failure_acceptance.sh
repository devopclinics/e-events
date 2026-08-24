#!/usr/bin/env bash
set -euo pipefail

# Run on the staging Compose host. Stops the complete, isolated Festio Live
# stack, verifies core public surfaces remain reachable, then always restores
# the dedicated dependencies, two API replicas, and worker.
COMPOSE_FILE="${1:-docker-compose.prod.yaml}"
BASE_URL="${STAGING_BASE_URL:-https://staging.festio.events}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_VERSION="${RELEASE_VERSION:-$(tr -d '[:space:]' < "$SCRIPT_DIR/../../VERSION")}"

restore() {
  APP_VERSION="$RELEASE_VERSION" docker compose -f "$COMPOSE_FILE" up -d --wait engagement-db engagement-redis
  APP_VERSION="$RELEASE_VERSION" docker compose -f "$COMPOSE_FILE" up -d --no-deps --scale engagement-service=2 --wait engagement-service engagement-worker
}
trap restore EXIT

APP_VERSION="$RELEASE_VERSION" docker compose -f "$COMPOSE_FILE" stop engagement-service engagement-worker engagement-db engagement-redis

core_paths=(
  / /login /events /check-in /messages /rsvp/qa-isolation-token
  /scan/qa-isolation-token /scan/qa-isolation-token/hub
  /guests-redesign /scanner-redesign /seating-redesign /festiome/guest
  /api/health /api/events
)
if [[ -n "${CORE_ACCEPTANCE_PATHS:-}" ]]; then
  read -r -a extra_paths <<< "$CORE_ACCEPTANCE_PATHS"
  core_paths+=("${extra_paths[@]}")
fi

for path in "${core_paths[@]}"; do
  status=$(curl -L -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL$path")
  case "$status" in 2*|3*|401|403) ;; *) echo "Core path failed while Engagement was down: $path ($status)" >&2; exit 1;; esac
done

live_status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$BASE_URL/api/engagement/health" || true)
[[ "$live_status" =~ ^(000|502|503|504)$ ]] || { echo "Festio Live unexpectedly remained available while stopped: $live_status" >&2; exit 1; }

restore
trap - EXIT
for attempt in $(seq 1 30); do
  ready_status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$BASE_URL/api/engagement/health/ready" || true)
  [[ "$ready_status" == "200" ]] && break
  sleep 2
done
[[ "${ready_status:-000}" == "200" ]] || { echo "Festio Live did not recover after the isolation test" >&2; exit 1; }

echo "PASS: core staging surfaces remained reachable while Festio Live was stopped, and Festio Live recovered"
