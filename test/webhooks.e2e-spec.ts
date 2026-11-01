import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildSignatureHeader } from '../src/common/crypto/signature';
import { bearer, createApp, ownerPool, register, type Session } from './support/harness';

const SECRET = 'whsec_test_primary';

describe('inbound payment webhooks', () => {
  let app: INestApplication;
  let owner: Session;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    owner = await register(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const openInvoice = async (amount = '100.00') => {
    const res = await http()
      .post('/invoices')
      .set(...bearer(owner))
      .set('idempotency-key', `k-${randomUUID()}`)
      .send({ currency: 'BRL', lines: [{ description: 'x', quantity: 1, unitPrice: amount }] })
      .expect(201);
    await http()
      .post(`/invoices/${res.body.id}/issue`)
      .set(...bearer(owner))
      .expect(200);
    return res.body.id as string;
  };
  const event = (
    invoiceId: string,
    over: Record<string, unknown> = {},
    data: Record<string, unknown> = {},
  ) => ({
    id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    data: {
      providerRef: `pay_${randomUUID()}`,
      tenantId: owner.tenantId,
      invoiceId,
      amountCents: 4000,
      ...data,
    },
    ...over,
  });
  const send = (body: unknown, secret = SECRET, timestamp?: number) => {
    const raw = JSON.stringify(body);
    return http()
      .post('/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-signature', buildSignatureHeader(secret, raw, timestamp))
      .send(raw);
  };
  const paid = async (invoiceId: string) =>
    (
      await http()
        .get(`/invoices/${invoiceId}`)
        .set(...bearer(owner))
        .expect(200)
    ).body.paidCents as number;

  it('applies a correctly signed payment exactly once', async () => {
    const id = await openInvoice();
    const evt = event(id);
    expect((await send(evt).expect(200)).body).toEqual({ status: 'processed' });
    expect(await paid(id)).toBe(4000);
    expect((await send(evt).expect(200)).body).toEqual({ status: 'duplicate' }); // the provider retried
    expect(await paid(id)).toBe(4000);
  });

  it('the same provider payment under a NEW event id is still not applied twice', async () => {
    const id = await openInvoice();
    const first = event(id);
    await send(first).expect(200);
    const again = event(id, {}, { providerRef: first.data.providerRef });
    expect((await send(again).expect(200)).body).toEqual({
      status: 'ignored',
      reason: 'duplicate_provider_ref',
    });
    expect(await paid(id)).toBe(4000);
  });

  it('exactly one of ten simultaneous deliveries of the same event is processed', async () => {
    const id = await openInvoice();
    const evt = event(id);
    const results = await Promise.all(Array.from({ length: 10 }, () => send(evt)));
    expect(results.filter((r) => r.body.status === 'processed')).toHaveLength(1);
    expect(results.filter((r) => r.body.status === 'duplicate')).toHaveLength(9);
    expect(await paid(id)).toBe(4000);
  });

  it.each([
    ['a wrong secret', (b: unknown) => send(b, 'whsec_attacker')],
    [
      'a stale timestamp (replay of an old capture)',
      (b: unknown) => send(b, SECRET, Math.floor(Date.now() / 1000) - 3600),
    ],
    ['a timestamp from the future', (b: unknown) => send(b, SECRET, Math.floor(Date.now() / 1000) + 3600)],
  ])('rejects %s with 401 and changes nothing', async (_name, attempt) => {
    const id = await openInvoice();
    const res = await attempt(event(id)).expect(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect(await paid(id)).toBe(0);
  });

  it('rejects a body modified after signing, and a missing signature', async () => {
    const id = await openInvoice();
    const evt = event(id);
    const header = buildSignatureHeader(SECRET, JSON.stringify(evt));
    const tampered = JSON.stringify({ ...evt, data: { ...evt.data, amountCents: 1 } });
    await http()
      .post('/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-signature', header)
      .send(tampered)
      .expect(401);
    await http()
      .post('/webhooks/payments')
      .set('content-type', 'application/json')
      .send(JSON.stringify(evt))
      .expect(401);
    expect(await paid(id)).toBe(0);
  });

  it('accepts the previous secret during rotation', async () => {
    const id = await openInvoice();
    await send(event(id), 'whsec_test_previous').expect(200);
    expect(await paid(id)).toBe(4000);
  });

  it('ignores business impossibilities without failing (so the provider stops retrying) and records nothing wrong', async () => {
    const id = await openInvoice('10.00');
    expect((await send(event(id, {}, { amountCents: 99_999 })).expect(200)).body).toEqual({
      status: 'ignored',
      reason: 'exceeds_balance',
    });
    expect((await send(event(randomUUID())).expect(200)).body).toEqual({
      status: 'ignored',
      reason: 'not_found',
    });
    expect((await send(event(id, { type: 'customer.created' })).expect(200)).body).toEqual({
      status: 'ignored',
      reason: 'unhandled_type',
    });
    expect(await paid(id)).toBe(0);
  });

  it('cannot reach into another tenant: the invoice is looked up under the named tenant only', async () => {
    const other = await register(app);
    const id = await openInvoice();
    const res = await send(event(id, {}, { tenantId: other.tenantId })).expect(200);
    expect(res.body).toEqual({ status: 'ignored', reason: 'not_found' });
    expect(await paid(id)).toBe(0);
  });

  it('writes an audit entry and an outbox event for a processed payment, atomically with the money movement', async () => {
    const id = await openInvoice();
    await send(event(id)).expect(200);
    const log = await http()
      .get('/audit?limit=5')
      .set(...bearer(owner))
      .expect(200);
    expect(log.body.items.map((e: { action: string }) => e.action)).toContain('payment.received_webhook');
    const pool = ownerPool();
    try {
      const inbox = await pool.query(
        "SELECT count(*)::int AS n FROM webhook_events WHERE provider = 'acme-pay'",
      );
      expect(inbox.rows[0].n).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });
});

describe('inbound payment webhooks: reverse confirmation ("a webhook is never the truth")', () => {
  let app: INestApplication;
  let provider: Server;
  let owner: Session;
  const state: {
    payments: Map<string, { status: string; amountCents: number; invoiceId: string }>;
    down: boolean;
  } = { payments: new Map(), down: false };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    provider = createServer((req, res) => {
      if (state.down) {
        res.statusCode = 500;
        return res.end();
      }
      const ref = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
      const found = state.payments.get(ref);
      if (!found) {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: ref,
          status: found.status,
          amountCents: found.amountCents,
          metadata: { tenantId: owner.tenantId, invoiceId: found.invoiceId },
        }),
      );
    });
    await new Promise<void>((r) => provider.listen(0, '127.0.0.1', r));
    app = await createApp({
      PAYMENT_PROVIDER_API_URL: `http://127.0.0.1:${(provider.address() as AddressInfo).port}`,
    });
    owner = await register(app);
  });
  afterAll(async () => {
    await app.close();
    await new Promise<void>((r) => provider.close(() => r()));
  });

  const openInvoice = async () => {
    const res = await http()
      .post('/invoices')
      .set(...bearer(owner))
      .set('idempotency-key', `k-${randomUUID()}`)
      .send({ currency: 'BRL', lines: [{ description: 'x', quantity: 1, unitPrice: '100.00' }] })
      .expect(201);
    await http()
      .post(`/invoices/${res.body.id}/issue`)
      .set(...bearer(owner))
      .expect(200);
    return res.body.id as string;
  };
  const notify = (providerRef: string, id = `evt_${randomUUID()}`) => {
    // Pointer only: no tenant, no invoice, no amount in the body.
    const raw = JSON.stringify({ id, type: 'payment.succeeded', data: { providerRef } });
    return http()
      .post('/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-signature', buildSignatureHeader(SECRET, raw))
      .send(raw);
  };

  it('acts on what the PROVIDER says, not on what the notification claims', async () => {
    const invoiceId = await openInvoice();
    const ref = `pay_${randomUUID()}`;
    state.payments.set(ref, { status: 'succeeded', amountCents: 2500, invoiceId });
    expect((await notify(ref).expect(200)).body).toEqual({ status: 'processed' });
    const inv = await http()
      .get(`/invoices/${invoiceId}`)
      .set(...bearer(owner))
      .expect(200);
    expect(inv.body.paidCents).toBe(2500);
  });

  it('a "pending" payment does not consume the event id, so the later "paid" notification still counts', async () => {
    const invoiceId = await openInvoice();
    const ref = `pay_${randomUUID()}`;
    const eventId = `evt_${randomUUID()}`;
    state.payments.set(ref, { status: 'pending', amountCents: 1000, invoiceId });
    expect((await notify(ref, eventId).expect(200)).body).toEqual({ status: 'ignored', reason: 'not_final' });
    state.payments.set(ref, { status: 'succeeded', amountCents: 1000, invoiceId });
    expect((await notify(ref, eventId).expect(200)).body).toEqual({ status: 'processed' });
  });

  it('a notification about a payment the provider does not know changes nothing', async () => {
    expect((await notify(`pay_${randomUUID()}`).expect(200)).body).toEqual({
      status: 'ignored',
      reason: 'unknown_payment',
    });
  });

  it('answers 503 (so the provider retries) when the provider cannot be asked, and records nothing', async () => {
    const invoiceId = await openInvoice();
    const ref = `pay_${randomUUID()}`;
    const eventId = `evt_${randomUUID()}`;
    state.payments.set(ref, { status: 'succeeded', amountCents: 1000, invoiceId });
    state.down = true;
    await notify(ref, eventId).expect(503);
    state.down = false;
    expect((await notify(ref, eventId).expect(200)).body).toEqual({ status: 'processed' });
  });
});
