# Handoff

Updated: 2026-11-01

Rewritten at the end of every session. A fresh session must be able to resume from disk alone.

## 1. What is live

Nothing is deployed. The compose stack (`web` on :8080, `api`, a separate `worker`, `db`) runs locally and passes the smoke test.

## 2. Where we stopped

Features, tests, delivery files and documentation are complete and verified. What remains is the first commit and the push.

## 3. What the owner does now

Push to GitHub and enable Actions: the workflow in `.github/workflows/ci.yml` is linted but has never run there.

## 4. Deadlines

None.

## 5. What NOT to do

- Do not give `app_user` `BYPASSRLS` or superuser, and do not query tenant data outside `withTenant`: [ADR 0001](adr/0001-tenant-isolation-with-row-level-security.md).
- Do not assert only an HTTP status for money or validation errors; assert the error code.
- Do not treat `Promise.all` of N requests as proof of a race. Hold a transaction open to force the overlap.
- Do not edit an applied migration; add a new numbered one.

## 6. Decisions

- Isolation, audit, idempotency, outbox, money, sessions, pagination, theming: [ADR 0001](adr/0001-tenant-isolation-with-row-level-security.md) to [ADR 0008](adr/0008-front-end-theming-and-delivery.md).

## 7. Learned, not in the code

- The stand-alone worker exited with code 0 because its poll timer was unref'd and no HTTP server kept Node alive; it now holds a ref'd keep-alive interval.
- The migrator re-asserts `NOBYPASSRLS` on every boot, so granting the role BYPASSRLS by hand is healed before any test runs. The mutant therefore lives in the migrator.
- The first mutation run had four survivors, and every one was a weak test, not a weak system.
- Running Playwright in a container as root leaves a root-owned `web/test-results`; run it with `--user "$(id -u):$(id -g)"`.

## 8. Suite state

Measured on 2026-11-01: 127 API unit tests, 87 API end-to-end tests against Postgres, 209 web unit tests, 34 browser tests
(desktop and phone, axe WCAG 2.1 AA, plus the screenshot gallery), the smoke test (10 steps) and 7 of 7 mutants killed.
