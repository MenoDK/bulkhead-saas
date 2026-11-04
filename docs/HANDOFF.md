# Handoff

Updated: 2026-11-04

Rewritten at the end of every session. A fresh session must be able to resume from disk alone.

## 1. What is live

Nothing is deployed. The compose stack runs locally: `web` on :8080 serves the landing page and the lab at `/` and the console at `/app/`;
`api`, a separate `worker` and `db` sit behind it. It passes the smoke test, the browser suite and the recorded-transcript check.

## 2. Where we stopped

Features, tests, delivery files, the landing page, the lab, 14 languages and the documentation are complete and verified locally (section 8).
The repository was pushed as a **private** repository. What is left is to read the first CI run on GitHub and to decide about making it public.

## 3. What the owner does now

1. Read the first run of `.github/workflows/ci.yml`. It was linted with actionlint and every step was run locally, but it could not run on GitHub before the push.
2. Have native speakers review the thirteen translations in `site/i18n/` (they were written for this project; Hindi, Bengali, Urdu and Arabic most of all).
3. Decide whether to make the repository public.

## 4. Deadlines

None.

## 5. What NOT to do

- Do not give `app_user` `BYPASSRLS` or superuser, and do not query tenant data outside `withTenant`: [ADR 0001](adr/0001-tenant-isolation-with-row-level-security.md).
- Do not assert only an HTTP status for money or validation errors; assert the error code.
- Do not treat `Promise.all` of N requests as proof of a race. Hold a transaction open to force the overlap.
- Do not edit an applied migration; add a new numbered one.
- Do not edit `site/transcripts.js` by hand. Change the behaviour, then run `make transcripts`; CI runs `--check`.
- Do not run the browser tests against a stack started with plain `make up`: a test run uses up the per-address rate limits. Use `make up-e2e`.
- Do not forget to rebuild the `web` image after a change in `site/`: the files are copied into the image at build time.

## 6. Decisions

- Isolation, audit, idempotency, outbox, money, sessions, pagination, theming: [ADR 0001](adr/0001-tenant-isolation-with-row-level-security.md) to [ADR 0008](adr/0008-front-end-theming-and-delivery.md).
- Landing page and lab at the root, console under `/app/`, image built from the repository root: [ADR 0009](adr/0009-landing-and-lab-at-the-root-console-under-app.md).

## 7. Learned, not in the code

- The stand-alone worker exited with code 0 because its poll timer was unref'd and no HTTP server kept Node alive; it now holds a ref'd keep-alive interval.
- The migrator re-asserts `NOBYPASSRLS` on every boot, so granting the role BYPASSRLS by hand is healed before any test runs. The mutant therefore lives in the migrator.
- The first mutation run had four survivors, and every one was a weak test, not a weak system.
- Running Playwright in a container as root leaves a root-owned `web/test-results`; run it with `--user "$(id -u):$(id -g)"`.
- `make env` used to overwrite an existing `.env`, so a second `make up` could no longer reach its own database. It is now one idempotent recipe, and CI runs it twice and compares.
- Two sentences on the landing page described answers the stack does not give. Recording the real output (`make transcripts`) found them; the page now prints what was recorded.
- The lab made its second workspace asynchronously, and a quick click on "Read it as B" went out with no token and answered `401`. Retaking a screenshot found it; the lab now waits for the workspace, a test forces the race, and that test was seen to fail before the fix.
- The Docker image for the web tier was built before the translations existed and answered 404 for them. After touching `site/`, rebuild with `make up-e2e` before trusting a browser run.
- The unit tests of the console had never been checked for formatting in CI, and one file was not formatted; `make check` is now the single gate.

## 8. Suite state

Measured on 2026-11-04: 127 API unit tests, 87 API end-to-end tests against Postgres, 209 web unit tests, 80 browser tests
(desktop and phone: landing page, lab, 14 languages, sign-up per niche, axe WCAG 2.1 AA; 13 more are screenshot jobs that run only with `make screenshots`),
the recorded-transcript check, the tamper demo (the edit is detected), the smoke test (10 steps) and 7 of 7 mutants killed. `hadolint` is clean on both
Dockerfiles at the warning level and `actionlint` is clean on the workflow.
