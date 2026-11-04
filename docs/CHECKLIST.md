# Master checklist

_What_ and _when_. The _how_ lives in the code and tests, the _why_ in the [ADRs](adr/README.md).

| #   | Item                                                                  | Status  | Evidence                                                                                                              |
| --- | --------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Tenant isolation by row-level security, runtime role cannot bypass it | done    | [ADR 0001](adr/0001-tenant-isolation-with-row-level-security.md), `test/tenancy.e2e-spec.ts`                          |
| 2   | Hash-chained audit trail per tenant                                   | done    | [ADR 0002](adr/0002-hash-chained-audit-trail.md), `test/audit.e2e-spec.ts`                                            |
| 3   | Idempotency in the same transaction                                   | done    | [ADR 0003](adr/0003-idempotency-keys-in-the-same-transaction.md), `test/idempotency.e2e-spec.ts`                      |
| 4   | Transactional outbox, signed webhooks, SSRF guard                     | done    | [ADR 0004](adr/0004-transactional-outbox.md), `test/outbox.e2e-spec.ts`, `test/webhooks.e2e-spec.ts`                  |
| 5   | Money as integer minor units                                          | done    | [ADR 0005](adr/0005-money-as-integer-minor-units.md), `test/billing.e2e-spec.ts`                                      |
| 6   | Session model with refresh-token reuse detection                      | done    | [ADR 0006](adr/0006-session-model.md), `test/auth.e2e-spec.ts`                                                        |
| 7   | React app with five niche themes, WCAG-tested                         | done    | [ADR 0008](adr/0008-front-end-theming-and-delivery.md), `web/e2e/niches.e2e.ts`                                       |
| 8   | Containers, compose stack, smoke test                                 | done    | `docker-compose.yml`, `scripts/smoke.sh`                                                                              |
| 9   | Mutation proof of the critical invariants                             | done    | `scripts/sabotage.sh`, 7 of 7 killed                                                                                  |
| 10  | CI workflow                                                           | written | `.github/workflows/ci.yml`: linted with actionlint, every step run locally; first run on GitHub not yet read          |
| 11  | httpOnly-cookie BFF for the refresh token                             | todo    | noted as the stronger option in [ADR 0006](adr/0006-session-model.md)                                                 |
| 12  | Landing page and lab, served at the root, console under `/app/`       | done    | [ADR 0009](adr/0009-landing-and-lab-at-the-root-console-under-app.md), `web/e2e/landing.e2e.ts`, `web/e2e/lab.e2e.ts` |
| 13  | Answers on the landing page recorded from the running stack           | done    | `scripts/record-transcripts.mjs --check`, `scripts/tamper-demo.sh`                                                    |
| 14  | Landing page and sign-in in 14 languages, right-to-left included      | done    | `site/i18n/`, `web/e2e/i18n.e2e.ts`                                                                                   |
| 15  | Native-speaker review of the thirteen translations                    | todo    | written for this project; Hindi, Bengali, Urdu and Arabic first                                                       |

Status is one of `todo`, `doing`, `done`, `written` (exists, not yet exercised where it will run), `dropped`.
