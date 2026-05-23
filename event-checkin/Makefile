# ─────────────────────────────────────────────────────────────────────────────
# EventQR — Build & Deploy Makefile
#
# Quick reference:
#   make deploy        Build, push, prune old tags, redeploy from Docker Hub
#   make build         Build images locally only
#   make push          Build + push (no deploy)
#   make pull-start    Pull latest from Docker Hub and start services
#   make up            Start with local docker-compose (dev mode)
#   make down          Stop all services
#   make logs          Follow logs from all services
#   make ps            Show running containers
#   make version       Print current version
#   make bump-patch    Increment patch (1.0.0 → 1.0.1) and tag git
#   make bump-minor    Increment minor (1.0.0 → 1.1.0) and tag git
#   make bump-major    Increment major (1.0.0 → 2.0.0) and tag git
# ─────────────────────────────────────────────────────────────────────────────

.DEFAULT_GOAL := help

VERSION       := $(shell cat VERSION | tr -d '[:space:]')
REGISTRY      := dclinics/events
PROD_COMPOSE  := docker-compose.prod.yaml
DEV_COMPOSE   := docker-compose.yaml

.PHONY: help deploy build push pull-start up down logs ps version \
        bump-patch bump-minor bump-major

help: ## Show this help
	@awk 'BEGIN{FS=":.*##"} /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-16s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "  Current version: \033[1m$(VERSION)\033[0m"

# ── Full pipeline ─────────────────────────────────────────────────────────────

deploy: ## Build → push → prune old tags → redeploy from Docker Hub
	@./deploy.sh

deploy-no-cache: ## Same as deploy but without Docker layer cache
	@./deploy.sh --no-cache

# ── Individual stages ─────────────────────────────────────────────────────────

build: ## Build images locally (no push)
	docker build --tag $(REGISTRY):backend-$(VERSION)  --tag $(REGISTRY):backend-latest  ./backend
	docker build --tag $(REGISTRY):frontend-$(VERSION) --tag $(REGISTRY):frontend-latest ./frontend
	@echo "Built $(REGISTRY):backend-$(VERSION) and $(REGISTRY):frontend-$(VERSION)"

push: ## Build + push to Docker Hub (no deploy)
	@./deploy.sh --push-only

pull-start: ## Pull latest images from Docker Hub and restart services
	@./deploy.sh --deploy-only

# ── Service management ────────────────────────────────────────────────────────

up: ## Start services in dev mode (local builds)
	docker compose -f $(DEV_COMPOSE) up -d

down: ## Stop all services (both dev and prod compose)
	-docker compose -f $(DEV_COMPOSE)  down 2>/dev/null
	-APP_VERSION=$(VERSION) docker compose -f $(PROD_COMPOSE) down 2>/dev/null

logs: ## Follow logs from production services
	APP_VERSION=$(VERSION) docker compose -f $(PROD_COMPOSE) logs -f --tail=100

logs-dev: ## Follow logs from dev services
	docker compose -f $(DEV_COMPOSE) logs -f --tail=100

ps: ## Show running containers
	@echo "=== Production ===" && \
	APP_VERSION=$(VERSION) docker compose -f $(PROD_COMPOSE) ps 2>/dev/null || true
	@echo "=== Dev ===" && \
	docker compose -f $(DEV_COMPOSE) ps 2>/dev/null || true

restart: ## Restart backend and frontend without rebuild
	APP_VERSION=$(VERSION) docker compose -f $(PROD_COMPOSE) restart backend frontend

# ── Version management ────────────────────────────────────────────────────────

version: ## Print current version
	@echo "$(VERSION)"

# Bump helpers — update VERSION, commit, and create a git tag
_bump:
	@echo "$(NEW_VERSION)" > VERSION
	@echo "Bumped to $(NEW_VERSION)"
	@git add VERSION && git commit -m "chore: bump version to $(NEW_VERSION)"
	@git tag "v$(NEW_VERSION)"
	@echo "Tagged v$(NEW_VERSION) — push with: git push && git push --tags"

bump-patch: ## Increment patch version (1.0.0 → 1.0.1)
	$(eval PARTS := $(subst ., ,$(VERSION)))
	$(eval MAJOR := $(word 1,$(PARTS)))
	$(eval MINOR := $(word 2,$(PARTS)))
	$(eval PATCH := $(word 3,$(PARTS)))
	$(eval NEW_VERSION := $(MAJOR).$(MINOR).$(shell echo $$(($(PATCH)+1))))
	@$(MAKE) _bump NEW_VERSION=$(NEW_VERSION)

bump-minor: ## Increment minor version (1.0.0 → 1.1.0)
	$(eval PARTS := $(subst ., ,$(VERSION)))
	$(eval MAJOR := $(word 1,$(PARTS)))
	$(eval MINOR := $(word 2,$(PARTS)))
	$(eval NEW_VERSION := $(MAJOR).$(shell echo $$(($(MINOR)+1))).0)
	@$(MAKE) _bump NEW_VERSION=$(NEW_VERSION)

bump-major: ## Increment major version (1.0.0 → 2.0.0)
	$(eval PARTS := $(subst ., ,$(VERSION)))
	$(eval MAJOR := $(word 1,$(PARTS)))
	$(eval NEW_VERSION := $(shell echo $$(($(MAJOR)+1))).0.0)
	@$(MAKE) _bump NEW_VERSION=$(NEW_VERSION)
