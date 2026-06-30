#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Build, push, prune old tags, then redeploy from Docker Hub
#
# Usage:
#   ./deploy.sh              # build & deploy current VERSION
#   ./deploy.sh --no-cache   # force rebuild without layer cache
#   ./deploy.sh --push-only  # skip deploy; just build + push + prune
#   ./deploy.sh --deploy-only # skip build; just pull & restart services
#
# Credentials are read from .env in the same directory as this script.
# Copy .env.example → .env and fill in your values before running.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[✓]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()  { echo -e "\n${BOLD}${CYAN}━━ $* ━━${NC}"; }
die()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── load .env ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a                        # auto-export every variable that gets set
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
  info "Loaded config from .env"
else
  warn ".env not found — falling back to environment variables already exported"
  warn "Copy .env.example → .env and fill in your values for a smoother workflow"
fi

# ── config ────────────────────────────────────────────────────────────────────
VERSION_FILE="${SCRIPT_DIR}/VERSION"
PROD_COMPOSE="${SCRIPT_DIR}/docker-compose.prod.yaml"
NAMESPACE="dclinics"
REPO="events"
REGISTRY="${NAMESPACE}/${REPO}"
KEEP_VERSIONS="${KEEP_VERSIONS:-3}"
NO_CACHE=""
DO_BUILD=true
DO_DEPLOY=true

# ── parse args ────────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --no-cache)    NO_CACHE="--no-cache" ;;
    --push-only)   DO_DEPLOY=false ;;
    --deploy-only) DO_BUILD=false ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) die "Unknown argument: $arg" ;;
  esac
done

# ── preflight checks ──────────────────────────────────────────────────────────
[[ -f "$VERSION_FILE" ]] || die "VERSION file not found at $VERSION_FILE"
VERSION=$(tr -d '[:space:]' < "$VERSION_FILE")
[[ -n "$VERSION" ]] || die "VERSION file is empty"

if $DO_BUILD; then
  [[ -n "${DOCKER_USERNAME:-}" ]] || die "DOCKER_USERNAME is not set. Export it before running."
  [[ -n "${DOCKER_PASSWORD:-}" ]] || die "DOCKER_PASSWORD (or access token) is not set. Export it before running."
  command -v docker  &>/dev/null || die "docker is not installed"
  command -v curl    &>/dev/null || die "curl is not installed"
  command -v jq      &>/dev/null || die "jq is not installed (brew install jq / apt install jq)"
fi

echo -e "\n${BOLD}EventQR Deployment Pipeline${NC}"
echo    "  Version  : ${VERSION}"
echo    "  Registry : ${REGISTRY}"
echo    "  Compose  : ${PROD_COMPOSE}"
echo    "  Services : backend, frontend, messaging"
echo    "  Keep tags: last ${KEEP_VERSIONS} per service"

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — Build images
# ─────────────────────────────────────────────────────────────────────────────
if $DO_BUILD; then
  step "1/6  Building images (version ${VERSION})"

  BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  BUILD_ARGS=(
    --build-arg "BUILD_DATE=${BUILD_DATE}"
    --build-arg "VERSION=${VERSION}"
    --label    "version=${VERSION}"
    --label    "build-date=${BUILD_DATE}"
    --label    "maintainer=devopclinics"
  )

  info "Building backend..."
  docker build $NO_CACHE \
    "${BUILD_ARGS[@]}" \
    --tag "${REGISTRY}:backend-${VERSION}" \
    --tag "${REGISTRY}:backend-latest" \
    "${SCRIPT_DIR}/backend"
  ok "Backend built → ${REGISTRY}:backend-${VERSION}"

  info "Building frontend..."
  # Load Firebase vars from frontend/.env if present
  FIREBASE_BUILD_ARGS=()
  FRONTEND_ENV="${SCRIPT_DIR}/frontend/.env"
  if [[ -f "$FRONTEND_ENV" ]]; then
    while IFS='=' read -r key value || [[ -n "$key" ]]; do
      [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
      FIREBASE_BUILD_ARGS+=(--build-arg "${key}=${value}")
    done < "$FRONTEND_ENV"
  fi
  docker build $NO_CACHE \
    "${BUILD_ARGS[@]}" \
    "${FIREBASE_BUILD_ARGS[@]}" \
    --tag "${REGISTRY}:frontend-${VERSION}" \
    --tag "${REGISTRY}:frontend-latest" \
    "${SCRIPT_DIR}/frontend"
  ok "Frontend built → ${REGISTRY}:frontend-${VERSION}"

  info "Building messaging-service..."
  docker build $NO_CACHE \
    "${BUILD_ARGS[@]}" \
    --tag "${REGISTRY}:messaging-${VERSION}" \
    --tag "${REGISTRY}:messaging-latest" \
    "${SCRIPT_DIR}/messaging-service"
  ok "Messaging service built → ${REGISTRY}:messaging-${VERSION}"

  # ── PHASE 2 — Push to Docker Hub ────────────────────────────────────────────
  step "2/6  Pushing images to Docker Hub"

  info "Authenticating with Docker Hub..."
  echo "${DOCKER_PASSWORD}" | docker login --username "${DOCKER_USERNAME}" --password-stdin
  ok "Logged in as ${DOCKER_USERNAME}"

  for tag in \
    "${REGISTRY}:backend-${VERSION}" \
    "${REGISTRY}:backend-latest" \
    "${REGISTRY}:frontend-${VERSION}" \
    "${REGISTRY}:frontend-latest" \
    "${REGISTRY}:messaging-${VERSION}" \
    "${REGISTRY}:messaging-latest"; do
    info "Pushing ${tag}..."
    docker push "$tag"
    ok "Pushed ${tag}"
  done

  # ── PHASE 3 — Prune old tags from Docker Hub ─────────────────────────────────
  step "3/6  Pruning old tags (keeping last ${KEEP_VERSIONS} per service)"

  info "Fetching Docker Hub auth token..."
  HUB_TOKEN=$(curl -sf -X POST "https://hub.docker.com/v2/users/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${DOCKER_USERNAME}\",\"password\":\"${DOCKER_PASSWORD}\"}" \
    | jq -r '.token')

  [[ -z "$HUB_TOKEN" || "$HUB_TOKEN" == "null" ]] && \
    die "Docker Hub login failed — check DOCKER_USERNAME / DOCKER_PASSWORD"

  prune_service_tags() {
    local service="$1"      # "backend" or "frontend"
    local prefix="${service}-"

    info "Fetching tags for '${service}'..."
    local page=1
    local all_tags="[]"

    # Walk pages (100 per page) to collect all matching tags
    while true; do
      local page_json
      page_json=$(curl -sf \
        "https://hub.docker.com/v2/repositories/${NAMESPACE}/${REPO}/tags/?page_size=100&page=${page}" \
        -H "Authorization: Bearer ${HUB_TOKEN}")

      local page_tags
      page_tags=$(echo "$page_json" | jq --arg p "$prefix" '
        [.results[] | select(.name | startswith($p)) | select(.name != ($p + "latest"))]
      ')

      all_tags=$(echo "${all_tags} ${page_tags}" | jq -s 'add')

      # Stop if no next page
      local next
      next=$(echo "$page_json" | jq -r '.next // empty')
      [[ -z "$next" ]] && break
      ((page++))
    done

    # Sort by last_updated descending; collect tags beyond KEEP_VERSIONS
    local to_delete
    to_delete=$(echo "$all_tags" | jq -r --argjson keep "$KEEP_VERSIONS" '
      sort_by(.last_updated) | reverse | .[$keep:] | .[].name
    ')

    if [[ -z "$to_delete" ]]; then
      ok "No old '${service}' tags to prune"
      return
    fi

    while IFS= read -r tag; do
      [[ -z "$tag" ]] && continue
      info "  Deleting ${REGISTRY}:${tag} ..."
      local http_code
      http_code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
        "https://hub.docker.com/v2/repositories/${NAMESPACE}/${REPO}/tags/${tag}/" \
        -H "Authorization: Bearer ${HUB_TOKEN}")

      case "$http_code" in
        204) ok  "  Deleted: ${tag}" ;;
        404) warn "  Not found (already gone?): ${tag}" ;;
        *)   warn "  Delete returned HTTP ${http_code} for: ${tag}" ;;
      esac
    done <<< "$to_delete"
  }

  prune_service_tags "backend"
  prune_service_tags "frontend"
  prune_service_tags "messaging"

  # Remove the dangling local build cache (optional, frees disk)
  info "Pruning dangling local image layers..."
  docker image prune -f --filter "label=maintainer=devopclinics" 2>/dev/null || true
fi  # end DO_BUILD

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 4 — Deploy via production docker-compose (pull from registry)
# ─────────────────────────────────────────────────────────────────────────────
if $DO_DEPLOY; then
  [[ -f "$PROD_COMPOSE" ]] || die "Production compose file not found: $PROD_COMPOSE"

  # ── Phase 4a — Pull new images ──────────────────────────────────────────────
  step "4/6  Pulling images from Docker Hub"
  APP_VERSION="$VERSION" docker compose -f "$PROD_COMPOSE" pull backend frontend messaging-service
  ok "Images pulled"

  # ── Phase 4b — Run DB migration in a one-off container ──────────────────────
  # Uses the NEW backend image against the LIVE database (same compose network,
  # same env_file). If schema apply or ORM verification fails, abort before
  # swapping production so the running stack keeps serving traffic.
  step "5/6  Running DB migration + schema verification"
  info "Ensuring db service is up..."
  APP_VERSION="$VERSION" docker compose -f "$PROD_COMPOSE" up -d db

  # DDL such as ALTER TABLE ... SET NOT NULL needs strong Postgres locks. If the
  # currently running backend is still serving requests, it can deadlock with the
  # one-off migration container. Stop only the live backend here; on failure we
  # start the same stopped container again instead of recreating production.
  info "Stopping live backend during schema migration to avoid database lock deadlocks..."
  APP_VERSION="$VERSION" docker compose -f "$PROD_COMPOSE" stop backend

  info "Applying schema patches via new backend image..."
  if ! APP_VERSION="$VERSION" docker compose -f "$PROD_COMPOSE" \
        run --rm --no-deps backend python -m app.db_migrate; then
    warn "Migration failed — restarting previously running backend container..."
    APP_VERSION="$VERSION" docker compose -f "$PROD_COMPOSE" start backend || true
    die "Migration failed — production NOT swapped. Inspect output above."
  fi
  ok "Migration applied and verified"

  # ── Phase 4c — Swap production containers ───────────────────────────────────
  step "6/6  Restarting services with new images"
  APP_VERSION="$VERSION" docker compose -f "$PROD_COMPOSE" up -d --remove-orphans
  # Nginx resolves Docker service names at startup. Restart the proxy after
  # frontend/backend swaps so it does not keep stale container IPs.
  APP_VERSION="$VERSION" docker compose -f "$PROD_COMPOSE" restart proxy
  ok "Services restarted"

  echo ""
  info "Running containers:"
  APP_VERSION="$VERSION" docker compose -f "$PROD_COMPOSE" ps
fi

echo -e "\n${GREEN}${BOLD}Deployment complete — version ${VERSION} is live.${NC}\n"
