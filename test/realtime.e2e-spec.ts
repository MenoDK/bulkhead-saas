import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { bearer, createApp, portOf, register, type Session } from './support/harness';

const connect = (app: INestApplication, token?: string): Promise<Socket> =>
  new Promise((resolve) => {
    const socket = io(`http://127.0.0.1:${portOf(app)}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('disconnect', () => resolve(socket));
    socket.on('connect_error', () => resolve(socket));
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('realtime (Socket.IO) tenant isolation', () => {
  let app: INestApplication;
  let a: Session;
  let b: Session;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    app = await createApp();
    a = await register(app);
    b = await register(app);
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await app.close();
  });

  it('delivers events to the tenant that owns them and to nobody else', async () => {
    const sa = await connect(app, a.accessToken);
    const sb = await connect(app, b.accessToken);
    sockets.push(sa, sb);
    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    sa.on('resource.created', (p) => gotA.push(p));
    sb.on('resource.created', (p) => gotB.push(p));
    await wait(100); // let the server finish joining the rooms

    await request(app.getHttpServer())
      .post('/resources')
      .set(...bearer(a))
      .send({ name: 'live' })
      .expect(201);
    await wait(250);
    expect(gotA).toHaveLength(1);
    expect(gotA[0]).toMatchObject({ name: 'live' });
    expect(gotB).toHaveLength(0);
  });

  it('refuses sockets without a valid token', async () => {
    const anonymous = await connect(app);
    const forged = await connect(app, 'eyJhbGciOiJub25lIn0.e30.');
    sockets.push(anonymous, forged);
    await wait(150);
    expect(anonymous.connected).toBe(false);
    expect(forged.connected).toBe(false);
  });

  it('gives a client no way to subscribe to another tenant: arbitrary room messages do nothing', async () => {
    const sa = await connect(app, a.accessToken);
    sockets.push(sa);
    const gotA: unknown[] = [];
    sa.on('resource.created', (p) => gotA.push(p));
    sa.emit('join', `tenant:${b.tenantId}`);
    sa.emit('subscribe', { room: `tenant:${b.tenantId}` });
    await wait(100);
    await request(app.getHttpServer())
      .post('/resources')
      .set(...bearer(b))
      .send({ name: 'not-for-a' })
      .expect(201);
    await wait(250);
    expect(gotA).toHaveLength(0);
  });
});
