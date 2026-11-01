# 0008 — Niche theming through tested tokens, same-origin delivery

Status: Accepted

## Context

The same application has to look and read right for five verticals (general, restaurant, legal, civic, wellness) without
five code bases, stay accessible in light and dark, and be delivered so that browser security headers cannot be silently lost.

## Decision

**Theming.** A niche is data, not a fork: a `NicheTheme` holds a light and a dark palette, radii, a font stack and **vocabulary** ("Menu item" vs "Case" vs "Proposal"). `ThemeProvider` writes CSS custom properties before first paint; components only use `var(--…)`.

**Accessibility is enforced by tests, not by taste:** for every niche × mode, 12 contrast pairs must meet WCAG AA (text 7:1, muted text and brand-on-surface 4.5:1). A palette change that breaks contrast fails CI (verified by mutation). Loading uses a splash with a **minimum presentation time** (so it never flashes), shimmer skeletons shaped like the real content (no layout jump), and everything respects `prefers-reduced-motion`.

**Delivery.** nginx serves the SPA and proxies `/api` and `/socket.io` to the API: one origin, so **no CORS** and the API port is never published. CSP is strict (`script-src 'self'`). Security headers are included in every `location` that sets its own `add_header`, because nginx silently drops inherited `add_header`s otherwise. Hashed assets are `immutable`; the HTML shell is `no-cache` so a deploy takes effect at once. `X-Forwarded-For` is **overwritten**, never appended, so a client cannot spoof its IP into the rate limiter.

**State.** Server state is in React Query; realtime events only **invalidate** query keys, they never write data into the cache, so the UI cannot drift from the server. Money is formatted from exact decimal strings (no float division).

## Rejected alternatives

- **A fork or build per niche.** Five code bases drift; a theme object is reviewed and tested in one place.
- **Accessibility by design review.** A reviewer misses a 4.4:1 pair; a test does not.
- **A separate API origin with CORS.** More headers to get wrong, and the API port would be published.
- **Writing realtime payloads into the cache.** Events can arrive out of order or be missed; invalidating and refetching cannot leave the UI wrong.

## Consequences

A new niche is a new theme entry plus its contrast cases. Cross-origin API consumers need their own gateway, because this delivery path is same-origin by design.
