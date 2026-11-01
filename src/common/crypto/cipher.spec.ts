import { CipherError, SecretBox } from './cipher';

const KEY = 'a'.repeat(64);
const box = new SecretBox(KEY);

describe('SecretBox (AES-256-GCM)', () => {
  it('round-trips, including unicode', () => {
    for (const text of ['whsec_abc123', 'segredo ✓ ünï', 'x'.repeat(5000)]) {
      expect(box.open(box.seal(text))).toBe(text);
    }
  });

  it('is non-deterministic: the same text seals differently each time', () => {
    expect(box.seal('same')).not.toBe(box.seal('same'));
  });

  it('never contains the plaintext and carries a version prefix', () => {
    const sealed = box.seal('super-secret-value');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('super-secret-value');
  });

  it('detects tampering (flipped byte) instead of returning garbage', () => {
    const sealed = box.seal('payload');
    const raw = Buffer.from(sealed.slice(3), 'base64url');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0xff;
    expect(() => box.open(`v1.${raw.toString('base64url')}`)).toThrow(CipherError);
  });

  it('fails with the wrong key', () => {
    expect(() => new SecretBox('b'.repeat(64)).open(box.seal('payload'))).toThrow(CipherError);
  });

  it.each(['', 'v1.', 'v1.abc', 'v2.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'no-prefix'])(
    'rejects malformed input %j',
    (bad) => {
      expect(() => box.open(bad)).toThrow(CipherError);
    },
  );

  it('refuses a bad key or empty plaintext', () => {
    expect(() => new SecretBox('short')).toThrow(CipherError);
    expect(() => box.seal('')).toThrow(CipherError);
  });
});
