# 0003 — Idempotency keys that commit with the work they protect

Status: Accepted

## Context

Clients retry. A retried "pay invoice" must not charge twice, whether the first attempt timed out, was double-clicked, or is still running.

## Decision

- Money-moving and creating endpoints require an `Idempotency-Key` header.
- Inside the **same transaction** as the business change: take `pg_advisory_xact_lock(hash(tenant, key))`, look the key up, compare a hash of the request, then either replay the stored response or run the work and store the response.
- Same key + different body → `422 IDEMPOTENCY_KEY_REUSED`. A replay returns the original status and body with `Idempotent-Replayed: true`.

## Rejected

- **Store the key in Redis / a separate call.** The key and the effect can then disagree after a crash: key stored but money not moved (lost payment) or the reverse (double payment). A shared transaction removes the window.
- **Unique constraint only.** Stops the second insert but cannot return the first response, and gives concurrent duplicates an error rather than a wait.
- **Client-side de-duplication only.** Cannot defend against a retry from a different tab or after a restart.

## Consequences

- Concurrent duplicates queue behind the lock instead of racing; the second returns the first's result.
- Keys expire (`expires_at` index) so the table does not grow without bound.
