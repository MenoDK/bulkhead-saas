import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class CipherError extends Error {}

/**
 * Authenticated encryption for secrets stored in the database (webhook signing keys, third-party
 * tokens). Output is self-describing: `v1.<base64url(iv | tag | ciphertext)>`.
 *
 * - AES-256-GCM: tampering with the stored value makes decryption FAIL instead of yielding garbage.
 * - Fresh random IV per call: sealing the same text twice gives different outputs.
 * - The `v1.` prefix is what makes key/algorithm rotation possible later without a flag day.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) throw new CipherError('key must be 64 hex characters (32 bytes)');
    this.key = Buffer.from(hexKey, 'hex');
  }

  seal(plaintext: string): string {
    if (typeof plaintext !== 'string' || plaintext.length === 0) throw new CipherError('nothing to encrypt');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}`;
  }

  open(sealed: string): string {
    const dot = typeof sealed === 'string' ? sealed.indexOf('.') : -1;
    if (dot === -1) throw new CipherError('missing version prefix');
    if (sealed.slice(0, dot) !== VERSION) throw new CipherError(`unknown version "${sealed.slice(0, dot)}"`);
    const raw = Buffer.from(sealed.slice(dot + 1), 'base64url');
    if (raw.length <= IV_BYTES + TAG_BYTES) throw new CipherError('too short to hold IV, tag and content');
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new CipherError('authentication failed (wrong key or tampered value)');
    }
  }
}
