#!/usr/bin/env bash
set -euo pipefail

# Standalone Festio Live deployment. It intentionally does not recreate the
# core backend, frontend, proxy, or any core worker/database.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yaml}"
REGISTRY="${REGISTRY:-dclinics/events}"
VERSION="${1:-$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")}"

docker build -t "$REGISTRY:engagement-$VERSION" "$ROOT_DIR/engagement-service"
if [[ "${PUSH_IMAGE:-true}" == "true" ]]; then
  docker push "$REGISTRY:engagement-$VERSION"
fi
APP_VERSION="$VERSION" docker compose -f "$COMPOSE_FILE" up -d --no-deps --scale engagement-service=2 --wait engagement-service engagement-worker

for attempt in $(seq 1 30); do
  mapfile -t service_ids < <(APP_VERSION="$VERSION" docker compose -f "$COMPOSE_FILE" ps -q engagement-service)
  healthy=0
  for container_id in "${service_ids[@]}"; do
    status=$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)
    image=$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true)
    [[ "$status" == "healthy" && "$image" == "$REGISTRY:engagement-$VERSION" ]] && healthy=$((healthy + 1))
  done
  [[ ${#service_ids[@]} -eq 2 && "$healthy" -eq 2 ]] && { echo "Festio Live $VERSION is healthy on two API replicas"; exit 0; }
  sleep 2
done
echo "Festio Live failed to become healthy" >&2
exit 1
