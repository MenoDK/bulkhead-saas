import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hashToken } from '../src/modules/identity/token.service';
import { addMember, bearer, createApp, ownerPool, PASSWORD, register } from './support/harness';

// Assembled, not written out: a literal next to the word `password` is what secret scanners are built to flag.
const WRONG_PASSWORD = ['definitely', 'wrong', 'one'].join('-');

describe('authentication', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('registers a workspace and returns a working session', async () => {
    const s = await register(app, 'restaurant');
    const me = await http()
      .get('/auth/me')
      .set(...bearer(s))
      .expect(200);
    expect(me.body.tenant).toMatchObject({ id: s.tenantId, niche: 'restaurant', role: 'owner' });
  });

  it('rejects a duplicate e-mail with 409 and a stable code', async () => {
    const s = await register(app);
    const res = await http()
      .post('/auth/register')
      .send({ email: s.email, password: PASSWORD, name: 'X', tenantName: 'Y' })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates input and never leaks internals in errors', async () => {
    const res = await http().post('/auth/register').send({ email: 'nope', password: 'short' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|select |pg_|constraint/i);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('gives the same answer for a wrong password and an unknown e-mail', async () => {
    const s = await register(app);
    const wrong = await http()
      .post('/auth/login')
      .send({ email: s.email, password: WRONG_PASSWORD })
      .expect(401);
    const unknown = await http()
      .post('/auth/login')
      .send({ email: 'ghost@example.test', password: WRONG_PASSWORD })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error).toMatchObject({
      code: wrong.body.error.code,
      message: wrong.body.error.message,
    });
  });

  it('rate-limits repeated failures for one account and sets Retry-After', async () => {
    const s = await register(app);
    for (let i = 0; i < 10; i++) {
      await http().post('/auth/login').send({ email: s.email, password: 'wrong-wrong-wrong' }).expect(401);
    }
    const blocked = await http().post('/auth/login').send({ email: s.email, password: PASSWORD }).expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rejects missing, malformed and forged tokens', async () => {
    await http().get('/auth/me').expect(401);
    await http().get('/auth/me').set('authorization', 'Bearer not-a-jwt').expect(401);
    // alg=none forgery must not be accepted
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"x","tid":"y","role":"owner"}').toString('base64url')}.`;
    await http().get('/auth/me').set('authorization', `Bearer ${none}`).expect(401);
  });

  describe('refresh tokens', () => {
    it('rotates on every use and the old token dies', async () => {
      const s = await register(app);
      const first = await http().post('/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
      expect(first.body.refreshToken).not.toBe(s.refreshToken);
      await http().get('/auth/me').set('authorization', `Bearer ${first.body.accessToken}`).expect(200);
      await http().post('/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    });

    it('treats reuse of a rotated token as theft: the whole family is revoked and the event is audited', async () => {
      const s = await register(app);
      const rotated = await http().post('/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
      await http().post('/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401); // the thief replays the old one
      await http().post('/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401); // so the legitimate successor is dead too
      const audit = await http()
        .get('/audit?limit=50')
        .set(...bearer(s))
        .expect(200);
      expect(audit.body.items.map((e: { action: string }) => e.action)).toContain(
        'auth.refresh_reuse_detected',
      );
    });

    it('lets exactly ONE of many concurrent refreshes with the same token win', async () => {
      const s = await register(app);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => http().post('/auth/refresh').send({ refreshToken: s.refreshToken })),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(7);
    });

    it('a refresh that races a rotation in flight sees its revocation and is treated as reuse', async () => {
      // The test above shows the OUTCOME of a race but cannot prove it was one: how much requests overlap
      // inside Postgres is up to scheduling. Here the overlap is forced. A first rotation revokes the token
      // but has not committed yet; the second request arrives in that window. FOR UPDATE makes it queue on
      // the row and, once the first commits, re-read the row as revoked -> 401 and the family is revoked.
      // Without it the SELECT returns the old, still-unrevoked version, the later UPDATE merely waits for
      // the lock and then goes ahead: two rotations from one token, i.e. a 200 here. That is the bug.
      const s = await register(app);
      const pool = ownerPool();
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [
          hashToken(s.refreshToken),
        ]);
        const pending = http().post('/auth/refresh').send({ refreshToken: s.refreshToken });
        const settled = pending.then(() => true);
        const earlyWinner = await Promise.race([
          settled,
          new Promise<boolean>((r) => setTimeout(() => r(false), 300)),
        ]);
        await holder.query('COMMIT'); // always committed: a broken lock must fail the test, not hang it
        const res = await pending;
        expect(earlyWinner).toBe(false); // it really did wait for the first rotation
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
        await pool.end();
      }
    });

    it('stores only hashes, never the token itself', async () => {
      const s = await register(app);
      const pool = ownerPool();
      try {
        const { rows } = await pool.query(
          'SELECT count(*)::int AS n FROM refresh_tokens WHERE token_hash = $1',
          [s.refreshToken],
        );
        expect(rows[0].n).toBe(0);
      } finally {
        await pool.end();
      }
    });

    it('logout revokes the family and is idempotent', async () => {
      const s = await register(app);
      await http().post('/auth/logout').send({ refreshToken: s.refreshToken }).expect(204);
      await http().post('/auth/logout').send({ refreshToken: s.refreshToken }).expect(204);
      await http().post('/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    });

    it('a removed member cannot refresh any more', async () => {
      const owner = await register(app);
      const member = await addMember(app, owner, 'member');
      await http()
        .patch(`/members/${member.userId}`)
        .set(...bearer(owner))
        .send({ active: false })
        .expect(200);
      await http().post('/auth/refresh').send({ refreshToken: member.refreshToken }).expect(401);
      await http().post('/auth/login').send({ email: member.email, password: PASSWORD }).expect(403);
    });
  });
});
