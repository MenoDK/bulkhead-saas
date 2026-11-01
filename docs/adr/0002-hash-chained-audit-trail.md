# 0002 — A per-tenant hash-chained, append-only audit trail

Status: Accepted

## Context

"Who changed what" must survive a compromised application account, and an auditor must be able to check it without trusting us.

## Decision

- `audit_logs` rows are chained: `hash = SHA-256(canonical(entry) || prev_hash)`; the first entry of a tenant has `prev_hash = NULL`.
- Appends take a per-tenant `pg_advisory_xact_lock`, so two writers cannot both extend the same head.
- The schema backs the code: `UNIQUE NULLS NOT DISTINCT (tenant_id, prev_hash)` makes a **fork** impossible even if the lock is bypassed; triggers reject `UPDATE`, `DELETE` and `TRUNCATE`.
- `GET /audit/verify` walks the chain in batches and reports the first broken entry. `GET /audit/export` returns entries plus an HMAC-signed envelope (owner only) so a third party holding the key can check an export offline.
- The hash covers explicit fields (not "whatever the row object has"), so adding a column later cannot silently change old hashes.

## Rejected

- **Plain append-only table.** Stops casual edits, but a superuser edit is undetectable.
- **External ledger / blockchain.** Heavy infrastructure for a property the chain already gives within one trust boundary.
- **One global chain.** Serialises every tenant's writes behind one lock; per-tenant chains parallelise across tenants.

## Consequences

- Writes for a single tenant are serialised (one head). Fine for audit volume; a hot tenant would need batching.
- A privileged attacker can still delete the **whole tail**. Mitigation (not implemented): periodically publish the head hash somewhere the attacker cannot write.
