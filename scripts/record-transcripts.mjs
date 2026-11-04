#!/usr/bin/env node
/**
 * Records the output shown in the landing page's tour by driving the RUNNING stack (`make up`) through its front door
 * and, for the parts a browser cannot do, through `docker compose exec db psql`. Nothing on that page is typed by hand.
 *
 *   node scripts/record-transcripts.mjs            write site/transcripts.js
 *   node scripts/record-transcripts.mjs --check    record again and fail if site/transcripts.js no longer matches
 *
 * Ids, hashes, tokens, e-mail addresses and timestamps change on every run, so they are replaced by placeholders in the
 * order they appear; what is compared is what the system *said*, not the random values it said it with.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'transcripts.js');
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.WEB_PORT ?? 8080}`;
const check = process.argv.includes('--check');

const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const uuid = () => crypto.randomUUID();
const rand = (n = 6) =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(n)),
    (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31],
  ).join('');

/** Lines of a transcript. The kit inserts a transcript as HTML, so every character is escaped when it is rendered. */
class Tape {
  #entries = [];
  #masks = [];
  say(text) {
    if (this.#entries.length > 0) this.#entries.push({ text: '' });
    this.#entries.push({ cls: 'tok-dim', text: `# ${text}` });
  }
  /** Replace every later occurrence of a secret value by a stable label. */
  mask(value, label) {
    this.#masks.push([String(value), label]);
  }
  call(request, reply, shown) {
    this.#entries.push({ cls: 'tok-k', text: `→ ${request}` });
    this.#entries.push({ cls: reply.status < 400 ? 'tok-ok' : 'tok-bad', text: `← ${reply.status}` });
    const body = shown ? shown(reply.data) : reply.data;
    this.#entries.push({ text: typeof body === 'string' ? body : JSON.stringify(body, null, 2) });
  }
  line(text, cls) {
    this.#entries.push({ cls, text });
  }
  render() {
    const seen = new Map();
    const label = (kind, value) => {
      const key = `${kind}:${value}`;
      if (!seen.has(key))
        seen.set(key, `<${kind}-${[...seen.keys()].filter((k) => k.startsWith(`${kind}:`)).length + 1}>`);
      return seen.get(key);
    };
    const normalise = (text) => {
      let out = text;
      for (const [value, name] of this.#masks) out = out.split(value).join(name);
      return out
        .replace(/[0-9a-f]{64}/g, '<hash>')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (v) => label('id', v))
        .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '<access-token>')
        .replace(/whsec_[\w-]+/g, 'whsec_<secret>')
        .replace(/[a-z0-9-]+@example\.test/g, (v) => label('email', v))
        .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>')
        .replace(/("retryAfterSeconds": )\d+/g, '$1"<seconds>"');
    };
    return this.#entries
      .map(({ cls, text }) => {
        const shown = escapeHtml(normalise(text));
        return cls ? `<span class="${cls}">${shown}</span>` : shown;
      })
      .join('\n');
  }
}

/* ------------------------------------------------------------------ talking to the stack */
async function api(path, { method = 'GET', body, token, key, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  if (key) h['idempotency-key'] = key;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep the text */
  }
  return { status: res.status, data, replayed: res.headers.get('idempotent-replayed') };
}
const ok = (r, what) => {
  if (r.status >= 400) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const refusal = (data) =>
  data && data.error
    ? {
        error: {
          code: data.error.code,
          message: data.error.message,
          ...(data.error.details ? { details: data.error.details } : {}),
        },
      }
    : data;
const pick = (obj, ...keys) =>
  Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));

async function workspace(name, niche = 'general') {
  const email = `${rand(8)}@example.test`;
  const password = `tape-${rand(14)}`;
  const data = ok(
    await api('/auth/register', {
      method: 'POST',
      body: { email, password, name, tenantName: `${name} Co`, niche },
    }),
    'register',
  );
  return { email, password, token: data.accessToken, refresh: data.refreshToken, tenant: data.tenant.id };
}
const invoice = async (w, total) => {
  const made = ok(
    await api('/invoices', {
      method: 'POST',
      token: w.token,
      key: uuid(),
      body: { currency: 'USD', lines: [{ description: 'Retainer', quantity: 1, unitPrice: total }] },
    }),
    'invoice',
  );
  ok(await api(`/invoices/${made.id}/issue`, { method: 'POST', token: w.token }), 'issue');
  return made.id;
};
const psql = (user, sql) => {
  try {
    return execFileSync(
      'docker',
      ['compose', 'exec', '-T', 'db', 'psql', '-U', user, '-d', 'app', '-X', '-q', '-c', sql],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
};
const tally = (rs, label) => {
  const counts = new Map();
  for (const r of rs) counts.set(label(r), (counts.get(label(r)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} × ${k}`);
};

/* ------------------------------------------------------------------ the five transcripts */
async function isolation() {
  const t = new Tape();
  const a = await workspace('Mariana Costa', 'restaurant');
  const b = await workspace('Tomás Okoye', 'legal');
  t.say('Two workspaces share one database. Workspace A issues an invoice.');
  const id = await invoice(a, '100.00');
  t.call('GET /api/invoices/<invoice>   (as A)', await api(`/invoices/${id}`, { token: a.token }), (d) =>
    pick(d, 'id', 'status', 'total'),
  );
  t.say('Workspace B holds that id and asks for it.');
  t.call('GET /api/invoices/<invoice>   (as B)', await api(`/invoices/${id}`, { token: b.token }), refusal);
  t.say('The answer for an id that never existed is the same, so nothing is confirmed.');
  t.call(
    'GET /api/invoices/<another id>   (as B)',
    await api(`/invoices/${uuid()}`, { token: b.token }),
    refusal,
  );
  t.say('A token with another tenant swapped in is not B’s to sign.');
  const [head, payload, sig] = a.token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  claims.tid = b.tenant;
  t.call(
    'GET /api/resources   (A’s token, B’s tenant id inside)',
    await api('/resources', {
      token: `${head}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`,
    }),
    refusal,
  );
  t.say(
    'And the database refuses on its own: the application role, connected without saying which tenant it serves.',
  );
  t.line('$ psql -U app_user -d app -c "SELECT count(*) FROM invoices"');
  t.line(psql('app_user', 'SELECT count(*) FROM invoices').trimEnd());
  return t.render();
}

async function money() {
  const t = new Tape();
  const w = await workspace('Tomás Okoye', 'legal');
  const id = await invoice(w, '100.00');
  t.say('A hundred-dollar invoice, and twenty payments of ten dollars sent together, each with its own key.');
  const rs = await Promise.all(
    Array.from({ length: 20 }, () =>
      api(`/invoices/${id}/payments`, {
        method: 'POST',
        token: w.token,
        key: uuid(),
        body: { amount: '10.00' },
      }),
    ),
  );
  t.line('→ POST /api/invoices/<invoice>/payments × 20', 'tok-k');
  t.line(tally(rs, (r) => `${r.status}${r.data?.error ? ` ${r.data.error.code}` : ''}`).join('\n'));
  t.call('GET /api/invoices/<invoice>', await api(`/invoices/${id}`, { token: w.token }), (d) =>
    pick(d, 'status', 'total', 'paidCents', 'balanceCents'),
  );

  t.say('Networks retry. The same 5.00 payment, ten times at once, with one Idempotency-Key.');
  const fresh = await invoice(w, '100.00');
  const key = uuid();
  const same = await Promise.all(
    Array.from({ length: 10 }, () =>
      api(`/invoices/${fresh}/payments`, { method: 'POST', token: w.token, key, body: { amount: '5.00' } }),
    ),
  );
  t.line('→ POST /api/invoices/<invoice>/payments × 10 (one key)', 'tok-k');
  t.line(
    tally(same, (r) => `${r.status} ${r.replayed === 'true' ? 'Idempotent-Replayed: true' : 'applied'}`).join(
      '\n',
    ),
  );
  t.call('GET /api/invoices/<invoice>', await api(`/invoices/${fresh}`, { token: w.token }), (d) =>
    pick(d, 'status', 'paidCents', 'balanceCents'),
  );
  t.say('The same key with another amount is a different request, not a retry.');
  t.call(
    'POST /api/invoices/<invoice>/payments  (same key, 6.00)',
    await api(`/invoices/${fresh}/payments`, {
      method: 'POST',
      token: w.token,
      key,
      body: { amount: '6.00' },
    }),
    refusal,
  );
  return t.render();
}

async function sessions() {
  const t = new Tape();
  const w = await workspace('Mariana Costa', 'restaurant');
  t.mask(w.refresh, '<refresh-token-1>');
  t.say('A refresh token works once. Rotating it returns a new pair.');
  const rotated = await api('/auth/refresh', { method: 'POST', body: { refreshToken: w.refresh } });
  const second = rotated.data.refreshToken;
  t.mask(second, '<refresh-token-2>');
  t.call('POST /api/auth/refresh   (refresh token 1)', rotated, (d) =>
    pick(d, 'accessToken', 'refreshToken', 'expiresIn'),
  );
  t.say('Presenting token 1 again is what a thief with an old copy does.');
  t.call(
    'POST /api/auth/refresh   (refresh token 1)',
    await api('/auth/refresh', { method: 'POST', body: { refreshToken: w.refresh } }),
    refusal,
  );
  t.say('The whole family of tokens went with it, the owner’s newest one included.');
  t.call(
    'POST /api/auth/refresh   (refresh token 2)',
    await api('/auth/refresh', { method: 'POST', body: { refreshToken: second } }),
    refusal,
  );

  t.say('Twelve wrong passwords against an account, one after another.');
  const guesses = [];
  for (let i = 1; i <= 12; i += 1)
    guesses.push(
      await api('/auth/login', { method: 'POST', body: { email: w.email, password: `wrong-guess-${i}` } }),
    );
  t.line('→ POST /api/auth/login × 12', 'tok-k');
  t.line(tally(guesses, (r) => `${r.status}${r.data?.error ? ` ${r.data.error.code}` : ''}`).join('\n'));
  t.say('The limit counts attempts, not outcomes: now even the right password waits.');
  t.call(
    'POST /api/auth/login   (the right password)',
    await api('/auth/login', { method: 'POST', body: { email: w.email, password: w.password } }),
    refusal,
  );
  return t.render();
}

async function webhooks() {
  const t = new Tape();
  const w = await workspace('Tomás Okoye', 'legal');
  t.say(
    'A tenant registers a URL the platform will call from inside its own network. Every way of writing a private address is refused.',
  );
  for (const url of [
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://[::1]/',
    'http://localhost/',
    'http://user:pass@203.0.113.7/',
    'https://hooks.example.invalid/in',
  ]) {
    const r = await api('/webhook-endpoints', { method: 'POST', token: w.token, body: { url } });
    t.line(`→ POST /api/webhook-endpoints   ${JSON.stringify({ url })}`, 'tok-k');
    t.line(`← ${r.status} ${r.data?.error?.code ?? 'accepted'}`, r.status < 400 ? 'tok-ok' : 'tok-bad');
  }
  t.say(
    'A documentation address is public as far as the guard can tell, but nothing answers. It is accepted, and the secret is shown once.',
  );
  const endpoint = await api('/webhook-endpoints', {
    method: 'POST',
    token: w.token,
    body: { url: 'https://203.0.113.7/hook' },
  });
  t.call('POST /api/webhook-endpoints   {"url": "https://203.0.113.7/hook"}', endpoint, (d) =>
    pick(d, 'id', 'url', 'active', 'secret'),
  );
  t.say('A change writes its event in the same transaction. The separate worker claims it and tries.');
  ok(
    await api('/resources', { method: 'POST', token: w.token, body: { name: 'Triggers an event' } }),
    'resource',
  );
  let rows = [];
  for (let i = 0; i < 40 && !rows.some((r) => r.attempts >= 1); i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    rows = (await api(`/webhook-endpoints/${endpoint.data.id}/deliveries`, { token: w.token })).data;
  }
  t.call('GET /api/webhook-endpoints/<endpoint>/deliveries', { status: 200, data: rows }, (d) =>
    d.map((r) => pick(r, 'topic', 'status', 'attempts')),
  );
  return t.render();
}

async function audit() {
  const t = new Tape();
  const w = await workspace('Tomás Okoye', 'legal');
  const id = await invoice(w, '10.00');
  ok(
    await api(`/invoices/${id}/payments`, {
      method: 'POST',
      token: w.token,
      key: uuid(),
      body: { amount: '10.00' },
    }),
    'payment',
  );
  t.say(
    'A workspace issues an invoice and takes a payment of 10.00. Each step is a row in its audit trail, and each row signs the one before it.',
  );
  t.call('GET /api/audit/verify', await api('/audit/verify', { token: w.token }));
  const rows = (await api('/audit?limit=50', { token: w.token })).data.items;
  const seq = rows.find((r) => r.action === 'payment.recorded').seq;
  t.say('Someone with the database owner’s role tries to make the payment look like 1.00.');
  const edit = (n) =>
    `UPDATE audit_logs SET metadata = '{"amountCents": 100}' WHERE tenant_id = '${w.tenant}' AND seq = ${n};`;
  t.line(`$ psql -U postgres -d app -c "${edit('<seq>')}"`);
  t.line(psql('postgres', edit(seq)).trimEnd());
  t.say('So they switch the guard off, edit, and switch it back on.');
  t.line(
    '$ psql -U postgres -d app -c "ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable;" -c "UPDATE …" -c "ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable;"',
  );
  psql('postgres', 'ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable');
  psql('postgres', edit(seq));
  psql('postgres', 'ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable');
  t.say('The application does not trust the table; it checks the chain, and names the row.');
  const after = await api('/audit/verify', { token: w.token });
  t.call('GET /api/audit/verify', {
    ...after,
    data: { ...after.data, broken: after.data.broken && { ...after.data.broken, seq: '<seq>' } },
  });
  return t.render();
}

/* ------------------------------------------------------------------ main */
const transcripts = {
  isolation: await isolation(),
  money: await money(),
  sessions: await sessions(),
  webhooks: await webhooks(),
  audit: await audit(),
};
const file = `/* Recorded from the running stack by scripts/record-transcripts.mjs. Do not edit: CI records again and compares. */\nwindow.TRANSCRIPTS = ${JSON.stringify(transcripts, null, 2)};\n`;
if (check) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== file) {
    const names = Object.keys(transcripts).filter((k) => !current.includes(JSON.stringify(transcripts[k])));
    console.error(
      `site/transcripts.js is out of date for: ${names.join(', ') || '(formatting)'}. Run: node scripts/record-transcripts.mjs`,
    );
    process.exit(1);
  }
  console.log('transcripts match what the stack says');
} else {
  writeFileSync(OUT, file);
  console.log(`wrote ${OUT}`);
}
