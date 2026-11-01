import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type StoredAuditEntry, verifyChain } from '../src/modules/audit/audit-chain';
import { verifyExportSignature, type ExportEnvelope } from '../src/modules/audit/audit-export';
import { addMember, bearer, createApp, ownerPool, register, type Session } from './support/harness';

describe('audit trail', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const resource = (s: Session, name: string) =>
    http()
      .post('/resources')
      .set(...bearer(s))
      .send({ name })
      .expect(201);

  it('records who did what, in the same transaction as the change, and verifies', async () => {
    const s = await register(app);
    const made = await resource(s, 'audited');
    await http()
      .patch(`/resources/${made.body.id}`)
      .set(...bearer(s))
      .send({ version: 1, name: 'renamed' })
      .expect(200);
    const log = await http()
      .get('/audit')
      .set(...bearer(s))
      .expect(200);
    const actions = log.body.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['tenant.created', 'resource.created', 'resource.updated']),
    );
    const entry = log.body.items.find((e: { action: string }) => e.action === 'resource.created');
    expect(entry).toMatchObject({ actorId: s.userId, entityType: 'resource', entityId: made.body.id });
    const verdict = await http()
      .get('/audit/verify')
      .set(...bearer(s))
      .expect(200);
    expect(verdict.body).toMatchObject({ valid: true, checked: 3 });
  });

  it('a failed request leaves no audit entry (rolled back with the change)', async () => {
    const s = await register(app);
    const made = await resource(s, 'x');
    await http()
      .patch(`/resources/${made.body.id}`)
      .set(...bearer(s))
      .send({ version: 99, name: 'stale' })
      .expect(409);
    const log = await http()
      .get('/audit')
      .set(...bearer(s))
      .expect(200);
    expect(log.body.items.filter((e: { action: string }) => e.action === 'resource.updated')).toHaveLength(0);
  });

  it('30 simultaneous writes still form ONE valid chain: no forks, no gaps', async () => {
    const s = await register(app);
    await Promise.all(Array.from({ length: 30 }, (_, i) => resource(s, `parallel-${i}`)));
    const verdict = await http()
      .get('/audit/verify')
      .set(...bearer(s))
      .expect(200);
    expect(verdict.body).toMatchObject({ valid: true, checked: 31 }); // 30 + tenant.created
    const pool = ownerPool();
    try {
      const forks = await pool.query(
        'SELECT prev_hash FROM audit_logs WHERE tenant_id = $1 GROUP BY prev_hash HAVING count(*) > 1',
        [s.tenantId],
      );
      expect(forks.rowCount).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('detects tampering: someone with superuser rights edits a row behind the application', async () => {
    const s = await register(app);
    await resource(s, 'a');
    const second = await resource(s, 'b');
    await resource(s, 'c');
    const pool = ownerPool();
    try {
      await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable');
      await pool.query(
        `UPDATE audit_logs SET metadata = '{"name":"forged"}' WHERE tenant_id = $1 AND entity_id = $2`,
        [s.tenantId, second.body.id],
      );
      await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable');
    } finally {
      await pool.end();
    }
    const verdict = await http()
      .get('/audit/verify')
      .set(...bearer(s))
      .expect(200);
    expect(verdict.body.valid).toBe(false);
    expect(verdict.body.broken.reason).toBe('hash_mismatch');
  });

  it('the immutability trigger blocks updates even for the schema owner (until someone deliberately disables it)', async () => {
    const s = await register(app);
    const pool = ownerPool();
    try {
      await expect(
        pool.query('UPDATE audit_logs SET action = $2 WHERE tenant_id = $1', [s.tenantId, 'x']),
      ).rejects.toThrow(/append-only/);
      await expect(pool.query('DELETE FROM audit_logs WHERE tenant_id = $1', [s.tenantId])).rejects.toThrow(
        /append-only/,
      );
    } finally {
      await pool.end();
    }
  });

  it('exports a signed, self-verifying slice for an auditor (owners only)', async () => {
    const s = await register(app);
    for (let i = 0; i < 5; i++) await resource(s, `e-${i}`);
    const admin = await addMember(app, s, 'admin');
    await http()
      .get('/audit/export')
      .set(...bearer(admin))
      .expect(403);

    const res = await http()
      .get('/audit/export?limit=4')
      .set(...bearer(s))
      .expect(200);
    const envelope = res.body.envelope as ExportEnvelope;
    expect(envelope.count).toBe(4);
    expect(
      verifyExportSignature(process.env.AUDIT_EXPORT_SECRET as string, envelope, res.body.signature),
    ).toBe(true);
    expect(
      verifyExportSignature(
        process.env.AUDIT_EXPORT_SECRET as string,
        { ...envelope, count: 3 },
        res.body.signature,
      ),
    ).toBe(false);
    // The auditor re-computes the chain offline, starting from the slice's declared predecessor.
    expect(verifyChain(res.body.entries as StoredAuditEntry[], envelope.fromPrevHash).valid).toBe(true);

    const next = await http()
      .get(`/audit/export?fromSeq=${res.body.entries.at(-1).seq}`)
      .set(...bearer(s))
      .expect(200);
    expect(next.body.envelope.fromPrevHash).toBe(envelope.headHash); // slices chain together
  });

  it('only admins can read the log; entries never contain secrets', async () => {
    const s = await register(app);
    const member = await addMember(app, s, 'member');
    await http()
      .get('/audit')
      .set(...bearer(member))
      .expect(403);
    const log = await http()
      .get('/audit')
      .set(...bearer(s))
      .expect(200);
    expect(JSON.stringify(log.body)).not.toMatch(/password|accessToken|refreshToken/i);
  });
});
