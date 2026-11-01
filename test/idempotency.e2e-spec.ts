import { type INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { IdempotencyService } from '../src/modules/idempotency/idempotency.service';
import { createApp, register, type Session } from './support/harness';

/**
 * The HTTP-level "ten simultaneous requests" test in billing.e2e-spec.ts cannot prove the lock on its
 * own: whether ten requests really overlap inside Postgres depends on scheduling. This suite removes
 * the scheduling from the question. Request A is held INSIDE its effect; request B then starts with
 * the same key. With the advisory lock B must not enter its effect until A has committed; without it
 * B walks straight in and the effect runs twice. Mutation-checked by scripts/sabotage.sh.
 */
describe('idempotency: concurrent duplicates are serialised by the key lock', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let idem: IdempotencyService;
  let owner: Session;

  beforeAll(async () => {
    app = await createApp();
    db = app.get(DatabaseService);
    idem = app.get(IdempotencyService);
    owner = await register(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const scope = () => ({ tenantId: owner.tenantId, actorId: owner.userId, action: 'test.once' });
  const newKey = () => `lock-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  it('the second request waits for the first one, then replays its stored result', async () => {
    const key = newKey();
    let effects = 0;
    let secondEntered = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let firstInside: () => void = () => undefined;
    const firstIsInside = new Promise<void>((resolve) => (firstInside = resolve));

    const first = db.withTenant(owner.tenantId, (tx) =>
      idem.run(tx, scope(), key, { n: 1 }, async () => {
        effects += 1;
        firstInside();
        await gate; // A stays inside its effect, transaction still open
        return { status: 201, body: { who: 'first' } };
      }),
    );
    await firstIsInside;

    const second = db.withTenant(owner.tenantId, (tx) =>
      idem.run(tx, scope(), key, { n: 1 }, async () => {
        secondEntered = true;
        effects += 1;
        return { status: 201, body: { who: 'second' } };
      }),
    );

    await sleep(300); // generous: B has had every chance to run its effect
    const enteredWhileFirstWasOpen = secondEntered;
    release(); // always released, so a broken lock fails the test instead of hanging the suite
    const [a, b] = await Promise.all([first, second]);
    expect(enteredWhileFirstWasOpen).toBe(false);
    expect({ effects, aReplayed: a.replayed, bReplayed: b.replayed }).toEqual({
      effects: 1,
      aReplayed: false,
      bReplayed: true,
    });
    expect(b.body).toEqual({ who: 'first' });
  });

  it('a different key does not wait: the lock is per key, not global', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held: () => void = () => undefined;
    const isHeld = new Promise<void>((resolve) => (held = resolve));

    const slow = db.withTenant(owner.tenantId, (tx) =>
      idem.run(tx, scope(), newKey(), { n: 1 }, async () => {
        held();
        await gate;
        return { status: 201, body: {} };
      }),
    );
    await isHeld;

    const other = await db.withTenant(owner.tenantId, (tx) =>
      idem.run(tx, scope(), newKey(), { n: 2 }, async () => ({ status: 201, body: { fast: true } })),
    );
    expect(other.replayed).toBe(false);

    release();
    await slow;
  });

  it('the same key with a different request body is refused, not replayed', async () => {
    const key = newKey();
    await db.withTenant(owner.tenantId, (tx) =>
      idem.run(tx, scope(), key, { amount: '10.00' }, async () => ({ status: 201, body: { ok: true } })),
    );
    await expect(
      db.withTenant(owner.tenantId, (tx) =>
        idem.run(tx, scope(), key, { amount: '99.00' }, async () => ({ status: 201, body: { ok: true } })),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 422 });
  });
});
