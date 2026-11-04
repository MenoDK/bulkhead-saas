# Agent contract

Tool-neutral: what any engineer or coding agent needs to work here without asking.

## Commands

| Task                                                             | Command                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Install                                                          | `pnpm install && (cd web && pnpm install)`                                         |
| Everything static (lint, types, format, unit tests, API and web) | `make check`                                                                       |
| API end-to-end, real Postgres                                    | `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:25433/app pnpm test:e2e` |
| Break invariants on purpose                                      | `TEST_DATABASE_URL=… scripts/sabotage.sh` (must end `survivors: 0`)                |
| Run the whole stack                                              | `make env && make up`, then `make smoke`                                           |
| Browser tests (landing, lab, 14 languages, console; axe)         | `make up-e2e && make e2e-browser` (the override lifts per-address rate limits)     |
| Landing-page answers still match the stack                       | `node scripts/record-transcripts.mjs --check` (`make transcripts` re-records)      |
| The audit chain notices an edit behind the application           | `scripts/tamper-demo.sh` (exits non-zero if the edit is not noticed)               |
| Documentation guards                                             | `docsguard check`                                                                  |

## Definition of done

1. A test covers it and fails without the change; for a concurrency or isolation invariant, a mutant dies without it.
2. `make check` and the e2e suite pass and you can quote their output.
3. An ADR exists for any decision a newcomer would have to reverse-engineer, with the rejected alternatives.
4. `docs/HANDOFF.md` carries the numbers that were printed, not the ones that were expected.

## Boundaries

- Applied migrations are immutable: change the schema with a new numbered migration.
- Do not weaken the runtime role (`app_user`) or add a code path that queries tenant data outside `withTenant`.
- Ask before adding a dependency, changing a public route or its error codes, or touching `scripts/sabotage.sh` expectations.
- Anything outside the task goes into `docs/CHECKLIST.md`, not into this change.

## Reporting

Say what happened, not what was expected. A failed test, a skipped check or an unverified claim goes in the report as it is.
