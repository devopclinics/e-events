#!/usr/bin/env bash
set -euo pipefail

# Zero-downtime Compose rollout for Festio Live. Nginx is handed explicitly to
# a healthy one-off canary while Compose replaces both managed API replicas.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yaml}"
REGISTRY="${REGISTRY:-dclinics/events}"
VERSION="${1:-$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT_DIR") }"
PROJECT_NAME="${PROJECT_NAME// /}"
CANARY="${PROJECT_NAME}-engagement-rollout-$(date +%s)"
PROXY_UPSTREAM_FILE="${PROXY_UPSTREAM_FILE:-$ROOT_DIR/proxy-engagement-upstream.inc}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"
PROXY_DRAIN_SECONDS="${PROXY_DRAIN_SECONDS:-7}"
ROLLOUT_COMPLETE=false

compose() {
  APP_VERSION="$VERSION" EXPERIENCE_WORKFLOWS_ENABLED="${EXPERIENCE_WORKFLOWS_ENABLED:-true}" \
    docker compose -f "$COMPOSE_FILE" "$@"
}

wait_healthy() {
  local container_id="$1"
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    local state health
    state=$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id" 2>/dev/null || true)
    [[ "$state" == "running" && "$health" == "healthy" ]] && return 0
    [[ "$state" == "exited" || "$state" == "dead" ]] && break
    sleep 2
  done
  docker logs --tail=100 "$container_id" >&2 2>/dev/null || true
  return 1
}

route_proxy_to() {
  local hostname="$1"
  # Write in place: Docker bind mounts follow the original inode, so replacing
  # this file with an atomic rename would leave Nginx reading stale contents.
  printf 'set $engagement_upstream http://%s:8060;\n' "$hostname" > "$PROXY_UPSTREAM_FILE"
  compose exec -T proxy nginx -t >/dev/null
  compose exec -T proxy nginx -s reload >/dev/null
}

cleanup() {
  if $ROLLOUT_COMPLETE; then
    docker rm -f "$CANARY" >/dev/null 2>&1 || true
  elif docker inspect "$CANARY" >/dev/null 2>&1; then
    echo "Rollout failed; Nginx remains routed to healthy canary $CANARY" >&2
  fi
}
trap cleanup EXIT INT TERM

echo "Pulling Festio Live image ${REGISTRY}:engagement-${VERSION}"
compose pull engagement-service engagement-worker

echo "Starting and verifying rollout canary"
compose run -d --no-deps --name "$CANARY" engagement-service >/dev/null
wait_healthy "$CANARY" || { echo "Canary failed health checks; rollout aborted" >&2; exit 1; }

echo "Routing new Festio Live requests exclusively to the canary"
route_proxy_to "$CANARY"
sleep "$PROXY_DRAIN_SECONDS"

echo "Replacing the two managed API replicas"
force_args=()
[[ "${FORCE_RECREATE:-false}" == "true" ]] && force_args+=(--force-recreate)
compose up -d --no-deps --scale engagement-service=2 --wait "${force_args[@]}" engagement-service

mapfile -t api_ids < <(compose ps -q engagement-service)
[[ ${#api_ids[@]} -eq 2 ]] || { echo "Expected two managed API replicas; found ${#api_ids[@]}" >&2; exit 1; }
for container_id in "${api_ids[@]}"; do
  wait_healthy "$container_id" || { echo "Managed API replica failed health checks" >&2; exit 1; }
done

echo "Routing Festio Live back to the healthy managed replicas"
route_proxy_to engagement-service
sleep "$PROXY_DRAIN_SECONDS"

echo "Updating the background worker after API capacity is restored"
compose up -d --no-deps --wait engagement-worker

ROLLOUT_COMPLETE=true
echo "Festio Live ${VERSION} rollout completed with two healthy API replicas"
