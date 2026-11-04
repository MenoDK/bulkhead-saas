# 0009 — Landing page and lab at the root, the console under `/app/`

Status: Accepted

## Context

A visitor who clones this repository should understand it in a minute and be able to attack it without reading code. The
console (the React SPA) answers "what would a customer see?", but not "what does it guarantee?". Two more things were
needed: a page that explains the project, and a **lab** whose buttons try to break each guarantee against the real stack
and show the real answer.

Both had to be delivered by the same nginx as the console, from the same origin, so the lab talks to the real API with no
CORS and no extra port, and the strict content security policy of [ADR 0008](0008-front-end-theming-and-delivery.md) does not
get a hole punched in it.

## Decision

- **Root belongs to the explanation.** `/` is the landing page and `/lab.html` is the lab, both plain static files with no
  build step and no framework. They share one small kit (`site/kit.js`, `site/kit.css`) that renders from two data objects:
  `window.SITE` (the copy) and `window.LAB` (the lab's behaviour).
- **The console moves to `/app/`.** Vite builds with `base: '/app/'` and the router uses the same `basename`. `/app` redirects
  to `/app/`; hashed assets stay `immutable`, the HTML shell stays `no-cache`.
- **No SPA fallback at the root.** An unknown path under `/` is a real 404; only `/app/` falls back to `index.html`.
- **The image is built from the repository root.** `web/Dockerfile` needs both `web/` and `site/`, so Compose sets
  `context: .` and the Dockerfile has its own allow-list ignore file (`web/Dockerfile.dockerignore`) so the context stays small and
  nothing outside the list (`.env`, tests, other directories) can reach an image layer.
- **The lab is honest.** Every button calls the real API. The transcripts on the landing page are _recorded_ from the running
  stack by `scripts/record-transcripts.mjs`, and `--check` fails CI when a recorded answer no longer matches reality.
- **Sign-up is real.** This is the one repository in the set with real accounts, so the lab signs the visitor up through the
  public registration route. The only thing the page remembers is the e-mail address, in `localStorage`; never a token.
- **Fourteen languages.** English lives in the kit. Thirteen overlays (`site/i18n/<code>.js`) hold text only and are loaded on
  demand; a missing key falls back to English, and the browser tests render every language, so a broken table fails the build. Arabic and Urdu are laid out
  right-to-left.

## Rejected alternatives

- **Put the landing page inside the React app.** It would make the explanation depend on the thing it explains, add weight to the
  console bundle, and tie the page's copy to React releases.
- **A second container (or port) for the lab.** Cross-origin calls need CORS or a proxy anyway, and a second published port is one more
  thing to get wrong. One front door is easier to reason about.
- **Keep the console at `/` and put the landing page at `/about`.** A visitor opens the root first; the first thing they see should
  be the explanation, not a sign-in form.
- **Mock the lab's answers.** A lab that cannot fail proves nothing. Showing the genuine `404`, `409` and `429` is the point, and
  it cost two corrections to the page's copy when the recorded output disagreed with what was written.
- **A UI framework or bundler for the landing page.** Static files can be read, audited and cached by anyone; the strict CSP needs no
  inline script at all.

## Consequences

- Old links to console routes at `/` stop working. They now live under `/app/`.
- The web image build is a little larger in scope (the root is the context), mitigated by the allow-list ignore file.
- The recorded transcripts are a test fixture: a behaviour change in the API has to be followed by `make transcripts`, which is
  exactly the intent.
- Browser tests (Playwright + axe) cover the landing page, the lab and all fourteen languages, in addition to the console.
