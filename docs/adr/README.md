# Architecture decision records

Each record states the problem, what was chosen, **what was rejected and why**, and the cost that was accepted.

| #                                                        | Decision                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| [0001](0001-tenant-isolation-with-row-level-security.md) | Tenant isolation in the database (RLS), not only in code                   |
| [0002](0002-hash-chained-audit-trail.md)                 | A per-tenant hash-chained, append-only audit trail                         |
| [0003](0003-idempotency-keys-in-the-same-transaction.md) | Idempotency keys that commit with the work they protect                    |
| [0004](0004-transactional-outbox.md)                     | Transactional outbox instead of calling webhooks inline                    |
| [0005](0005-money-as-integer-minor-units.md)             | Money as integer minor units, guarded by the database                      |
| [0006](0006-session-model.md)                            | Short access tokens, rotating refresh tokens, and where the SPA keeps them |
| [0007](0007-keyset-pagination.md)                        | Keyset pagination instead of OFFSET                                        |
| [0008](0008-front-end-theming-and-delivery.md)           | Niche theming through tested tokens, same-origin delivery                  |
