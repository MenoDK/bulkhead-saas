.PHONY: help env check api-check web-check e2e up down logs smoke clean

help: ## list targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

env: ## create .env with fresh random secrets (never overwrites an existing file)
	@test ! -f .env || { echo ".env already exists; leaving it alone"; exit 0; }
	@cp .env.example .env
	@owner=$$(openssl rand -hex 16); app=$$(openssl rand -hex 16); \
	 sed -i \
	  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$owner|" \
	  -e "s|^APP_DB_PASSWORD=.*|APP_DB_PASSWORD=$$app|" \
	  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://app_user:$$app@localhost:5432/app|" \
	  -e "s|^MIGRATION_DATABASE_URL=.*|MIGRATION_DATABASE_URL=postgres://postgres:$$owner@localhost:5432/app|" \
	  -e "s|^JWT_SECRET=.*|JWT_SECRET=$$(openssl rand -hex 32)|" \
	  -e "s|^SECRETS_ENCRYPTION_KEY=.*|SECRETS_ENCRYPTION_KEY=$$(openssl rand -hex 32)|" \
	  -e "s|^AUDIT_EXPORT_SECRET=.*|AUDIT_EXPORT_SECRET=$$(openssl rand -hex 32)|" \
	  -e "s|^PAYMENT_WEBHOOK_SECRETS=.*|PAYMENT_WEBHOOK_SECRETS=$$(openssl rand -hex 24)|" \
	  -e "s|^METRICS_TOKEN=.*|METRICS_TOKEN=$$(openssl rand -hex 16)|" .env
	@chmod 600 .env
	@echo "wrote .env (mode 600) with new random secrets"

api-check: ## lint + typecheck + format + unit tests (backend)
	pnpm check

web-check: ## lint + typecheck + tests (frontend)
	cd web && pnpm check

check: api-check web-check ## everything that needs no database

e2e: ## end-to-end API tests against a real Postgres (set TEST_DATABASE_URL)
	@test -n "$$TEST_DATABASE_URL" || { echo "set TEST_DATABASE_URL, e.g. postgres://postgres:postgres@localhost:5432/app"; exit 1; }
	pnpm test:e2e

up: env ## build and start the whole stack on http://localhost:$${WEB_PORT:-8080}
	docker compose up -d --build --wait

down: ## stop the stack (data volume is kept)
	docker compose down

logs: ## follow logs
	docker compose logs -f --tail=100

smoke: ## black-box check of a running stack
	./scripts/smoke.sh http://localhost:$${WEB_PORT:-8080}

clean: ## stop and DELETE the data volume
	docker compose down -v
