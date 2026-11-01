# 0007 — Keyset pagination instead of OFFSET

Status: Accepted

## Context

Lists grow without bound, tenants differ wildly in size, and the interface is live: rows appear while someone is paging.
The pagination scheme has to cost the same on page one and page one thousand, and must not duplicate or skip rows when
the data moves underneath it.

## Decision

Lists are ordered by `(created_at DESC, id DESC)` with a composite index per tenant, and the cursor is an opaque, validated token holding the last row's `(created_at, id)`. The query is `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT n+1`.

- Invalid or tampered cursors return `400 INVALID_CURSOR`, not a database error.
- The audit log paginates on its identity column (`seq < $before`).
- The UI uses "Load more", which is also what a live, realtime list wants.

## Rejected alternatives

- **`OFFSET n`.** It reads and discards n rows, so deep pages get slower, and a row inserted between requests shifts every later page (duplicates or skips).
- **Numbered pages with a total count.** "Jump to page 40" needs `OFFSET`, and an exact total needs a full count on every request. Accepted trade-off: no random access and no total.

## Consequences

Cost is constant and stable under inserts. Clients cannot jump to an arbitrary page, and cursors are tied to the ordering in use.
