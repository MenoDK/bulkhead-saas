# 0001 — Tenant isolation in the database (RLS), not only in code

Status: Accepted

## Context

Every request belongs to exactly one tenant. The classic failure mode of multi-tenant systems is a single query that forgets
`WHERE tenant_id = ?`. A code review cannot prove the absence of that bug; the database can make it impossible.

## Decision

- Every tenant table has `tenant_id`, `ENABLE` **and `FORCE`** row level security, and one policy:
  `tenant_id = current_tenant()` for both `USING` and `WITH CHECK`.
- The application connects as `app_user`, an unprivileged role that owns nothing and has no `BYPASSRLS`. Migrations run as the
  schema owner over a different connection string.
- The tenant is taken from the **verified access token**, never from the request body, and is set per transaction with
  `set_config('app.tenant_id', $1, true)`. The `true` (transaction-local) matters: a pooled connection cannot leak the
  setting into the next request.
- `current_tenant()` returns `NULL` when the setting is absent, so a code path that forgets to set it sees **zero rows** (fails closed).
- Child tables use **composite foreign keys** `(parent_id, tenant_id)`, so a row cannot point at another tenant's parent even if the application is wrong.

## Rejected

- **Filter in the repository layer only.** One missed filter is a data breach, and nothing fails loudly.
- **Schema per tenant.** Good isolation, but migrations become N operations, connection pools and catalog bloat grow with tenants, and cross-tenant admin queries get hard.
- **Database per tenant.** Strongest isolation and a reasonable choice for a handful of large customers; operationally heavy for many small ones. The row-level model can be sharded later by `tenant_id`.
- **`FORCE` omitted.** Without it the table owner bypasses its own policies; with the migration role separate that would be survivable, but defence in depth costs one keyword.

## Consequences

- Every query inside a tenant context pays one `set_config` round trip (batched into the transaction).
- Tests must run against a real Postgres: the guarantee lives in the engine, so it is proven there (`test/tenancy.e2e-spec.ts`: another tenant's record answers 404 for GET/PATCH/DELETE, hand-written SQL as the runtime role sees nothing, and a pooled connection does not leak the tenant between requests).
- System tables that are intentionally cross-tenant (`outbox_events`, `webhook_events`, `refresh_tokens`, `rate_limits`) have **no** RLS, so their queries filter by tenant explicitly and each has a test.
