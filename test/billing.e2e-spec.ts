import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addMember, bearer, createApp, ownerPool, register, type Session } from './support/harness';

describe('billing: money, idempotency and concurrency', () => {
  let app: INestApplication;
  let owner: Session;
  const http = () => request(app.getHttpServer());
  const key = () => `key-${randomUUID()}`;

  const newInvoice = async (
    s: Session,
    lines = [{ description: 'Service', quantity: 1, unitPrice: '100.00' }],
    open = true,
  ) => {
    const res = await http()
      .post('/invoices')
      .set(...bearer(s))
      .set('idempotency-key', key())
      .send({ currency: 'BRL', lines })
      .expect(201);
    if (open)
      await http()
        .post(`/invoices/${res.body.id}/issue`)
        .set(...bearer(s))
        .expect(200);
    return res.body as { id: string; totalCents: number };
  };
  const pay = (s: Session, id: string, amount: string, k = key()) =>
    http()
      .post(`/invoices/${id}/payments`)
      .set(...bearer(s))
      .set('idempotency-key', k)
      .send({ amount });

  beforeAll(async () => {
    app = await createApp();
    owner = await register(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('computes totals in integer minor units: three lines of 0.10 are exactly 0.30', async () => {
    const inv = await newInvoice(owner, [{ description: 'Pen', quantity: 3, unitPrice: '0.10' }], false);
    expect(inv.totalCents).toBe(30);
    const got = await http()
      .get(`/invoices/${inv.id}`)
      .set(...bearer(owner))
      .expect(200);
    expect(got.body).toMatchObject({ total: '0.30', status: 'draft' });
    expect(got.body.lines).toHaveLength(1);
  });

  it('rejects malformed amounts and unsupported currencies', async () => {
    const bad = (unitPrice: string, currency = 'BRL') =>
      http()
        .post('/invoices')
        .set(...bearer(owner))
        .set('idempotency-key', key())
        .send({ currency, lines: [{ description: 'x', quantity: 1, unitPrice }] });
    await bad('1e3').expect(400);
    await bad('-5.00').expect(400);
    await bad('10.5555').expect(400);
    await bad('1.00', 'XXX').expect(400);
  });

  describe('idempotency', () => {
    it('requires a key on money-moving requests', async () => {
      const inv = await newInvoice(owner);
      const res = await http()
        .post(`/invoices/${inv.id}/payments`)
        .set(...bearer(owner))
        .send({ amount: '1.00' })
        .expect(400);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('a retry with the same key returns the original response and has no second effect', async () => {
      const inv = await newInvoice(owner);
      const k = key();
      const first = await pay(owner, inv.id, '30.00', k).expect(201);
      const retry = await pay(owner, inv.id, '30.00', k).expect(201);
      expect(first.headers['idempotent-replayed']).toBe('false');
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body.paymentId).toBe(first.body.paymentId);
      const after = await http()
        .get(`/invoices/${inv.id}`)
        .set(...bearer(owner))
        .expect(200);
      expect(after.body.paidCents).toBe(3000);
      expect(after.body.payments).toHaveLength(1);
    });

    it('reusing a key for a DIFFERENT request is refused', async () => {
      const inv = await newInvoice(owner);
      const k = key();
      await pay(owner, inv.id, '10.00', k).expect(201);
      const clash = await pay(owner, inv.id, '99.00', k).expect(422);
      expect(clash.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('failed attempts are not cached: the same key may be retried after a rejection', async () => {
      const inv = await newInvoice(owner);
      const k = key();
      await pay(owner, inv.id, '500.00', k).expect(422); // exceeds the balance
      await pay(owner, inv.id, '500.00', k).expect(422); // still rejected, not served from a cache
      const after = await http()
        .get(`/invoices/${inv.id}`)
        .set(...bearer(owner))
        .expect(200);
      expect(after.body.paidCents).toBe(0);
    });

    it('ten simultaneous requests with one key produce exactly one payment', async () => {
      const inv = await newInvoice(owner);
      const k = key();
      const results = await Promise.all(Array.from({ length: 10 }, () => pay(owner, inv.id, '10.00', k)));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.paymentId)).size).toBe(1);
      expect(results.filter((r) => r.headers['idempotent-replayed'] === 'false')).toHaveLength(1);
      const after = await http()
        .get(`/invoices/${inv.id}`)
        .set(...bearer(owner))
        .expect(200);
      expect(after.body.paidCents).toBe(1000);
    });

    it('keys are scoped per tenant: another tenant using the same key is a different request', async () => {
      const other = await register(app);
      const k = key();
      const mine = await newInvoice(owner);
      const theirs = await newInvoice(other);
      await pay(owner, mine.id, '10.00', k).expect(201);
      const res = await pay(other, theirs.id, '20.00', k).expect(201);
      expect(res.headers['idempotent-replayed']).toBe('false');
    });
  });

  describe('state machine and balance', () => {
    it('only open invoices accept payments; overpaying is refused; the last cent flips it to paid', async () => {
      const draft = await newInvoice(owner, undefined, false);
      const onDraft = await pay(owner, draft.id, '1.00').expect(409);
      expect(onDraft.body.error.code).toBe('INVOICE_NOT_OPEN');

      const inv = await newInvoice(owner);
      await pay(owner, inv.id, '60.00').expect(201);
      // The SPECIFIC code matters: a database CHECK constraint also answers 422 (CONSTRAINT_VIOLATION),
      // so asserting only the status would stay green if the application-level guard were deleted.
      const over = await pay(owner, inv.id, '40.01').expect(422);
      expect(over.body.error.code).toBe('EXCEEDS_BALANCE');
      const last = await pay(owner, inv.id, '40.00').expect(201);
      expect(last.body.invoice).toMatchObject({ status: 'paid', paidCents: 10000, balanceCents: 0 });
      const afterPaid = await pay(owner, inv.id, '0.01').expect(409);
      expect(afterPaid.body.error.code).toBe('INVOICE_NOT_OPEN');
    });

    it('a paid invoice cannot be voided; an unpaid one can (admins only)', async () => {
      const admin = await addMember(app, owner, 'admin');
      const member = await addMember(app, owner, 'member');
      const paid = await newInvoice(owner);
      await pay(owner, paid.id, '100.00').expect(201);
      await http()
        .post(`/invoices/${paid.id}/void`)
        .set(...bearer(admin))
        .expect(409);
      const unpaid = await newInvoice(owner);
      await http()
        .post(`/invoices/${unpaid.id}/void`)
        .set(...bearer(member))
        .expect(403);
      await http()
        .post(`/invoices/${unpaid.id}/void`)
        .set(...bearer(admin))
        .expect(200);
    });
  });

  describe('concurrency', () => {
    it('20 parallel payments of 10.00 on a 100.00 invoice: exactly 10 succeed and the total never overshoots', async () => {
      const inv = await newInvoice(owner);
      const results = await Promise.all(Array.from({ length: 20 }, () => pay(owner, inv.id, '10.00')));
      expect(results.filter((r) => r.status === 201)).toHaveLength(10);
      expect(results.filter((r) => r.status === 422 || r.status === 409)).toHaveLength(10);
      const after = await http()
        .get(`/invoices/${inv.id}`)
        .set(...bearer(owner))
        .expect(200);
      expect(after.body).toMatchObject({ status: 'paid', paidCents: 10000 });
      expect(after.body.payments).toHaveLength(10);
    });

    it('parallel refunds cannot exceed what was paid', async () => {
      const admin = await addMember(app, owner, 'admin');
      const inv = await newInvoice(owner);
      await pay(owner, inv.id, '100.00').expect(201);
      const refund = (amount: string) =>
        http()
          .post(`/invoices/${inv.id}/refunds`)
          .set(...bearer(admin))
          .set('idempotency-key', key())
          .send({ amount });
      const results = await Promise.all(Array.from({ length: 8 }, () => refund('30.00')));
      expect(results.filter((r) => r.status === 201)).toHaveLength(3); // 3 x 30.00 = 90.00 <= 100.00; a 4th would be 120.00
      const after = await http()
        .get(`/invoices/${inv.id}`)
        .set(...bearer(owner))
        .expect(200);
      expect(after.body.refundedCents).toBe(9000);
    });
  });

  describe('refund approval', () => {
    it('a member may refund up to the threshold, not above it; an admin may', async () => {
      const member = await addMember(app, owner, 'member');
      const admin = await addMember(app, owner, 'admin');
      const inv = await newInvoice(owner, [{ description: 'Big', quantity: 1, unitPrice: '500.00' }]);
      await pay(owner, inv.id, '500.00').expect(201);
      const refund = (s: Session, amount: string) =>
        http()
          .post(`/invoices/${inv.id}/refunds`)
          .set(...bearer(s))
          .set('idempotency-key', key())
          .send({ amount, reason: 'customer request' });
      await refund(member, '100.00').expect(201); // exactly the 10000-cent threshold
      const denied = await refund(member, '100.01').expect(403);
      expect(denied.body.error.code).toBe('REFUND_NEEDS_APPROVAL');
      await refund(admin, '250.00').expect(201);
      await refund(admin, '200.00').expect(422); // 150.00 left to refund
    });
  });

  it('another tenant cannot see or pay your invoice (404), and the ledger CHECK constraints back the application', async () => {
    const other = await register(app);
    const inv = await newInvoice(owner);
    await http()
      .get(`/invoices/${inv.id}`)
      .set(...bearer(other))
      .expect(404);
    expect((await pay(other, inv.id, '1.00')).status).toBe(404);
    const pool = ownerPool();
    try {
      // Even a buggy query cannot persist impossible money: the schema itself refuses it.
      await expect(
        pool.query('UPDATE invoices SET paid_cents = total_cents + 1 WHERE id = $1', [inv.id]),
      ).rejects.toThrow(/invoices_paid_within_total/);
      await expect(
        pool.query('UPDATE invoices SET refunded_cents = 1 WHERE id = $1', [inv.id]),
      ).rejects.toThrow(/invoices_refunded_within_paid/);
    } finally {
      await pool.end();
    }
  });
});
