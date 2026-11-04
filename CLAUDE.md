# bulkhead-saas

A multi-tenant NestJS 11 API with a React front end, built so that the parts that fail in production (tenant isolation,
retries, concurrency, money, token theft) are real and tested against a real Postgres. TypeScript strict, pnpm.

## Start here

- Map of every document: [docs/00-READ-FIRST.md](docs/00-READ-FIRST.md). Open a document only when the map says to.
- Resuming work: `docs/HANDOFF.md` first; rewrite it before you stop.
- Commands and definition of done: @AGENTS.md

## Layout

- `src/modules/<name>/`: one folder per capability (identity, tenancy, resources, billing, outbox, webhooks, audit, idempotency, realtime).
- `db/migrations/`: numbered SQL, applied by `src/database/migrator.ts`, which also re-asserts the runtime role's attributes.
- `test/*.e2e-spec.ts`: real Postgres. `scripts/sabotage.sh`: breaks 7 invariants and requires the tests to go red.
- `web/`: React 19 + Vite console (served at `/app/`), five niche themes, its own tests (vitest, Playwright + axe).
- `site/`: the landing page and the lab, plain files with no build step, in 14 languages (`site/i18n/`). The answers printed on
  the landing page are recorded from the running stack (`make transcripts`); never edit `site/transcripts.js` by hand.

## Rules that apply to every task

1. **Tenant isolation lives in the database.** Tenant-scoped SQL runs inside `db.withTenant(...)` as the unprivileged
   `app_user`; never widen that role, never add `BYPASSRLS`. See ADR 0001.
2. **Money is integer minor units**, never a float; amounts cross the API as exact decimal strings. See ADR 0005.
3. **A concurrency invariant needs a test that forces the overlap** (hold a transaction open), plus a mutant in
   `scripts/sabotage.sh`. `Promise.all` of N requests does not prove a race happened.
4. **Assert the specific error code, not only the status.** A `CHECK` constraint also answers 422.
5. **No literal credentials.** Secrets come from the environment at run time; `.env` is git-ignored; tests build theirs.
6. **Docs are code.** A new document is added to the map in the same commit; `docsguard check` must pass.
7. **Browser tests need the e2e override** (`make up-e2e`), which lifts the per-address rate limits a test run would otherwise exhaust.

Advice versus enforcement: this file is advice. If `docsguard` is installed, `.claude/settings.json` turns the key
rules into hooks (destructive git, writes to secrets and to applied migrations are refused).
