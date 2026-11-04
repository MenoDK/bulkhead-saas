/* Content for the landing page and the lab. Everything the page says about behaviour is backed by a test; the output in
   the tour is recorded from the running stack (scripts/record-transcripts.mjs) and a test fails if it drifts. */
window.SITE = {
  name: 'bulkhead-saas',
  short: 'Bulkhead',
  title: 'bulkhead-saas · a multi-tenant SaaS where the database keeps tenants apart',
  logo: 'layers',
  repo: 'https://github.com/MenoDK/bulkhead-saas',
  accent: {
    light: { fill: '#3b9cf0', ink: '#0b5aa8', on: '#031a33', soft: '#dcecfc', onNavy: '#6cb6ff' },
    dark: { fill: '#5ab0f7', ink: '#9fd0ff', on: '#041a33', soft: '#10304f', onNavy: '#6cb6ff' },
  },
  loading: {
    context: 'Multi-tenant SaaS',
    title: 'Sealing the compartments',
    text: 'Checking the database, the migrations and the worker.',
    icon: 'layers',
    satellites: ['lock', 'database', 'hash'],
    foot: 'Local demo · API, worker, PostgreSQL and the console',
    sketch: 'M12 104C40 104 52 60 84 60S116 148 150 148 188 60 222 60 256 104 290 104 316 82 330 82',
  },
  lab: { href: 'lab.html', cta: 'Enter the lab', signin: 'Sign in' },
  auth: { header: null },

  hero: {
    eyebrow: 'Multi-tenant SaaS · isolation enforced by the database',
    lead: 'Many businesses, one database,',
    soft: 'and not one leak between them.',
    text: 'A backend and a web console for software that serves many separate businesses at once. The database itself refuses to show one tenant another’s rows, money moves exactly once even when requests race, webhooks leave through a signed outbox, and every change lands in an audit trail that notices when it is edited.',
    primary: { label: 'Open the lab', href: 'lab.html' },
    secondary: { label: 'See how it works', href: '#tour', icon: 'layers' },
    pilot: 'Runs on your laptop · API, worker, PostgreSQL and a console that re-themes for five kinds of business',
    proof: [
      { icon: 'shield', a: 'The database says no', b: 'row-level security, not an if in the code' },
      { icon: 'flask', a: 'Races are tested', b: 'twenty payments at once, exactly ten succeed' },
    ],
    top: ['BULKHEAD', 'Many tenants. One boundary.'],
    status: { icon: 'shield', small: 'Last verdict', strong: 'Workspace B asked for A’s invoice. Not found.' },
    art: `<svg viewBox="0 50 500 620" role="img" aria-label="A ship's hull cut open to show four sealed compartments labelled restaurant, legal, wellness and civic, each with a small icon. The wellness compartment is partly flooded but its neighbours are dry. Above the hull a block reads one database with row-level security, with a dashed line down into each compartment. Below, a card shows workspace B asking for workspace A's invoice and receiving 404 not found, the same answer as for an invoice that never existed.">
      <g class="a-line"><path d="M0 120H500M0 240H500M0 360H500M0 480H500M0 600H500M100 30V700M250 30V700M400 30V700"/></g>

      <text x="250" y="84" text-anchor="middle" class="a-text">ONE DATABASE</text>
      <rect x="40" y="96" width="420" height="58" rx="14" class="a-body"/>
      <text x="250" y="130" text-anchor="middle" class="a-text-s">FORCE ROW LEVEL SECURITY</text>
      <path d="M94 160V246M208 160V246M322 160V246M436 160V246" class="a-dash"/>
      <g class="a-accent"><circle cx="94" cy="202" r="5"/><circle cx="208" cy="202" r="5"/><circle cx="322" cy="202" r="5" class="pulse"/><circle cx="436" cy="202" r="5"/></g>

      <path d="M30 232H470V396C470 446 424 474 380 474H120C76 474 30 446 30 396Z" class="a-body"/>
      <path d="M30 232H470V396C470 446 424 474 380 474H120C76 474 30 446 30 396Z" class="a-line"/>

      <g>
        <rect x="46" y="250" width="96" height="192" rx="10" class="a-soft"/>
        <rect x="46" y="250" width="96" height="192" rx="10" class="a-line"/>
        <g transform="translate(94 330)" class="a-accent-s"><path d="M-12 -24v18M-17 -24v13M-7 -24v13M-12 -6v30"/><path d="M12 -24c7 5 7 17 0 22v26"/></g>
        <text x="94" y="426" text-anchor="middle" class="a-text-s">RESTAURANT</text>
      </g>
      <g>
        <rect x="160" y="250" width="96" height="192" rx="10" class="a-soft"/>
        <rect x="160" y="250" width="96" height="192" rx="10" class="a-line"/>
        <g transform="translate(208 330)" class="a-accent-s"><path d="M0 -26V24M-16 24H16M-24 -14H24"/><path d="M-24 -14l-9 19a10 5 0 0 0 18 0z"/><path d="M24 -14l-9 19a10 5 0 0 0 18 0z"/></g>
        <text x="208" y="426" text-anchor="middle" class="a-text-s">LEGAL</text>
      </g>
      <g>
        <rect x="274" y="250" width="96" height="192" rx="10" class="a-soft"/>
        <rect x="274" y="380" width="96" height="62" rx="0" class="a-soft"/>
        <rect x="274" y="250" width="96" height="192" rx="10" class="a-line"/>
        <g transform="translate(322 322)" class="a-accent-s"><path d="M-16 16C-16 -12 0 -24 18 -22 20 -2 8 18 -16 16Z"/><path d="M-16 16L8 -8"/></g>
        <path d="M274 380q12-10 24 0t24 0t24 0t24 0" class="a-accent-s"/>
        <text x="322" y="426" text-anchor="middle" class="a-text-s">WELLNESS</text>
      </g>
      <g>
        <rect x="388" y="250" width="96" height="192" rx="10" class="a-soft"/>
        <rect x="388" y="250" width="96" height="192" rx="10" class="a-line"/>
        <g transform="translate(436 330)" class="a-accent-s"><path d="M-16 24V-22H16V24M-22 24H22"/><path d="M-7 -10h4M5 -10h4M-7 2h4M5 2h4M-3 24V12h6v12"/></g>
        <text x="436" y="426" text-anchor="middle" class="a-text-s">CIVIC</text>
      </g>

      <rect x="40" y="500" width="420" height="128" rx="16" class="a-body"/>
      <path d="M40 534H460" class="a-line"/>
      <text x="58" y="522" class="a-text-s">REQUEST</text>
      <text x="58" y="558" class="a-text-s">GET /invoices/9f3c…  as workspace B</text>
      <text x="58" y="582" class="a-text-s">404 NOT_FOUND</text>
      <rect x="58" y="594" width="214" height="22" rx="11" class="a-line"/>
      <circle cx="70" cy="605" r="4" class="a-accent pulse"/>
      <text x="82" y="609" class="a-text-s">same as an invoice that never was</text>
      <text x="250" y="658" text-anchor="middle" class="a-text">EACH TENANT IN ITS OWN COMPARTMENT</text>
    </svg>`,
  },

  principles: {
    lead: ['Built so one bug', 'cannot sink every tenant.'],
    items: [
      ['shield', 'Isolates tenants'],
      ['hash', 'Chains the audit trail'],
      ['wave', 'Moves money once'],
      ['flask', 'Proven on PostgreSQL'],
    ],
  },

  tour: {
    eyebrow: 'A tour of the whole thing',
    title: ['Five things that go wrong', 'in a shared system.'],
    text: 'Pick a tab. The output below is recorded from the running stack with fictional data; a test fails if it ever stops being true.',
    tag: 'Recorded output',
    tabs: [
      {
        id: 'isolation',
        label: 'Isolation',
        icon: 'shield',
        title: 'Ask for someone else’s invoice.',
        text: 'Workspace B holds the id of A’s invoice and asks for it. The answer is the one it would get for an invoice that never existed. And a connection that forgot to say who it is sees nothing at all, because the database is the one saying no.',
        lab: 'lab.html#isolation',
        transcript: (window.TRANSCRIPTS || {}).isolation || '',
      },
      {
        id: 'money',
        label: 'Money',
        icon: 'wave',
        title: 'Pay a hundred dollars twenty times at once.',
        text: 'Twenty requests of ten dollars race for one hundred-dollar invoice. Exactly ten win and the rest are refused, because the invoice closed under them. The same payment sent ten times with one key is applied once.',
        lab: 'lab.html#money',
        transcript: (window.TRANSCRIPTS || {}).money || '',
      },
      {
        id: 'sessions',
        label: 'Sessions',
        icon: 'key',
        title: 'Steal a refresh token and use it second.',
        text: 'A refresh token works once. Replaying an old one is what a thief does, so the whole family of tokens is revoked, the owner’s included. Guessing passwords is cut off by a limit that does not care whether the guess was right.',
        lab: 'lab.html#sessions',
        transcript: (window.TRANSCRIPTS || {}).sessions || '',
      },
      {
        id: 'webhooks',
        label: 'Webhooks',
        icon: 'plug',
        title: 'Aim a webhook at the cloud’s own metadata.',
        text: 'A tenant gives you a URL and you will call it from inside your network. An address written as one integer is still 127.0.0.1. Each variant is refused at registration, and the check runs again when the worker delivers.',
        lab: 'lab.html#webhooks',
        transcript: (window.TRANSCRIPTS || {}).webhooks || '',
      },
      {
        id: 'audit',
        label: 'Audit',
        icon: 'hash',
        title: 'Edit the history behind the application’s back.',
        text: 'Every change is a row that signs the one before it, per tenant. An update is refused even to the schema’s owner; switch the guard off and edit anyway and verification names the row.',
        lab: 'lab.html#audit',
        transcript: (window.TRANSCRIPTS || {}).audit || '',
      },
    ],
    modulesTitle: 'Everything in the box.',
    modulesNote: 'Each one has tests on a real database and a place in the lab',
    modules: [
      ['shield', 'Tenant isolation', 'Row-level security with FORCE, fail-closed when no tenant is set, and composite foreign keys so a child row cannot point at another tenant’s parent.'],
      ['wave', 'Idempotent money', 'Keys commit in the same transaction as the work, behind an advisory lock. Amounts are integer cents guarded by CHECK constraints; refunds above a threshold need an admin.'],
      ['plug', 'Outbox and signed webhooks', 'Events are written with the change, claimed with SKIP LOCKED, delivered with backoff and dead letters, signed, and checked for SSRF twice.'],
      ['key', 'Sessions', 'Short access tokens, rotating refresh tokens with family revocation, timing-safe login and rate limits per address and per account.'],
      ['hash', 'Audit trail', 'Per tenant, hash-chained, append-only (a trigger refuses updates), with an export signed so it can be checked elsewhere.'],
      ['layers', 'A console for five businesses', 'One React app that re-themes by niche, vocabulary included, with loading states and contrast tested for every palette in light and dark.'],
    ],
    transparency: {
      strong: 'Honest about the demo.',
      text: 'Payments are modelled, not processed: there is no real payment provider, only a stub for the inbound webhook and its confirmation. The refresh token sits in sessionStorage, which the README says to replace with a cookie behind a backend-for-frontend. The limitations list is complete.',
    },
  },

  challenges: {
    eyebrow: 'The hard parts',
    title: ['Go on,', 'try to break out of your compartment.'],
    text: 'These are seven things that are easy to claim and hard to get right. Each has a recipe, what you should see, and a button that opens the lab on that exact tab.',
    items: [
      {
        label: 'Read their data',
        icon: 'shield',
        access: 'Lab · Isolation',
        title: 'Ask for another workspace’s record.',
        text: 'The most common SaaS breach is an id that was never checked.',
        steps: [
          'Sign in, then open <code>Isolation</code>. A second workspace is created for you.',
          'Press “Create a record in A”. Then press “Read it as A” and “Read it as B”.',
          'Press “Swap the tenant in A’s token” and “Use an unsigned token”.',
        ],
        expect: 'A reads it. B gets <code>404 NOT_FOUND</code>, the same as for an id that never existed, so nothing is confirmed. A token with another tenant swapped in, or one with no signature, is <code>401 INVALID_TOKEN</code>.',
        lab: 'lab.html#isolation',
      },
      {
        label: 'Pay twice',
        icon: 'wave',
        access: 'Lab · Money',
        title: 'Send one payment ten times at once.',
        text: 'Networks retry. Money must not.',
        steps: [
          'In <code>Money</code>, press “Create an invoice of 100.00”.',
          'Press “Send the same payment 10 times”.',
          'Then press “Reuse the key with another amount”.',
        ],
        expect: 'One payment is applied and the other nine are replays marked <code>Idempotent-Replayed: true</code>; the invoice is paid once. Reusing the key with a different body is <code>422 IDEMPOTENCY_KEY_REUSED</code>.',
        lab: 'lab.html#money',
      },
      {
        label: 'Overspend',
        icon: 'gauge',
        access: 'Lab · Money',
        title: 'Race twenty payments for a hundred dollars.',
        text: 'Each request alone looks fine.',
        steps: [
          'In <code>Money</code>, press “Create an invoice of 100.00”.',
          'Leave 20 payments of 10.00 and press “Pay all at once”.',
        ],
        expect: 'Exactly ten are <code>201</code> and ten are <code>409 INVOICE_NOT_OPEN</code>, because the tenth closes the invoice; the invoice ends at 100.00 paid, balance 0.00. A payment larger than what is left is <code>422 EXCEEDS_BALANCE</code>. The guard is in the same <code>UPDATE</code> that records the payment, not in a check before it.',
        lab: 'lab.html#money',
      },
      {
        label: 'Refund too much',
        icon: 'lock',
        access: 'Lab · Money',
        title: 'Refund 150.00 as a team member.',
        text: 'Money going out needs a second pair of eyes.',
        steps: [
          'In <code>Money</code>, press “Settle a 200.00 invoice”.',
          'Press “Refund 150.00 as a member”, then “Refund 50.00 as a member”, then “Refund 150.00 as the owner”.',
        ],
        expect: 'The first is <code>403 REFUND_NEEDS_APPROVAL</code>, the second is allowed because it is under the threshold, and the owner’s refund goes through. Refunding more than was paid is <code>422 EXCEEDS_PAID</code> for everyone.',
        lab: 'lab.html#money',
      },
      {
        label: 'Steal a session',
        icon: 'key',
        access: 'Lab · Sessions',
        title: 'Replay an old refresh token.',
        text: 'A token that works twice is a token a thief can share.',
        steps: [
          'In <code>Sessions</code>, press “Register a throwaway account”.',
          'Press “Rotate”, then “Replay the old token”, then “Use the newest token”.',
          'Press “Guess 12 passwords”.',
        ],
        expect: 'The replay is <code>401 INVALID_REFRESH_TOKEN</code> and so is the newest token: the whole family was revoked. The ten first guesses answer <code>401</code> and from the eleventh on it is <code>429 RATE_LIMITED</code>, even for the right password, with a number of seconds to wait.',
        lab: 'lab.html#sessions',
      },
      {
        label: 'Aim a webhook inward',
        icon: 'alert',
        access: 'Lab · Webhooks',
        title: 'Register a URL that points at your own network.',
        text: 'There are hundreds of ways to write 127.0.0.1.',
        steps: [
          'In <code>Webhooks</code>, press “Try all the targets”.',
          'Then press “Register 203.0.113.7”, “Create a record that fires an event” and “Show deliveries”.',
        ],
        expect: 'The metadata address, <code>2130706433</code>, <code>0x7f.1</code>, <code>[::1]</code>, <code>localhost</code>, a private address and credentials in the URL are all <code>400 UNSAFE_TARGET</code>; a name that does not resolve is <code>400 UNRESOLVABLE_TARGET</code>. The documentation address is accepted, and the separate worker records an attempt, a status and the error.',
        lab: 'lab.html#webhooks',
      },
      {
        label: 'Edit the history',
        icon: 'hash',
        access: 'Lab · Audit and a terminal',
        title: 'Change a row of the audit trail.',
        text: 'A trail you can edit quietly is decoration.',
        steps: [
          'In <code>Audit</code>, press “Verify” and read the chain.',
          'Run <code>scripts/tamper-demo.sh</code> in a terminal. It needs the database owner, which a browser does not have.',
          'Press “Verify” again for a workspace the script touched, or read the recorded run on the landing page.',
        ],
        expect: 'The update is refused by a trigger even to the owner. With the trigger switched off and a row edited, verification reports <code>valid: false</code> and the sequence number where the chain breaks.',
        lab: 'lab.html#audit',
      },
    ],
  },

  run: {
    eyebrow: 'Run it in a minute',
    title: ['One command.', 'A multi-tenant SaaS on localhost.'],
    text: 'You need Docker. There are no API keys and no accounts to create elsewhere: the first workspace you register is yours, and nothing leaves your machine.',
    steps: [
      ['terminal', 'Clone', 'git clone, then cd into the folder.'],
      ['play', 'Start', 'make up writes a .env with fresh random secrets, builds and starts everything, health-gated.'],
      ['globe', 'Open', 'http://localhost:8080 is this page. The console is at /app/.'],
      ['flask', 'Break it', 'Use the hard parts above, or run make smoke for a ten-step check of the stack.'],
    ],
    terminal: {
      title: 'bash',
      lines: [
        '# 1. get the code',
        'git clone https://github.com/MenoDK/bulkhead-saas.git',
        'cd bulkhead-saas',
        '# 2. secrets, images, database, API, worker and web',
        'make up',
        '# 3. open http://localhost:8080 and press “Enter the lab”',
        '# optional: a black-box check of the running stack',
        'make smoke',
      ],
    },
  },

  under: {
    eyebrow: 'Under the hood',
    title: ['A small surface,', 'serious edges.'],
    text: 'There are only a few tables of business data on purpose. Everything that matters in production is real, and the decisions behind it are written down with the alternatives that lost.',
    stackTitle: 'What it is built with',
    stack: [
      { group: 'API', items: ['Node 22 · TypeScript (strict)', 'NestJS 11', 'zod', 'plain SQL migrations, checksummed'] },
      { group: 'Data', items: ['PostgreSQL 16 · RLS with FORCE', 'Advisory locks · SKIP LOCKED', 'Append-only audit by trigger', 'Keyset pagination'] },
      { group: 'Console', items: ['React 19 · Vite', 'TanStack Query', 'Socket.IO', 'Theme tokens tested for contrast'] },
      { group: 'Quality', items: ['Jest on a real PostgreSQL', 'Mutation checks on the invariants', 'Playwright + axe', 'ESLint · tsc --strict'] },
      { group: 'Delivery', items: ['Multi-stage Dockerfiles, non-root', 'Compose with a one-shot migrator', 'nginx front door with a strict CSP', 'GitHub Actions · gitleaks'] },
    ],
    proofTitle: 'What is measured, and the records behind it',
    numbers: [
      ['215', 'API tests, 88 of them against a real PostgreSQL'],
      ['209', 'console tests, plus a browser suite with axe scans'],
      ['7', 'mutants of the invariants, all killed by a test'],
      ['9', 'decision records, each with rejected alternatives'],
    ],
    decisions: [
      ['Isolation in the database', 'ADR 0001: why row-level security and not only a where clause in every query.', 'docs/adr/0001-tenant-isolation-with-row-level-security.md'],
      ['Idempotency keys commit with the work', 'ADR 0003: why the key lives in the same transaction as the payment.', 'docs/adr/0003-idempotency-keys-in-the-same-transaction.md'],
      ['A transactional outbox', 'ADR 0004: why webhooks are not called from inside a request.', 'docs/adr/0004-transactional-outbox.md'],
      ['A hash-chained audit trail', 'ADR 0002: what the chain proves and what only a copy kept elsewhere can.', 'docs/adr/0002-hash-chained-audit-trail.md'],
    ],
    measuredOn: 'Measured on 2026-11-04. Counts come from the commands in the README, not from memory.',
    future: [
      ['A cookie behind a backend-for-frontend', 'so the refresh token never reaches JavaScript.'],
      ['The audit head published elsewhere', 'so deleting the tail of a trail is noticed too.'],
      ['The Redis adapter for Socket.IO', 'so the API can scale to several nodes.'],
      ['LISTEN/NOTIFY for the outbox', 'to cut delivery latency below the poll interval.'],
    ],
  },

  about: {
    why: 'Bulkhead is the multi-tenant side of my work: software that serves many separate customers from one system and must never let one of them see or damage another. The ideas come from systems I have built and operated; the code in this repository is written fresh and tested.',
  },

  faq: [
    ['Is the sign-up real?', 'Yes. This is the one repository with real accounts: you register a workspace against the real API, and what the lab does afterwards is done as you. Nothing leaves your machine.'],
    ['Why row-level security and not just a where clause?', 'Because a where clause is something every query must remember, and one forgotten query is a breach. With RLS and FORCE the database refuses the row, and a connection that did not say which tenant it serves sees nothing. ADR 0001 has the alternatives.'],
    ['What does the audit chain not protect against?', 'Someone with the database and the knowledge to switch off the trigger can delete the whole tail. Publishing the head hash somewhere they cannot write would expose that; the README lists it as the next step.'],
    ['Why is the console under /app/ ?', 'So the landing page and the lab can own the root. The console is the same React app and the same API; only its base path changed.'],
    ['Is it production-ready?', 'It is built and tested to that standard: strict types, real-database tests, mutation checks. It has not carried real traffic, and what it lacks is listed in the README limitations.'],
  ],

  closing: {
    eyebrow: 'Your turn',
    title: ['Try to break out', 'of your compartment.'],
    button: 'Open the lab',
    fine: 'Local only · fictional data · nothing is sent anywhere',
  },
};
