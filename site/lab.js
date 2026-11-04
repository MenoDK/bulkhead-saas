/* The lab: six tabs, each one a way to try to break out of your compartment. Loaded before kit.js; it only declares things.
   Unlike a stand-in, everything here talks to the real API through the same front door the console uses: you register a
   real workspace, and the lab acts as you. Everything that came back from the API is inserted as text, never as markup,
   and the page can only talk to its own origin (strict CSP). Nothing here needs, or has, a special mode on the server. */
(() => {
  'use strict';

  const NICHES = [
    ['general', 'General', 'Resources'],
    ['restaurant', 'Restaurant', 'Menu'],
    ['legal', 'Legal', 'Cases'],
    ['civic', 'Civic office', 'Proposals'],
    ['wellness', 'Wellness', 'Programs'],
  ];
  const PERSONAS = {
    general: ['Sam Rivera', 'Rivera Works'],
    restaurant: ['Mariana Costa', 'Mariana’s Bistro'],
    legal: ['Tomás Okoye', 'Okoye & Partners'],
    civic: ['Lena Hoffmann', 'Hoffmann District Office'],
    wellness: ['Noor Haddad', 'Haddad Wellness'],
  };
  const KNOWN_KEY = 'bulkhead-lab-known';
  const B_KEY = 'bulkhead-lab-b';
  const M_KEY = 'bulkhead-lab-m';
  const REFUSED_TARGETS = [
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://[::1]/',
    'http://localhost/',
    'http://10.0.0.5/admin',
    'http://user:pass@203.0.113.7/',
    'https://hooks.example.invalid/in',
    'file:///etc/passwd',
  ];

  /* ------------------------------------------------------------- small helpers */
  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  const rand = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % ALPHABET.length]).join('');
  const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const x = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  };
  const short = (s, n = 8) => (s ? String(s).slice(0, n) : '—');
  const money = (cents) => (Number(cents) / 100).toFixed(2);
  const httpKind = (status) => (status >= 200 && status < 300 ? 'ok' : status >= 500 ? 'bad' : 'warn');
  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = (s) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')));
  const clamp = (v, lo, hi, fallback) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };

  function describe(r) {
    const e = r.data && r.data.error;
    if (!e) return `The service answered ${r.status}.`;
    if (e.code === 'RATE_LIMITED') return `Too many attempts from this address. Try again in ${e.details?.retryAfterSeconds ?? 'a few'} seconds.`;
    if (e.code === 'VALIDATION_FAILED' && e.details) return `${e.message}: ${JSON.stringify(e.details).slice(0, 180)}`;
    return e.message || `The service answered ${r.status}.`;
  }

  /* ------------------------------------------------------------- workspaces held by the lab
     A is the one you signed in as (kept in the kit's session slot). B (the second tenant) and M (a team member of A) are
     made on demand. Only tokens are stored, and only in sessionStorage; passwords are never kept. */
  const W = { A: null, B: null, M: null };
  const pending = new WeakMap();
  /** One creation at a time per slot: two clicks while the workspace is being made share it instead of making two. */
  const making = {};
  const once = (slot, make) => {
    making[slot] ||= make().finally(() => {
      delete making[slot];
    });
    return making[slot];
  };
  const parse = (s) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };
  const read = (key) => window.Kit.store.get(key, 'sessionStorage');
  function getW(slot) {
    if (!W[slot]) W[slot] = slot === 'A' ? parse(window.Kit.session.key()) : parse(read(slot === 'B' ? B_KEY : M_KEY));
    return W[slot];
  }
  function setW(slot, value) {
    W[slot] = value;
    if (slot === 'A') {
      if (value) window.Kit.session.set(JSON.stringify(value));
      else window.Kit.session.clear();
    } else {
      const key = slot === 'B' ? B_KEY : M_KEY;
      if (value) window.Kit.store.set(key, JSON.stringify(value), 'sessionStorage');
      else window.Kit.store.del(key, 'sessionStorage');
    }
  }
  const fromSession = (d) => ({ access: d.accessToken, refresh: d.refreshToken, user: d.user, tenant: d.tenant });

  const raw = (k, path, opts = {}) => k.api(`/api${path}`, { auth: false, ...opts });

  async function refreshSlot(k, slot) {
    const w = getW(slot);
    if (!w || !w.refresh) return false;
    if (!pending.has(w)) {
      pending.set(
        w,
        (async () => {
          const r = await raw(k, '/auth/refresh', { method: 'POST', body: { refreshToken: w.refresh } });
          if (!r.ok) return false;
          setW(slot, { ...w, ...fromSession(r.data) });
          return true;
        })().finally(() => pending.delete(w))
      );
    }
    return pending.get(w);
  }

  /** A call as one of the lab's workspaces. A short-lived access token that has expired is renewed once, quietly. */
  async function call(k, slot, path, { method = 'GET', body, headers = {}, key } = {}) {
    // The second workspace and the team member are made on first use. A click that arrives while one is still being
    // made must wait for it; sending the request without a token would answer 401 and read as a failure of the product.
    if (slot === 'B') await ensureB(k);
    else if (slot === 'M') await ensureMember(k);
    const send = () => {
      const h = { ...headers };
      const w = slot ? getW(slot) : null;
      if (w && w.access && !h.authorization) h.authorization = `Bearer ${w.access}`;
      if (key) h['idempotency-key'] = key;
      return raw(k, path, { method, body, headers: h });
    };
    let r = await send();
    if (slot && r.status === 401 && r.data?.error?.code === 'INVALID_TOKEN' && (await refreshSlot(k, slot))) r = await send();
    return r;
  }

  async function register(k, { name, tenantName, email, password, niche }) {
    const r = await raw(k, '/auth/register', { method: 'POST', body: { email, password, name, tenantName, niche } });
    if (!r.ok) throw new Error(describe(r));
    return r.data;
  }

  async function ensureB(k) {
    if (getW('B')) return getW('B');
    return once('B', async () => {
      const [name, tenantName] = PERSONAS.legal;
      const data = await register(k, { name, tenantName, email: `b-${rand(8)}@example.test`, password: `lab-${rand(14)}`, niche: 'legal' });
      setW('B', fromSession(data));
      return getW('B');
    });
  }

  async function ensureMember(k) {
    if (getW('M')) return getW('M');
    return once('M', async () => {
      const email = `member-${rand(8)}@example.test`;
      const password = `lab-${rand(14)}`;
      const added = await call(k, 'A', '/members', { method: 'POST', body: { email, name: 'Mia Member', password, role: 'member' } });
      if (!added.ok) throw new Error(describe(added));
      const login = await raw(k, '/auth/login', { method: 'POST', body: { email, password } });
      if (!login.ok) throw new Error(describe(login));
      setW('M', fromSession(login.data));
      return getW('M');
    });
  }

  /* ------------------------------------------------------------- shared pieces */
  function answer(k, title, r) {
    const { h, badge, out } = k;
    return h('div', { class: 'box arrive' }, h('h3', {}, title, ' ', badge(String(r.status), httpKind(r.status)), ' ', h('small', {}, `${r.ms} ms`)), out(r.data));
  }
  function pushCard(target, card, keep = 4) {
    target.prepend(card);
    while (target.children.length > keep) target.lastElementChild.remove();
  }
  function tally(responses, label) {
    const counts = new Map();
    for (const r of responses) {
      const code = r.data?.error?.code;
      const key = label ? label(r) : `${r.status}${code ? ` ${code}` : ''}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }
  function tallyList(k, entries) {
    const { h, badge } = k;
    return h(
      'ul',
      { class: 'trace' },
      entries.map(([label, n]) => {
        const [status, ...rest] = label.split(' ');
        return h('li', {}, badge(status, httpKind(Number(status))), h('span', {}, rest.join(' ') || 'accepted'), h('strong', {}, `× ${n}`));
      })
    );
  }
  function invoiceKv(k, inv) {
    const { h, badge, kv } = k;
    return kv({
      Invoice: h('code', {}, short(inv.id)),
      Status: badge(inv.status, inv.status === 'paid' ? 'ok' : inv.status === 'void' ? 'bad' : 'warn'),
      Total: `${money(inv.totalCents)} ${inv.currency}`,
      Paid: money(inv.paidCents),
      Refunded: money(inv.refundedCents),
      Balance: money(inv.balanceCents),
    });
  }
  function workspaceKv(k, w) {
    const { h, kv } = k;
    return kv({
      Workspace: w.tenant.name,
      Niche: w.tenant.niche,
      Role: w.tenant.role,
      'Tenant id': h('code', {}, short(w.tenant.id, 13)),
      User: w.user.email,
    });
  }

  /* ---------------------------------------------------------------- isolation */
  async function isolationTab(panel, k) {
    const { h, button, box, toast } = k;
    const views = h('div', {});
    const results = h('div', {});
    const idInput = h('input', { id: 'iso-id', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'A record id' });
    const bNode = h('div', { 'aria-live': 'polite' }, h('p', { class: 'hint' }, 'Creating the second workspace…'));

    async function paintWorkspaces() {
      const b = await ensureB(k);
      views.replaceChildren(
        h('div', { class: 'cols' },
          h('div', {}, box('Workspace A (you)', 'The one you signed in as.', workspaceKv(k, getW('A')))),
          h('div', {}, box('Workspace B', 'A different business, made for you just now.', workspaceKv(k, b)))));
    }
    const make = async (slot, label) => {
      const r = await call(k, slot, '/resources', { method: 'POST', body: { name: `${label} record ${rand(4)}`, data: { notes: `only workspace ${slot} should ever see this` } } });
      pushCard(results, answer(k, `Create a record in ${slot}`, r));
      if (r.ok && slot === 'A') idInput.value = r.data.id;
    };
    const need = () => {
      if (!idInput.value.trim()) {
        toast('Create a record in A first, or paste an id.', true);
        return false;
      }
      return true;
    };
    const as = (slot, label, method, withBody) => async () => {
      if (!need()) return;
      const id = encodeURIComponent(idInput.value.trim());
      const r = await call(k, slot, `/resources/${id}`, { method, body: withBody ? { version: 1, name: 'hijacked' } : undefined });
      pushCard(results, answer(k, label, r));
    };
    const forged = async (label, token, extra = {}) => {
      if (!need()) return;
      const r = await call(k, null, `/resources/${encodeURIComponent(idInput.value.trim())}`, { headers: { authorization: `Bearer ${token}`, ...extra } });
      pushCard(results, answer(k, label, r));
    };

    panel.append(
      h('div', { class: 'cols' },
        h('div', {},
          box('1 · Two workspaces', 'Two real tenants in one database. Each token names its own tenant, and the API takes the tenant from the token only.', views, bNode),
          box('2 · Make something in A', 'A record that only A should ever be able to see.',
            h('div', { class: 'row' },
              button('Create a record in A', () => make('A', 'A’s'), { variant: 'primary', ic: 'doc' }),
              button('Create a record in B', () => make('B', 'B’s'), { ic: 'doc' })))),
        h('div', {},
          box('3 · Try to read it from outside', 'Paste any record id. B asks for A’s record, then tries to change and delete it.',
            h('label', { for: 'iso-id' }, 'Record id'), idInput,
            h('div', { class: 'row' },
              button('Read it as A', as('A', 'Read it as A', 'GET'), { ic: 'eye' }),
              button('Read it as B', as('B', 'Read it as B', 'GET'), { variant: 'primary', ic: 'eye' }),
              button('Change it as B', as('B', 'Change it as B', 'PATCH', true), { ic: 'wrench' }),
              button('Delete it as B', as('B', 'Delete it as B', 'DELETE'), { ic: 'x' }),
              button('List what B can see', async () => {
                const r = await call(k, 'B', '/resources?limit=50');
                pushCard(results, h('div', { class: 'box arrive' }, h('h3', {}, 'List what B can see ', k.badge(String(r.status), httpKind(r.status)), ' ', h('small', {}, `${r.ms} ms`)), h('p', {}, r.ok ? `${r.data.items.length} record(s), none of them A’s.` : describe(r)), k.out(r.ok ? r.data.items.map((x) => x.name) : r.data)));
              }, { ic: 'search' }))),
          box('4 · Forge a token', 'Anyone can read a token; only the server can sign one. These are sent as workspace-less callers.',
            h('div', { class: 'row' },
              button('Swap the tenant in A’s token', async () => {
                const [head, payload, sig] = getW('A').access.split('.');
                const claims = unb64url(payload);
                claims.tid = getW('B').tenant.id;
                await forged('A’s token with B’s tenant swapped in', `${head}.${b64url(claims)}.${sig}`);
              }, { ic: 'key' }),
              button('Use an unsigned token', async () => {
                const claims = unb64url(getW('A').access.split('.')[1]);
                await forged('A’s claims with “alg: none”', `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.`);
              }, { ic: 'unlock' }),
              button('Claim A’s tenant in a header, as B', async () => {
                await forged('B’s token with an X-Tenant-Id header naming A', getW('B').access, { 'x-tenant-id': getW('A').tenant.id });
              }, { ic: 'globe' })))),
      ),
      results);
    await paintWorkspaces();
    bNode.remove();
  }

  /* ---------------------------------------------------------------- money */
  const M = { invoice: null, key: null, settled: null };
  async function moneyTab(panel, k) {
    const { h, button, box, toast } = k;
    const view = h('div', { 'aria-live': 'polite' }, h('p', { class: 'hint' }, 'No invoice yet.'));
    const settledView = h('div', { 'aria-live': 'polite' }, h('p', { class: 'hint' }, 'No settled invoice yet.'));
    const results = h('div', {});
    const count = h('input', { id: 'm-n', type: 'number', min: '1', max: '40', value: '20', autocomplete: 'off' });
    const amount = h('input', { id: 'm-amt', type: 'text', value: '10.00', autocomplete: 'off', inputmode: 'decimal' });

    const fetchInvoice = async (id) => {
      const r = await call(k, 'A', `/invoices/${id}`);
      if (!r.ok) throw new Error(describe(r));
      return r.data;
    };
    const paintInvoice = async () => {
      if (!M.invoice) return null;
      const inv = await fetchInvoice(M.invoice);
      view.replaceChildren(invoiceKv(k, inv));
      return inv;
    };
    const create = async (total) => {
      const made = await call(k, 'A', '/invoices', { method: 'POST', key: uuid(), body: { currency: 'USD', lines: [{ description: 'Retainer', quantity: 1, unitPrice: total }] } });
      if (!made.ok) throw new Error(describe(made));
      const issued = await call(k, 'A', `/invoices/${made.data.id}/issue`, { method: 'POST' });
      if (!issued.ok) throw new Error(describe(issued));
      return issued;
    };
    const needInvoice = () => {
      if (M.invoice) return true;
      toast('Create an invoice first.', true);
      return false;
    };

    const payment = (invoice, amt, key) => call(k, 'A', `/invoices/${invoice}/payments`, { method: 'POST', key: key || uuid(), body: { amount: amt } });

    const refund = (who, label, amt) => async () => {
      if (!M.settled) {
        toast('Settle an invoice first.', true);
        return;
      }
      if (who === 'M') await ensureMember(k);
      const r = await call(k, who, `/invoices/${M.settled}/refunds`, { method: 'POST', key: uuid(), body: { amount: amt, reason: 'lab' } });
      pushCard(results, answer(k, label, r));
      settledView.replaceChildren(invoiceKv(k, await fetchInvoice(M.settled)));
    };

    panel.append(
      h('div', { class: 'cols' },
        h('div', {},
          box('1 · An invoice', 'Amounts are integer cents in the database, guarded by CHECK constraints. A new invoice is issued so it can take payments.',
            h('div', { class: 'row' }, button('Create an invoice of 100.00', async () => {
              const issued = await create('100.00');
              M.invoice = issued.data.id;
              M.key = null;
              pushCard(results, answer(k, 'Create and issue an invoice of 100.00', issued));
              await paintInvoice();
            }, { variant: 'primary', ic: 'doc' })),
            view),
          box('2 · Pay it all at once', 'Every request carries its own idempotency key, so none of them is a retry. The guard is the UPDATE itself.',
            h('label', { for: 'm-n' }, 'How many payments'), count,
            h('label', { for: 'm-amt' }, 'Each one is'), amount,
            h('div', { class: 'row' }, button('Pay all at once', async () => {
              if (!needInvoice()) return;
              const n = clamp(count.value, 1, 40, 20);
              const amt = amount.value.trim() || '10.00';
              const rs = await Promise.all(Array.from({ length: n }, () => payment(M.invoice, amt)));
              const inv = await paintInvoice();
              pushCard(results, h('div', { class: 'box arrive' },
                h('h3', {}, `${n} payments of ${amt} sent together`),
                tallyList(k, tally(rs)),
                h('p', { class: 'hint' }, `The invoice ends at ${money(inv.paidCents)} paid and a balance of ${money(inv.balanceCents)}.`)));
            }, { variant: 'primary', ic: 'bolt' })))),
        h('div', {},
          box('3 · One key, many requests', 'Networks retry. A payment sent again with the same key must be applied once and answered the same way.',
            h('div', { class: 'row' },
              button('Send the same payment 10 times', async () => {
                if (!needInvoice()) return;
                M.key = uuid();
                const rs = await Promise.all(Array.from({ length: 10 }, () => payment(M.invoice, '5.00', M.key)));
                const inv = await paintInvoice();
                pushCard(results, h('div', { class: 'box arrive' },
                  h('h3', {}, 'The same 5.00 payment, ten times at once'),
                  tallyList(k, tally(rs, (r) => `${r.status} ${r.headers.get('idempotent-replayed') === 'true' ? 'replay of the first answer' : 'applied'}`)),
                  h('p', { class: 'hint' }, `The invoice shows ${money(inv.paidCents)} paid: one payment, not ten.`)));
              }, { variant: 'primary', ic: 'refresh' }),
              button('Reuse the key with another amount', async () => {
                if (!needInvoice()) return;
                if (!M.key) {
                  toast('Send the same payment first.', true);
                  return;
                }
                pushCard(results, answer(k, 'Same key, 6.00 instead of 5.00', await payment(M.invoice, '6.00', M.key)));
              }, { ic: 'alert' }))),
          box('4 · Money going out', 'Anyone who can write may refund a small amount; above the threshold (100.00 here) it takes an admin or owner. The member is a real team member of your workspace.',
            h('div', { class: 'row' }, button('Settle a 200.00 invoice', async () => {
              const issued = await create('200.00');
              M.settled = issued.data.id;
              const paid = await payment(M.settled, '200.00');
              pushCard(results, answer(k, 'Pay the 200.00 invoice in full', paid));
              settledView.replaceChildren(invoiceKv(k, await fetchInvoice(M.settled)));
            }, { variant: 'primary', ic: 'check' })),
            settledView,
            h('div', { class: 'row' },
              button('Refund 150.00 as a member', refund('M', 'Refund 150.00 as a member', '150.00'), { ic: 'lock' }),
              button('Refund 50.00 as a member', refund('M', 'Refund 50.00 as a member', '50.00'), { ic: 'unlock' }),
              button('Refund 150.00 as the owner', refund('A', 'Refund 150.00 as the owner', '150.00'), { ic: 'key' }),
              button('Refund more than was paid', refund('A', 'Refund 900.00 as the owner', '900.00'), { ic: 'alert' })))),
      ),
      results);
  }

  /* ---------------------------------------------------------------- sessions */
  const T = { email: null, password: null, refresh: null, old: null };
  async function sessionsTab(panel, k) {
    const { h, button, box, kv, toast, badge } = k;
    const who = h('div', { 'aria-live': 'polite' }, h('p', { class: 'hint' }, 'No throwaway account yet.'));
    const results = h('div', {});
    const need = () => {
      if (T.email) return true;
      toast('Register a throwaway account first.', true);
      return false;
    };
    const login = (email, password) => raw(k, '/auth/login', { method: 'POST', body: { email, password } });
    const exchange = (token) => raw(k, '/auth/refresh', { method: 'POST', body: { refreshToken: token } });
    const adopt = (r) => {
      if (r.ok) {
        T.old = T.refresh;
        T.refresh = r.data.refreshToken;
      }
    };

    panel.append(
      h('div', { class: 'cols' },
        h('div', {},
          box('1 · A throwaway account', 'Made just for this tab, so locking it out costs you nothing.',
            h('div', { class: 'row' }, button('Register a throwaway account', async () => {
              const email = `lab-${rand(8)}@example.test`;
              const password = `lab-${rand(14)}`;
              const data = await register(k, { name: 'Throwaway', tenantName: `Throwaway ${rand(4)}`, email, password, niche: 'general' });
              Object.assign(T, { email, password, refresh: data.refreshToken, old: null });
              who.replaceChildren(kv({ Account: email, 'Refresh token': h('code', {}, short(T.refresh, 10)) }));
            }, { variant: 'primary', ic: 'users' })),
            who),
          box('2 · Rotate, then steal', 'A refresh token works once. Rotating swaps it for a new one; presenting the old one again is what a thief does.',
            h('div', { class: 'row' },
              button('Rotate', async () => {
                if (!need()) return;
                const r = await exchange(T.refresh);
                adopt(r);
                pushCard(results, answer(k, 'Rotate: present the current refresh token', r));
                if (r.ok) who.replaceChildren(kv({ Account: T.email, 'Refresh token': h('code', {}, short(T.refresh, 10)) }));
              }, { variant: 'primary', ic: 'refresh' }),
              button('Replay the old token', async () => {
                if (!need()) return;
                if (!T.old) {
                  toast('Rotate first, so there is an old token to replay.', true);
                  return;
                }
                pushCard(results, answer(k, 'Replay the token that was already used', await exchange(T.old)));
              }, { ic: 'alert' }),
              button('Use the newest token', async () => {
                if (!need()) return;
                const r = await exchange(T.refresh);
                adopt(r);
                pushCard(results, answer(k, 'Present the newest refresh token', r));
              }, { ic: 'key' })))),
        h('div', {},
          box('3 · Guess passwords', 'The limit is per account and address and counts attempts, not outcomes, so a lucky guess is not a way round it.',
            h('div', { class: 'row' },
              button('Guess 12 passwords', async () => {
                if (!need()) return;
                const rs = [];
                for (let i = 1; i <= 12; i += 1) rs.push(await login(T.email, `wrong-guess-${i}`));
                pushCard(results, h('div', { class: 'box arrive' },
                  h('h3', {}, 'Twelve wrong passwords, one after another'),
                  tallyList(k, tally(rs)),
                  h('p', { class: 'hint' }, rs[11].data?.error?.details?.retryAfterSeconds ? `The last answer says to wait ${rs[11].data.error.details.retryAfterSeconds} seconds.` : '')));
              }, { variant: 'primary', ic: 'lock' }),
              button('Sign in with the right password', async () => {
                if (!need()) return;
                pushCard(results, answer(k, 'The right password, while limited', await login(T.email, T.password)));
              }, { ic: 'unlock' }))),
          box('4 · Does it give anything away?', 'A wrong password for a real account and a sign-in for an e-mail nobody has should be indistinguishable, in the answer and in the time it takes.',
            h('div', { class: 'row' }, button('Compare a wrong password with an unknown e-mail', async () => {
              const real = await login(getW('A').user.email, `not-the-password-${rand(4)}`);
              const unknown = await login(`nobody-${rand(8)}@example.test`, `not-the-password-${rand(4)}`);
              const same = real.status === unknown.status && real.data?.error?.code === unknown.data?.error?.code && real.data?.error?.message === unknown.data?.error?.message;
              pushCard(results, h('div', { class: 'box arrive' },
                h('h3', {}, 'A real account and an unknown e-mail ', badge(same ? 'same answer' : 'different', same ? 'ok' : 'bad')),
                kv({ 'Real account': `${real.status} ${real.data?.error?.code ?? ''} in ${real.ms} ms`, 'Unknown e-mail': `${unknown.status} ${unknown.data?.error?.code ?? ''} in ${unknown.ms} ms` }),
                h('p', { class: 'hint' }, 'This counts as one failed sign-in on your own account; nine more would lock it for a while.')));
            }, { ic: 'search' }))))),
      results);
  }

  /* ---------------------------------------------------------------- webhooks */
  const E = { endpoint: null };
  async function webhooksTab(panel, k) {
    const { h, button, box, kv, badge, toast } = k;
    const results = h('div', {});
    const table = h('div', {}, h('p', { class: 'hint' }, 'Nothing tried yet.'));
    const endpointView = h('div', { 'aria-live': 'polite' }, h('p', { class: 'hint' }, 'No endpoint registered yet.'));
    const deliveries = h('div', { 'aria-live': 'polite' }, h('p', { class: 'hint' }, 'No deliveries yet.'));
    const url = h('input', { id: 'w-url', type: 'text', autocomplete: 'off', spellcheck: 'false', value: 'http://169.254.169.254/latest/meta-data/' });

    async function tryTarget(target) {
      const r = await call(k, 'A', '/webhook-endpoints', { method: 'POST', body: { url: target } });
      if (r.ok) await call(k, 'A', `/webhook-endpoints/${r.data.id}`, { method: 'DELETE' }); // never leave an accepted probe behind
      return r;
    }
    async function showDeliveries() {
      if (!E.endpoint) {
        toast('Register an endpoint first.', true);
        return;
      }
      const r = await call(k, 'A', `/webhook-endpoints/${E.endpoint}/deliveries`);
      if (!r.ok) throw new Error(describe(r));
      deliveries.replaceChildren(r.data.length
        ? h('ul', { class: 'trace' }, r.data.map((d) => h('li', {}, h('code', {}, d.topic), badge(d.status, d.status === 'delivered' ? 'ok' : d.status === 'dead' ? 'bad' : 'warn'), h('span', {}, `attempt ${d.attempts}${d.lastError ? ` · ${d.lastError}` : ''}`), h('code', {}, d.deliveredAt ? 'delivered' : 'waiting'))))
        : h('p', { class: 'hint' }, 'No events yet. Create a record that fires one.'));
    }

    panel.append(
      h('div', { class: 'cols' },
        h('div', {},
          box('1 · Aim it inward', 'A tenant gives the platform a URL and the platform calls it from inside its own network. Each of these is a way of writing an address you must not call.',
            h('div', { class: 'row' }, button('Try all the targets', async () => {
              const rows = [];
              for (const target of REFUSED_TARGETS) {
                const r = await tryTarget(target);
                rows.push([target, r]);
                table.replaceChildren(h('ul', { class: 'trace' }, rows.map(([t, x]) => h('li', {}, h('code', {}, t), badge(String(x.status), httpKind(x.status)), h('span', {}, x.ok ? 'accepted' : x.data?.error?.code || 'refused')))));
              }
            }, { variant: 'primary', ic: 'alert' })),
            table,
            h('label', { for: 'w-url' }, 'Or try your own'), url,
            h('div', { class: 'row' }, button('Try this address', async () => pushCard(results, answer(k, `Register ${url.value.trim()}`, await tryTarget(url.value.trim()))), { ic: 'search' })))),
        h('div', {},
          box('2 · A real one', 'A documentation address is public as far as the guard is concerned, but nothing answers. The separate worker claims the event, tries, and records what happened.',
            h('div', { class: 'row' },
              button('Register 203.0.113.7', async () => {
                const r = await call(k, 'A', '/webhook-endpoints', { method: 'POST', body: { url: 'https://203.0.113.7/hook' } });
                pushCard(results, answer(k, 'Register https://203.0.113.7/hook', r));
                if (r.ok) {
                  E.endpoint = r.data.id;
                  endpointView.replaceChildren(kv({ Endpoint: h('code', {}, short(r.data.id)), Secret: h('code', {}, `${short(r.data.secret, 10)}… (returned once)`) }));
                }
              }, { variant: 'primary', ic: 'plug' }),
              button('Create a record that fires an event', async () => {
                const r = await call(k, 'A', '/resources', { method: 'POST', body: { name: `Triggers an event ${rand(4)}` } });
                if (!r.ok) throw new Error(describe(r));
                toast('Record created. The worker polls about once a second.');
                setTimeout(() => showDeliveries().catch(() => {}), 2500);
              }, { ic: 'bolt' }),
              button('Show deliveries', showDeliveries, { ic: 'refresh' })),
            endpointView, deliveries))),
      results);
  }

  /* ---------------------------------------------------------------- audit */
  async function auditTab(panel, k) {
    const { h, button, box, kv, badge, out } = k;
    const chain = h('div', { 'aria-live': 'polite' });
    const verdict = h('div', { 'aria-live': 'polite' });
    async function refresh() {
      const r = await call(k, 'A', '/audit?limit=15');
      if (!r.ok) throw new Error(describe(r));
      chain.replaceChildren(r.data.items.length
        ? h('ul', { class: 'trace' }, r.data.items.map((e) => h('li', {}, h('code', {}, `#${e.seq}`), badge(e.action, /voided|refund/.test(e.action) ? 'warn' : ''), h('span', {}, e.entityType ? `${e.entityType} ${short(e.entityId, 6)}` : ''), h('code', {}, short(e.hash)))))
        : h('p', { class: 'hint' }, 'The chain is empty. Do something in another tab.'));
    }
    const command = 'scripts/tamper-demo.sh';
    panel.append(
      h('div', { class: 'cols' },
        h('div', {},
          box('1 · The chain', 'Your workspace’s own trail, newest first. Each row’s hash covers the row before it.', chain,
            h('div', { class: 'row' }, button('Refresh', refresh, { small: true, ic: 'refresh' }))),
          box('2 · Check it', 'Verification walks the whole chain and reports the first row that does not agree with its neighbour.',
            h('div', { class: 'row' },
              button('Verify', async () => {
                const r = await call(k, 'A', '/audit/verify');
                if (!r.ok) throw new Error(describe(r));
                verdict.replaceChildren(h('div', { class: 'box arrive' }, h('h3', {}, 'Verify ', badge(r.data.valid ? 'intact' : 'damage found', r.data.valid ? 'ok' : 'bad')), kv({ 'Rows checked': String(r.data.checked), 'Head hash': h('code', {}, short(r.data.headHash, 16)), ...(r.data.valid ? {} : { 'Broken at': `row #${r.data.broken.seq} (${r.data.broken.reason})` }) })));
              }, { variant: 'primary', ic: 'check' }),
              button('Export it signed', async () => {
                const r = await call(k, 'A', '/audit/export?limit=50');
                if (!r.ok) throw new Error(describe(r));
                verdict.replaceChildren(h('div', { class: 'box arrive' }, h('h3', {}, 'Signed export'), kv({ Entries: String(r.data.envelope.count), 'Head hash': h('code', {}, short(r.data.envelope.headHash, 16)), Signature: h('code', {}, short(r.data.signature, 16)) }), h('p', { class: 'hint' }, 'The signature covers the envelope with a key only the server has, so a copy kept elsewhere can be checked later.')));
              }, { ic: 'doc' })),
            verdict)),
        h('div', {},
          box('3 · Behind the application’s back', 'A browser cannot do this one: it takes the database’s owner. The script registers a throwaway workspace, tries to edit its trail as the owner, switches the guard off, edits again and verifies.',
            out(command),
            h('p', { class: 'hint' }, 'The recorded run is in the tour on the landing page. The script needs the Compose stack (make up) and Docker.')))),
    );
    await refresh();
  }

  /* ---------------------------------------------------------------- console */
  async function consoleTab(panel, k) {
    const { h, button, box, toast } = k;
    const note = h('p', { class: 'hint' }, 'Each button registers a new workspace for a different kind of business, signs it in, and opens the console. Come back here with the browser’s back button.');
    const openAs = ([id, label]) => button(`Open the console as ${label}`, async () => {
      const [name, tenantName] = PERSONAS[id];
      const data = await register(k, { name, tenantName, email: `${id}-${rand(8)}@example.test`, password: `lab-${rand(14)}`, niche: id });
      window.Kit.store.set('auth.refresh', data.refreshToken, 'sessionStorage');
      toast(`Opening ${tenantName}…`);
      window.location.assign('/app/');
    }, { ic: 'arrow', small: true });
    panel.append(
      h('div', { class: 'cols' },
        h('div', {}, box('One app, five businesses', 'The same React app and API. The workspace’s niche picks the palette, the radii, the typeface and the vocabulary; every palette is tested for contrast in light and dark.', note)),
        h('div', {}, box('Pick a business', null, h('ul', { class: 'trace' }, NICHES.map((n) => h('li', {}, h('strong', {}, n[1]), h('span', {}, `“${n[2]}”`), openAs(n))))))));
  }

  /* ---------------------------------------------------------------- the lab */
  window.LAB = {
    eyebrow: 'The lab',
    title: 'Try to break out of your compartment.',
    text: 'Six ways to push on a multi-tenant system, each backed by tests. You are signed in to a real workspace on the real API; the lab makes a second tenant, a team member and throwaway accounts as it needs them. Fictional data throughout.',
    reset: {
      label: 'Start over',
      hint: 'Forgets the second workspace, the invoices and the throwaway accounts made here. Your own workspace and its data stay.',
      done: 'Back to a clean slate.',
      run: async () => {
        setW('B', null);
        setW('M', null);
        Object.assign(M, { invoice: null, key: null, settled: null });
        Object.assign(T, { email: null, password: null, refresh: null, old: null });
        E.endpoint = null;
      },
    },
    tabs: [
      { id: 'isolation', label: 'Isolation', icon: 'shield', render: (p, k) => isolationTab(p, k) },
      { id: 'money', label: 'Money', icon: 'wave', render: (p, k) => moneyTab(p, k) },
      { id: 'sessions', label: 'Sessions', icon: 'key', render: (p, k) => sessionsTab(p, k) },
      { id: 'webhooks', label: 'Webhooks', icon: 'plug', render: (p, k) => webhooksTab(p, k) },
      { id: 'audit', label: 'Audit', icon: 'hash', render: (p, k) => auditTab(p, k) },
      { id: 'console', label: 'Console', icon: 'layers', render: (p, k) => consoleTab(p, k) },
    ],
  };

  /* ---------------------------------------------------------------- sign-in (a real account) */
  window.SITE.auth.build = async (authPage, session) => {
    const known = window.Kit.store.get(KNOWN_KEY) || '';
    const freshPassword = () => `lab-${rand(14)}`;
    const email = (prefix) => `${prefix}-${rand(6)}@example.test`;
    const create = {
      creates: true,
      eyebrow: 'New workspace',
      title: 'Create your workspace',
      lead: 'A real tenant on the real API, on your machine. Pick a business below to fill this in, or type your own.',
      fields: [
        { name: 'name', label: 'Your name', icon: 'users', default: PERSONAS.restaurant[0], autocomplete: 'name' },
        { name: 'tenantName', label: 'Workspace name', icon: 'layers', default: PERSONAS.restaurant[1], autocomplete: 'organization' },
        { name: 'email', label: 'E-mail', type: 'email', icon: 'mail', default: email('mariana'), autocomplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', icon: 'key', default: freshPassword(), minlength: 10, autocomplete: 'new-password' },
      ],
      submit: 'Create workspace',
      busy: 'Creating…',
      switchTo: 'other',
      switchText: 'Already registered here?',
      switchLabel: 'Sign in',
    };
    const signin = {
      eyebrow: 'Lab access',
      title: 'Sign in',
      lead: 'Use the workspace you registered here. Accounts live in the database of this stack and nowhere else.',
      fields: [
        { name: 'email', label: 'E-mail', type: 'email', icon: 'mail', default: known, autocomplete: 'username' },
        { name: 'password', label: 'Password', type: 'password', icon: 'key', default: '', autocomplete: 'current-password' },
      ],
      submit: 'Sign in',
      busy: 'Signing in…',
      switchTo: 'login',
      switchText: 'No workspace yet?',
      switchLabel: 'Create one',
    };
    // The kit opens the mode called "login". A first-time visitor should land on the form that gets them in.
    const createKey = known ? 'other' : 'login';
    const modes = known
      ? { login: { ...signin, switchTo: 'other' }, other: { ...create, switchTo: 'login' } }
      : { login: { ...create, switchTo: 'other' }, other: { ...signin, switchTo: 'login' } };

    const persona = (id, story) => {
      const [name, tenantName] = PERSONAS[id];
      return { label: `${NICHES.find((n) => n[0] === id)[1]}: ${tenantName}`, story, mode: createKey, values: { name, tenantName, email: email(id), password: freshPassword(), niche: id } };
    };
    await authPage({
      modes,
      tag: 'Bulkhead lab',
      bottom: 'Local only. Fictional data. Tokens stay in this browser tab.',
      stories: [
        { title: 'Ask for someone else’s invoice.', text: 'A second tenant is made for you. Try to read, change and delete its neighbour’s records, with a forged token or a header that claims the wrong tenant.' },
        { title: 'Pay a hundred dollars twenty times.', text: 'Race payments against one invoice, resend one payment ten times, and refund more than a team member is allowed to.' },
        { title: 'Edit the history.', text: 'Your workspace keeps a chained audit trail. See it, verify it, and read what happens when someone edits it behind the application’s back.' },
      ],
      demo: {
        title: 'Start as a business',
        subtitle: 'Fill in the form for one of five kinds of workspace',
        text: 'This only fills in the form and changes the story on the right; every tab is open to you either way.',
        label: 'Business',
        placeholder: 'Choose a business',
        options: NICHES.map((n, i) => persona(n[0], i % 3)),
        note: 'The password is generated and shown behind the eye icon. It is not stored anywhere but the database.',
      },
      onSubmit: async (mode, values) => {
        const m = modes[mode];
        const r = m.creates
          ? await window.Kit.api('/api/auth/register', { method: 'POST', auth: false, body: { email: (values.email || '').trim(), password: values.password || '', name: (values.name || '').trim(), tenantName: (values.tenantName || '').trim(), niche: values.niche || 'general' } })
          : await window.Kit.api('/api/auth/login', { method: 'POST', auth: false, body: { email: (values.email || '').trim(), password: values.password || '' } });
        if (!r.ok) throw new Error(describe(r));
        window.Kit.store.set(KNOWN_KEY, (values.email || '').trim());
        setW('B', null);
        setW('M', null);
        W.A = null;
        session.set(JSON.stringify(fromSession(r.data)));
      },
    });
  };
})();
