import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * scrypt with the parameters stored *inside* the hash (`scrypt$N$r$p$salt$hash`), so the cost can be
 * raised later and old hashes keep verifying (and can be upgraded on next login).
 */
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 256; // bound the work an attacker can force with a huge input

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string, log2N: number): Promise<string> {
  const salt = randomBytes(16);
  const n = 2 ** log2N;
  const key = await derive(password, salt, n, R, P);
  return `scrypt$${n}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const [scheme, nText, rText, pText, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !nText || !rText || !pText || !salt || !key) return false;
  const [n, r, p] = [Number(nText), Number(rText), Number(pText)];
  // The parameters come from storage, but never let a corrupted row choose how much memory we burn.
  const powerOfTwo = Number.isInteger(n) && n >= 2 ** 10 && n <= 2 ** 20 && (n & (n - 1)) === 0;
  if (!powerOfTwo || !Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4)
    return false;
  const expected = Buffer.from(key, 'base64');
  try {
    const actual = await derive(password, Buffer.from(salt, 'base64'), n, r, p);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** True if the stored hash was made with a lower cost than currently configured. */
export function needsRehash(stored: string, log2N: number): boolean {
  const n = Number(stored.split('$')[1]);
  return !Number.isFinite(n) || n < 2 ** log2N;
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = MAX_PASSWORD_LENGTH;
