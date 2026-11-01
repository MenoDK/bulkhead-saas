import { type INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { IS_PUBLIC, ROLES_KEY } from '../src/common/auth';
import { migrate } from '../src/database/migrator';
import {
  addMember,
  appRolePool,
  bearer,
  createApp,
  ownerPool,
  register,
  type Session,
} from './support/harness';

describe('tenant isolation and object-level authorization', () => {
  let app: INestApplication;
  let a: Session;
  let b: Session;
  const http = () => request(app.getHttpServer());
  const create = (s: Session, name: string) =>
    http()
      .post('/resources')
      .set(...bearer(s))
      .send({ name, data: { sku: name } });

  beforeAll(async () => {
    app = await createApp();
    a = await register(app);
    b = await register(app);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('across tenants (BOLA / IDOR)', () => {
    it("another tenant's record is invisible: GET, PATCH and DELETE all answer 404, never 403", async () => {
      const made = await create(a, 'secret-plan').expect(201);
      const id = made.body.id as string;
      await http()
        .get(`/resources/${id}`)
        .set(...bearer(b))
        .expect(404);
      await http()
        .patch(`/resources/${id}`)
        .set(...bearer(b))
        .send({ version: 1, name: 'pwned' })
        .expect(404);
      await http()
        .delete(`/resources/${id}`)
        .set(...bearer(b))
        .expect(404);
      const list = await http()
        .get('/resources')
        .set(...bearer(b))
        .expect(200);
      expect(list.body.items.map((r: { id: string }) => r.id)).not.toContain(id);
      const still = await http()
        .get(`/resources/${id}`)
        .set(...bearer(a))
        .expect(200);
      expect(still.body.name).toBe('secret-plan');
    });

    it('the tenant comes from the verified token, never from the request', async () => {
      const res = await http()
        .post('/resources')
        .set(...bearer(a))
        .send({ name: 'x', tenantId: b.tenantId, tenant_id: b.tenantId })
        .expect(201);
      const seen = await http()
        .get(`/resources/${res.body.id}`)
        .set(...bearer(b))
        .expect(404);
      expect(seen.status).toBe(404);
    });

    it('every boot re-asserts that the runtime role cannot bypass row-level security', async () => {
      // BYPASSRLS would switch every policy off for that role, FORCE ROW LEVEL SECURITY included. The
      // migrator therefore resets the role's attributes on each run, so a manual grant does not outlive
      // the next deploy. Checked here against the real catalog.
      const owner = ownerPool();
      try {
        await owner.query('ALTER ROLE app_user BYPASSRLS');
        await migrate({
          ownerUrl: process.env.MIGRATION_DATABASE_URL as string,
          appRolePassword: process.env.APP_DB_PASSWORD as string,
        });
        const { rows } = await owner.query(
          "SELECT rolbypassrls, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'app_user'",
        );
        expect(rows[0]).toEqual({
          rolbypassrls: false,
          rolsuper: false,
          rolcreaterole: false,
          rolcreatedb: false,
        });
      } finally {
        await owner.query('ALTER ROLE app_user NOBYPASSRLS');
        await owner.end();
      }
    });

    it('row-level security holds even for hand-written SQL as the runtime role', async () => {
      await create(a, 'rls-a').expect(201);
      await create(b, 'rls-b').expect(201);
      const owner = ownerPool();
      const runtime = appRolePool();
      try {
        const total = await owner.query('SELECT count(*)::int AS n FROM resources'); // owner/superuser bypasses RLS
        expect(total.rows[0].n).toBeGreaterThanOrEqual(2);

        // No tenant context => the runtime role sees NOTHING (fail closed), not "everything".
        const blind = await runtime.query('SELECT count(*)::int AS n FROM resources');
        expect(blind.rows[0].n).toBe(0);

        const client = await runtime.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [a.tenantId]);
          const mine = await client.query('SELECT DISTINCT tenant_id FROM resources');
          expect(mine.rows.map((r) => r.tenant_id)).toEqual([a.tenantId]);
          // Writing a row that belongs to another tenant is rejected by the policy's WITH CHECK.
          await expect(
            client.query("INSERT INTO resources (tenant_id, name, created_by) VALUES ($1, 'evil', $2)", [
              b.tenantId,
              a.userId,
            ]),
          ).rejects.toThrow(/row-level security/);
          await client.query('ROLLBACK');

          await client.query('BEGIN');
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [a.tenantId]);
          const touched = await client.query("UPDATE resources SET name = 'hacked' WHERE tenant_id = $1", [
            b.tenantId,
          ]);
          expect(touched.rowCount).toBe(0);
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      } finally {
        await owner.end();
        await runtime.end();
      }
    });

    it('the tenant context does not leak between requests that reuse a pooled connection', async () => {
      // Interleave many requests from both tenants over a small pool; each must only ever see its own data.
      await create(a, 'leak-a').expect(201);
      await create(b, 'leak-b').expect(201);
      const answers = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          http()
            .get('/resources?limit=100')
            .set(...bearer(i % 2 ? a : b)),
        ),
      );
      answers.forEach((res, i) => {
        const names = res.body.items.map((r: { name: string }) => r.name);
        expect(names.some((n: string) => n.endsWith(i % 2 ? '-b' : '-a'))).toBe(false);
      });
    });

    it('audit data is isolated and append-only even for the runtime role', async () => {
      const runtime = appRolePool();
      try {
        await expect(runtime.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(
          /permission denied/,
        );
        await expect(runtime.query('DELETE FROM audit_logs')).rejects.toThrow(/permission denied/);
        await expect(runtime.query('TRUNCATE audit_logs')).rejects.toThrow(/permission denied/);
      } finally {
        await runtime.end();
      }
    });
  });

  describe('inside a tenant (roles and ownership)', () => {
    let owner: Session;
    let admin: Session;
    let alice: Session;
    let bob: Session;
    let viewer: Session;

    beforeAll(async () => {
      owner = await register(app);
      admin = await addMember(app, owner, 'admin');
      alice = await addMember(app, owner, 'member');
      bob = await addMember(app, owner, 'member');
      viewer = await addMember(app, owner, 'viewer');
    });

    it('a viewer can read but never write', async () => {
      const made = await create(alice, 'doc').expect(201);
      await http()
        .get(`/resources/${made.body.id}`)
        .set(...bearer(viewer))
        .expect(200);
      await create(viewer, 'nope').expect(403);
      await http()
        .patch(`/resources/${made.body.id}`)
        .set(...bearer(viewer))
        .send({ version: 1, name: 'x' })
        .expect(403);
    });

    it('a member may change only what they created; admins and owners may change anything', async () => {
      const mine = await create(alice, 'alice-doc').expect(201);
      await http()
        .patch(`/resources/${mine.body.id}`)
        .set(...bearer(bob))
        .send({ version: 1, name: 'bob-was-here' })
        .expect(403);
      await http()
        .patch(`/resources/${mine.body.id}`)
        .set(...bearer(alice))
        .send({ version: 1, name: 'alice-v2' })
        .expect(200);
      await http()
        .patch(`/resources/${mine.body.id}`)
        .set(...bearer(admin))
        .send({ version: 2, name: 'admin-v3' })
        .expect(200);
      await http()
        .patch(`/resources/${mine.body.id}`)
        .set(...bearer(owner))
        .send({ version: 3, status: 'archived' })
        .expect(200);
    });

    it('optimistic concurrency: a stale version is a 409 that says what the current one is', async () => {
      const made = await create(alice, 'versioned').expect(201);
      await http()
        .patch(`/resources/${made.body.id}`)
        .set(...bearer(alice))
        .send({ version: 1, name: 'v2' })
        .expect(200);
      const stale = await http()
        .patch(`/resources/${made.body.id}`)
        .set(...bearer(alice))
        .send({ version: 1, name: 'lost-update' })
        .expect(409);
      expect(stale.body.error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });
    });

    it('only admins delete', async () => {
      const made = await create(alice, 'to-delete').expect(201);
      await http()
        .delete(`/resources/${made.body.id}`)
        .set(...bearer(alice))
        .expect(403);
      await http()
        .delete(`/resources/${made.body.id}`)
        .set(...bearer(admin))
        .expect(204);
      await http()
        .get(`/resources/${made.body.id}`)
        .set(...bearer(admin))
        .expect(404);
    });

    it('admins cannot create or promote owners/admins; the last owner cannot be removed', async () => {
      await http()
        .post('/members')
        .set(...bearer(admin))
        .send({ email: 'x1@example.test', name: 'x', password: 'correct-horse-battery', role: 'admin' })
        .expect(403);
      await http()
        .patch(`/members/${alice.userId}`)
        .set(...bearer(admin))
        .send({ role: 'owner' })
        .expect(403);
      await http()
        .patch(`/members/${owner.userId}`)
        .set(...bearer(admin))
        .send({ active: false })
        .expect(403);
      const blocked = await http()
        .patch(`/members/${owner.userId}`)
        .set(...bearer(owner))
        .send({ role: 'admin' })
        .expect(422);
      expect(blocked.body.error.code).toBe('LAST_OWNER');
    });

    it('two simultaneous demotions cannot leave a workspace without an owner', async () => {
      const ws = await register(app);
      const second = await addMember(app, ws, 'admin');
      await http()
        .patch(`/members/${second.userId}`)
        .set(...bearer(ws))
        .send({ role: 'owner' })
        .expect(200);
      const results = await Promise.all([
        http()
          .patch(`/members/${second.userId}`)
          .set(...bearer(ws))
          .send({ role: 'viewer' }),
        http()
          .patch(`/members/${ws.userId}`)
          .set(...bearer(second))
          .send({ role: 'viewer' }),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const pool = ownerPool();
      try {
        const { rows } = await pool.query(
          "SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1 AND role = 'owner' AND active",
          [ws.tenantId],
        );
        expect(rows[0].n).toBe(1);
      } finally {
        await pool.end();
      }
    });
  });

  describe('keyset pagination', () => {
    it('walks every row exactly once, newest first, with no gaps or repeats', async () => {
      const ws = await register(app);
      for (let i = 0; i < 7; i++) await create(ws, `page-${i}`).expect(201);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url: string = `/resources?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await http()
          .get(url)
          .set(...bearer(ws))
          .expect(200);
        seen.push(...res.body.items.map((r: { name: string }) => r.name));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toEqual(['page-6', 'page-5', 'page-4', 'page-3', 'page-2', 'page-1', 'page-0']);
    });

    it('rejects a tampered cursor with 400', async () => {
      const ws = await register(app);
      const res = await http()
        .get('/resources?cursor=not-a-cursor')
        .set(...bearer(ws))
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
    });
  });

  it('every HTTP route is either @Public or declares its roles (deny by default, enforced by a test)', () => {
    const unprotected: string[] = [];
    let inspected = 0;
    for (const module of app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const instance = wrapper.instance as object | undefined;
        if (!instance) continue;
        const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const handler = proto[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (Reflect.getMetadata('path', handler) === undefined) continue; // not a route
          inspected++;
          // Method-level metadata wins over class-level, exactly as the guards read it.
          const meta = <T>(key: string): T | undefined =>
            (Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, wrapper.metatype as object)) as
              T | undefined;
          const isPublic = meta<boolean>(IS_PUBLIC);
          const roles = meta<string[]>(ROLES_KEY);
          if (!isPublic && !roles?.length) unprotected.push(`${wrapper.metatype?.name}.${name}`);
        }
      }
    }
    expect(inspected).toBeGreaterThan(25); // guards against this test silently inspecting nothing
    expect(unprotected).toEqual([]);
  });
});
