# 0006 — Short access tokens, rotating refresh tokens, and where the SPA keeps them

Status: Accepted

## Context

A stolen credential is the realistic threat for a browser application: through XSS, a leaked log, or a shared machine.
The design has to limit how long a stolen access token is useful, notice when a refresh token has been copied, avoid
revealing which accounts exist, and keep a realtime socket from becoming a way to join another tenant's room.

## Decision

- Access token: HS256 JWT (algorithm pinned on verify), 10 minutes, carries `sub`, `tid`, `role`. Roles are re-read from the membership on refresh, so a demotion takes effect within one token lifetime.
- Refresh token: random, stored **hashed**, single use. Each refresh issues a new one in the same _family_. Presenting a token that was already used revokes the whole family (theft detection). The claim is serialised with `SELECT … FOR UPDATE`, so two concurrent rotations cannot both succeed (a test forces the overlap, and a mutant removes the lock).
- Passwords: scrypt (N = 2^15). Login for an unknown e-mail verifies against a dummy hash so response time does not reveal which accounts exist. Auth endpoints are rate-limited per IP and per (e-mail, IP) in the database.
- Sockets: the tenant room is derived from the verified token at connect time; there is no "join" message, so a client cannot ask for another tenant's room; the server disconnects when the token expires and the client refreshes and reconnects.
- In the browser, the access token lives **in memory** and the refresh token in `sessionStorage` (cleared when the tab closes). A strict CSP (no inline script, no third-party origins) is the main defence against XSS reading it. The client refreshes with a **single in-flight promise**: refresh tokens rotate, so two parallel refreshes would look exactly like token reuse and revoke the session. This is covered by a test.

## Rejected alternatives

- **`localStorage` for tokens.** Survives forever and is readable by any script.
- **Long-lived access tokens.** A stolen one would stay useful for days; ten minutes bounds the damage.
- **Opaque server-side sessions looked up on every request.** Simpler revocation, but a database read on every call; short signed tokens plus rotating refresh keep the hot path stateless while still allowing revocation by family.
- **An httpOnly, SameSite cookie behind a backend-for-frontend.** Better, because it removes the token from JavaScript entirely, and the first thing to change for a real product. Left out to keep the reference small.

## Consequences

A copied refresh token is detected on its second use, not prevented; the family is then revoked and the user signs in again.
The in-memory access token is lost on reload and recovered through the refresh token, which costs one extra request.
