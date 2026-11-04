import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './support/harness';

/** Poll until `done` is true; fail with `what` if it is not within the time allowed. */
async function until(done: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('worker heartbeat (what the container health check reads)', () => {
  it('is written by a polling worker and renewed on every poll that succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heartbeat-'));
    const file = join(dir, 'beat');
    const app = await createApp({
      OUTBOX_WORKER: 'true',
      OUTBOX_POLL_INTERVAL_MS: '50',
      WORKER_HEARTBEAT_FILE: file,
    });
    try {
      await until(() => existsSync(file), 'the first heartbeat');
      const first = statSync(file).mtimeMs;
      await until(() => statSync(file).mtimeMs > first, 'the heartbeat to be renewed');
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
