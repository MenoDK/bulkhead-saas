.PHONY: help env check api-check web-check e2e up up-e2e down logs smoke tamper e2e-browser transcripts screenshots clean

help: ## list targets
	@grep -E '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

# One recipe line on purpose: `exit 0` in a separate line only ends that line, and make would carry on to overwrite .env,
# which breaks a second `make up` because the database volume keeps the password of the first one.
env: ## create .env with fresh random secrets (never overwrites an existing file)
	@if [ -f .env ]; then echo ".env already exists; leaving it alone"; else \
	 cp .env.example .env; \
	 owner=$$(openssl rand -hex 16); app=$$(openssl rand -hex 16); \
	 sed -i \
	  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$owner|" \
	  -e "s|^APP_DB_PASSWORD=.*|APP_DB_PASSWORD=$$app|" \
	  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://app_user:$$app@localhost:5432/app|" \
	  -e "s|^MIGRATION_DATABASE_URL=.*|MIGRATION_DATABASE_URL=postgres://postgres:$$owner@localhost:5432/app|" \
	  -e "s|^JWT_SECRET=.*|JWT_SECRET=$$(openssl rand -hex 32)|" \
	  -e "s|^SECRETS_ENCRYPTION_KEY=.*|SECRETS_ENCRYPTION_KEY=$$(openssl rand -hex 32)|" \
	  -e "s|^AUDIT_EXPORT_SECRET=.*|AUDIT_EXPORT_SECRET=$$(openssl rand -hex 32)|" \
	  -e "s|^PAYMENT_WEBHOOK_SECRETS=.*|PAYMENT_WEBHOOK_SECRETS=$$(openssl rand -hex 24)|" \
	  -e "s|^METRICS_TOKEN=.*|METRICS_TOKEN=$$(openssl rand -hex 16)|" .env; \
	 chmod 600 .env; \
	 echo "wrote .env (mode 600) with new random secrets"; fi

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

up-e2e: env ## like `make up`, with sign-up limits raised for the browser tests (see docker-compose.e2e.yml)
	docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait

down: ## stop the stack (data volume is kept)
	docker compose down

logs: ## follow logs
	docker compose logs -f --tail=100

smoke: ## black-box check of a running stack
	./scripts/smoke.sh http://localhost:$${WEB_PORT:-8080}

tamper: ## edit the audit trail behind the application's back, in a throwaway workspace, and watch it be noticed
	./scripts/tamper-demo.sh http://localhost:$${WEB_PORT:-8080}

PLAYWRIGHT = docker run --rm --network host --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e E2E_BASE_URL=http://localhost:$${WEB_PORT:-8080} \
  $(PW_ARGS) -v "$$PWD/web":/work -w /work mcr.microsoft.com/playwright:v1.49.1-jammy sh -c

e2e-browser: ## browser tests (Playwright + axe, desktop and phone) against the running stack; start it with `make up-e2e`
	$(PLAYWRIGHT) '[ -d node_modules ] || npx --yes pnpm@9.15.0 install --frozen-lockfile; npx playwright test'

transcripts: ## re-record the guided tour on the landing page from the running stack
	node scripts/record-transcripts.mjs

# Only web/ is mounted for the tests, so the pictures need docs/img mounted as well.
screenshots: PW_ARGS = -v "$$PWD/docs/img":/shots -e SHOTS_DIR=/shots
screenshots: ## re-take the README pictures (docs/img) from the running stack
	$(PLAYWRIGHT) '[ -d node_modules ] || npx --yes pnpm@9.15.0 install --frozen-lockfile; SHOTS=1 npx playwright test shots.e2e.ts --project=desktop'

clean: ## stop and DELETE the data volume
	docker compose down -v
