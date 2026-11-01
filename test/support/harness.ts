import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { requestId } from '../../src/common/request-context';
import { migrate } from '../../src/database/migrator';
import { Pool } from 'pg';

export interface Session {
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  userId: string;
  email: string;
}

export const PASSWORD = 'correct-horse-battery';

export async function createApp(
  overrides: Record<string, string | undefined> = {},
): Promise<INestApplication> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await migrate({
    ownerUrl: process.env.MIGRATION_DATABASE_URL as string,
    appRolePassword: process.env.APP_DB_PASSWORD as string,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.use(requestId);
  await app.listen(0); // a real socket: supertest reuses it, and socket.io clients need it
  for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return app;
}

const unique = (): string => randomUUID().slice(0, 8);

/** A brand-new workspace + owner. Unique e-mails mean tests never collide, so no cleanup between them is needed. */
export async function register(app: INestApplication, niche = 'general'): Promise<Session> {
  const email = `owner-${unique()}@example.test`;
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: PASSWORD, name: 'Owner', tenantName: `Workspace ${unique()}`, niche })
    .expect(201);
  return {
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    tenantId: res.body.tenant.id,
    userId: res.body.user.id,
    email,
  };
}

/** Adds a member through the API (as the owner) and logs them in. */
export async function addMember(
  app: INestApplication,
  owner: Session,
  role: 'admin' | 'member' | 'viewer',
): Promise<Session> {
  const email = `${role}-${unique()}@example.test`;
  const created = await request(app.getHttpServer())
    .post('/members')
    .set('authorization', `Bearer ${owner.accessToken}`)
    .send({ email, name: role, password: PASSWORD, role })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return {
    accessToken: login.body.accessToken,
    refreshToken: login.body.refreshToken,
    tenantId: owner.tenantId,
    userId: created.body.userId,
    email,
  };
}

export const bearer = (s: Session): [string, string] => ['authorization', `Bearer ${s.accessToken}`];

/** Direct connection as the schema OWNER (bypasses RLS): only for arranging/inspecting state, never to test the app. */
export function ownerPool(): Pool {
  return new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 2 });
}

/** Direct connection as the unprivileged runtime role: this is what proves row-level security. */
export function appRolePool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
}

export const portOf = (app: INestApplication): number => (app.getHttpServer().address() as AddressInfo).port;

export interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

/** A tiny HTTP server standing in for a customer's webhook receiver. `respond` decides each answer. */
export async function startReceiver(
  respond: (received: Received, n: number) => number | Promise<number> = () => 200,
) {
  const received: Received[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const item = { headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      received.push(item);
      void Promise.resolve(respond(item, received.length)).then((status) => {
        res.statusCode = status;
        res.end();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
