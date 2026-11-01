import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { verifySignature } from '../src/common/crypto/signature';
import { OutboxWorker } from '../src/modules/outbox/outbox.worker';
import { bearer, createApp, ownerPool, register, startReceiver, type Session } from './support/harness';

/** Leftovers from earlier runs share this database; park them so a batch only ever contains this run's events. */
async function parkStaleEvents(): Promise<void> {
  const pool = ownerPool();
  try {
    await pool.query("UPDATE outbox_events SET status = 'dead' WHERE status = 'pending'");
  } finally {
    await pool.end();
  }
}

describe('transactional outbox and signed webhook delivery', () => {
  let app: INestApplication;
  let worker: OutboxWorker;
  let owner: Session;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await parkStaleEvents();
    app = await createApp({ OUTBOX_MAX_ATTEMPTS: '3' });
    worker = app.get(OutboxWorker);
    owner = await register(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const endpoint = async (s: Session, url: string) =>
    (
      await http()
        .post('/webhook-endpoints')
        .set(...bearer(s))
        .send({ url })
        .expect(201)
    ).body as { id: string; secret: string };
  const makeResource = (s: Session, name = randomUUID()) =>
    http()
      .post('/resources')
      .set(...bearer(s))
      .send({ name })
      .expect(201);
  const rowsFor = async (endpointId: string) => {
    const pool = ownerPool();
    try {
      return (
        await pool.query('SELECT * FROM outbox_events WHERE endpoint_id = $1 ORDER BY created_at', [
          endpointId,
        ])
      ).rows;
    } finally {
      await pool.end();
    }
  };
  const makeDue = async (endpointId: string) => {
    const pool = ownerPool();
    try {
      await pool.query(
        "UPDATE outbox_events SET next_attempt_at = now() - interval '1 second' WHERE endpoint_id = $1 AND status = 'pending'",
        [endpointId],
      );
    } finally {
      await pool.end();
    }
  };

  it('delivers a signed event that the receiver can verify with the secret it was given once', async () => {
    const receiver = await startReceiver();
    try {
      const ep = await endpoint(owner, receiver.url);
      const made = await makeResource(owner);
      const result = await worker.tick();
      expect(result.delivered).toBeGreaterThanOrEqual(1);

      expect(receiver.received).toHaveLength(1);
      const hit = receiver.received[0]!;
      expect(() =>
        verifySignature(hit.headers['x-signature'] as string, Buffer.from(hit.body), [ep.secret]),
      ).not.toThrow();
      expect(() =>
        verifySignature(hit.headers['x-signature'] as string, Buffer.from(hit.body), ['whsec_wrong']),
      ).toThrow();
      const payload = JSON.parse(hit.body);
      expect(payload).toMatchObject({ topic: 'resource.created', data: { id: made.body.id } });
      expect(hit.headers['x-event-id']).toBe(payload.id);
    } finally {
      await receiver.close();
    }
  });

  it('encrypts the signing secret at rest and never returns it again', async () => {
    const receiver = await startReceiver();
    try {
      const ep = await endpoint(owner, receiver.url);
      const pool = ownerPool();
      try {
        const { rows } = await pool.query('SELECT secret FROM webhook_endpoints WHERE id = $1', [ep.id]);
        expect(rows[0].secret).toMatch(/^v1\./);
        expect(rows[0].secret).not.toContain(ep.secret);
      } finally {
        await pool.end();
      }
      const list = await http()
        .get('/webhook-endpoints')
        .set(...bearer(owner))
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain(ep.secret);
    } finally {
      await receiver.close();
    }
  });

  it('retries with backoff after a failure and succeeds once the receiver recovers', async () => {
    const receiver = await startReceiver((_r, n) => (n === 1 ? 500 : 200));
    try {
      const s = await register(app);
      const ep = await endpoint(s, receiver.url);
      await makeResource(s);

      await worker.tick();
      let [row] = await rowsFor(ep.id);
      expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'HTTP 500' });
      expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now()); // backed off, not hammered

      await worker.tick(); // nothing is due yet
      expect(receiver.received).toHaveLength(1);

      await makeDue(ep.id);
      await worker.tick();
      [row] = await rowsFor(ep.id);
      expect(row).toMatchObject({ status: 'delivered', attempts: 2, last_error: null });
      expect(receiver.received).toHaveLength(2);
      expect(receiver.received[1]!.headers['x-event-id']).toBe(receiver.received[0]!.headers['x-event-id']); // same id across retries
    } finally {
      await receiver.close();
    }
  });

  it('gives up after the maximum attempts and parks the event as dead (visible to the tenant)', async () => {
    const receiver = await startReceiver(() => 503);
    try {
      const s = await register(app);
      const ep = await endpoint(s, receiver.url);
      await makeResource(s);
      for (let i = 0; i < 4; i++) {
        await makeDue(ep.id);
        await worker.tick();
      }
      const [row] = await rowsFor(ep.id);
      expect(row).toMatchObject({ status: 'dead', attempts: 3 });
      expect(receiver.received).toHaveLength(3);
      const deliveries = await http()
        .get(`/webhook-endpoints/${ep.id}/deliveries`)
        .set(...bearer(s))
        .expect(200);
      expect(deliveries.body[0]).toMatchObject({ status: 'dead', lastError: 'HTTP 503' });
    } finally {
      await receiver.close();
    }
  });

  it('two workers running at the same time deliver every event exactly once', async () => {
    const receiver = await startReceiver();
    try {
      const s = await register(app);
      const ep = await endpoint(s, receiver.url);
      for (let i = 0; i < 12; i++) await makeResource(s);
      await Promise.all([worker.tick(), worker.tick(), worker.tick()]);
      const ids = receiver.received.map((r) => r.headers['x-event-id']);
      expect(ids).toHaveLength(12);
      expect(new Set(ids).size).toBe(12);
      expect((await rowsFor(ep.id)).every((r) => r.status === 'delivered')).toBe(true);
    } finally {
      await receiver.close();
    }
  });

  it('a crashed worker does not lose events: an expired lease makes the row due again', async () => {
    const receiver = await startReceiver();
    try {
      const s = await register(app);
      const ep = await endpoint(s, receiver.url);
      await makeResource(s);
      const pool = ownerPool();
      try {
        // Simulate a claim by a worker that then died: attempts bumped, lease in the future...
        await pool.query(
          "UPDATE outbox_events SET attempts = 1, next_attempt_at = now() + interval '30 seconds' WHERE endpoint_id = $1",
          [ep.id],
        );
        await worker.tick();
        expect(receiver.received).toHaveLength(0); // ...so nobody else touches it while the lease is live
        await pool.query(
          "UPDATE outbox_events SET next_attempt_at = now() - interval '1 second' WHERE endpoint_id = $1",
          [ep.id],
        ); // lease expired
      } finally {
        await pool.end();
      }
      await worker.tick();
      expect(receiver.received).toHaveLength(1);
    } finally {
      await receiver.close();
    }
  });

  it('events fan out only to the tenant that caused them', async () => {
    const mine = await startReceiver();
    const theirs = await startReceiver();
    try {
      const a = await register(app);
      const b = await register(app);
      await endpoint(a, mine.url);
      await endpoint(b, theirs.url);
      await makeResource(a);
      await worker.tick();
      expect(mine.received).toHaveLength(1);
      expect(theirs.received).toHaveLength(0);
      const epB = (
        await http()
          .get('/webhook-endpoints')
          .set(...bearer(b))
          .expect(200)
      ).body[0];
      await http()
        .get(`/webhook-endpoints/${epB.id}/deliveries`)
        .set(...bearer(a))
        .expect(404);
    } finally {
      await mine.close();
      await theirs.close();
    }
  });

  it('the ping endpoint exercises the whole pipeline', async () => {
    const receiver = await startReceiver();
    try {
      const s = await register(app);
      const ep = await endpoint(s, receiver.url);
      await http()
        .post(`/webhook-endpoints/${ep.id}/ping`)
        .set(...bearer(s))
        .expect(202);
      await worker.tick();
      expect(JSON.parse(receiver.received[0]!.body).topic).toBe('ping');
    } finally {
      await receiver.close();
    }
  });

  it('endpoint management is for admins only', async () => {
    const s = await register(app);
    await http().get('/webhook-endpoints').expect(401);
    const res = await http()
      .post('/webhook-endpoints')
      .set(...bearer(s))
      .send({ url: 'not a url' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('SSRF protection (production-like configuration)', () => {
  let app: INestApplication;
  let owner: Session;

  beforeAll(async () => {
    await parkStaleEvents();
    app = await createApp({ ALLOW_PRIVATE_WEBHOOK_TARGETS: 'false' });
    owner = await register(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([
    'http://127.0.0.1:8080/hook',
    'http://localhost/hook',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5/x',
    'http://[::1]/x',
    'ftp://example.com/x',
  ])('refuses to register %s', async (url) => {
    const res = await request(app.getHttpServer())
      .post('/webhook-endpoints')
      .set(...bearer(owner))
      .send({ url });
    expect([400]).toContain(res.status);
    expect(res.body.error.code).toMatch(/UNSAFE_TARGET|VALIDATION_FAILED/);
  });

  it('a host name that does not exist is a 400 the client can act on, never a 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhook-endpoints')
      .set(...bearer(owner))
      .send({ url: 'https://hooks.example.invalid/in' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNRESOLVABLE_TARGET');
  });

  it('re-checks at delivery time: an endpoint that is private by then is never contacted', async () => {
    const receiver = await startReceiver();
    try {
      const permissive = await createApp({ ALLOW_PRIVATE_WEBHOOK_TARGETS: 'true' });
      const s = await register(permissive);
      const ep = (
        await request(permissive.getHttpServer())
          .post('/webhook-endpoints')
          .set(...bearer(s))
          .send({ url: receiver.url })
          .expect(201)
      ).body;
      await request(permissive.getHttpServer())
        .post('/resources')
        .set(...bearer(s))
        .send({ name: 'x' })
        .expect(201);
      await permissive.close();

      // Same database, strict app: the stored (private) URL must be refused when the worker runs.
      const strictWorker = app.get(OutboxWorker);
      const result = await strictWorker.tick();
      const pool = ownerPool();
      try {
        const { rows } = await pool.query(
          'SELECT status, last_error FROM outbox_events WHERE endpoint_id = $1',
          [ep.id],
        );
        expect(rows[0].last_error).toMatch(/non-public address/);
        expect(result.delivered).toBe(0);
      } finally {
        await pool.end();
      }
      expect(receiver.received).toHaveLength(0);
    } finally {
      await receiver.close();
    }
  });
});
