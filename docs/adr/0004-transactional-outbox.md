# 0004 — Transactional outbox instead of calling webhooks inline

Status: Accepted

## Context

Tenants register webhook endpoints. Calling them from the request handler couples request latency to a stranger's server and can announce a change that then rolls back.

## Decision

- Business code writes an `outbox_events` row **in the same transaction** as the change. Nothing is announced unless the change committed.
- A worker claims due rows with `FOR UPDATE SKIP LOCKED` and a **lease** (`locked_until`), so N workers never deliver the same event twice at once and a crashed worker's rows become claimable again.
- Delivery is at-least-once, signed (`t=<ts>,v1=<hmac>`), carries a stable `X-Event-Id` for receiver-side de-duplication, retries with exponential backoff and ±20 % jitter (2 s base, 15 min cap), and ends in `dead` after a maximum number of attempts.
- Targets are checked against an **SSRF guard**: literal private IPs are rejected before connecting, hostnames are resolved through a guarded lookup, and redirects are not followed.
- Realtime (Socket.IO) pushes are emitted after commit, never inside the transaction.

## Rejected

- **Inline HTTP calls.** Slow, unreliable, announces rolled-back changes.
- **A message broker now.** Right at higher volume, wrong at the start: it adds a second system whose consistency with Postgres must be solved by... an outbox. The outbox is the step you take first and keep.
- **Exactly-once.** Not achievable over HTTP; the honest contract is at-least-once plus an idempotency key the receiver can use.

## Consequences

- Delivery latency is the poll interval (default 1 s). `LISTEN/NOTIFY` could cut it; not needed yet.
- The worker runs standalone (`dist/worker.js`) so API replicas stay request-only.
