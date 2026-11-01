# 0005 — Money as integer minor units, guarded by the database

Status: Accepted

## Context

Money is where a rounding error or a double-spend becomes someone's real loss. Two properties are needed at once: arithmetic
that is exact, and invariants that survive a bug in the service layer (paid never exceeds total, refunds never exceed
what was paid) even when two payments arrive in the same millisecond.

## Decision

- Amounts are integers in minor units (`bigint` in Postgres, safe integers in TypeScript) with a per-currency exponent (USD 2, JPY 0, KWD 3). There are no floats anywhere; the API accepts decimal **strings** with a strict grammar and rejects `1e3`, `-1`, `1,5` and too many decimals.
- Invariants live in the schema as `CHECK`s: `0 ≤ paid ≤ total`, `0 ≤ refunded ≤ paid`. A bug in the service cannot persist an impossible state.
- Each money movement runs in a **savepoint**, and the balance check is part of the `UPDATE ... WHERE` (not read-then-write), so two concurrent payments cannot both pass the check.
- `UNIQUE (provider, provider_ref) WHERE provider_ref IS NOT NULL` makes a provider notification idempotent at the data level as well.
- Refunds above a threshold need an owner/admin (`refundNeedsApproval`, a pure function with boundary tests).

## Rejected alternatives

- **`numeric`/decimal strings in the app.** Correct, but every operation needs a decimal library; integers make overflow checks trivial (`Number.isSafeInteger` after each operation).
- **Floats.** `0.1 + 0.2`.
- **Read the balance, then write it.** Two concurrent payments both read the same balance and both pass; the check belongs in the `UPDATE`'s `WHERE`.
- **Application-level invariants only.** A `CHECK` also answers when the service is wrong, which is the case that matters. Note that the constraint is the backstop, not the message: the service rejects with a specific code (`EXCEEDS_BALANCE`) and the test asserts that code, because the `CHECK` alone would answer a generic 422.

## Consequences

Currencies must be listed explicitly. Cross-currency arithmetic is refused rather than guessed.
