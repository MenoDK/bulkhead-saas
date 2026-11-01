import { hashPassword, needsRehash, verifyPassword } from './password';

describe('password hashing (scrypt)', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery', 10);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
  });

  it('salts: the same password never produces the same hash', async () => {
    expect(await hashPassword('same-password-1', 10)).not.toBe(await hashPassword('same-password-1', 10));
  });

  it('embeds its parameters, so a cost increase is detectable and old hashes still verify', async () => {
    const old = await hashPassword('rotate-me-please', 10);
    expect(old.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(needsRehash(old, 15)).toBe(true);
    expect(needsRehash(old, 10)).toBe(false);
    expect(await verifyPassword('rotate-me-please', old)).toBe(true);
  });

  it('treats unicode-equivalent passwords as equal (NFKC)', async () => {
    const hash = await hashPassword('café-password', 10);
    expect(await verifyPassword('café-password', hash)).toBe(true);
  });

  it.each(['', 'plain', 'scrypt$x$8$1$salt$key', 'bcrypt$1$2$3$4$5'])(
    'rejects malformed stored hash %p without throwing',
    async (stored) => {
      expect(await verifyPassword('anything-at-all', stored)).toBe(false);
    },
  );

  it('refuses absurdly long input instead of burning CPU on it', async () => {
    const hash = await hashPassword('short-enough-pw', 10);
    expect(await verifyPassword('x'.repeat(10_000), hash)).toBe(false);
  });
});
