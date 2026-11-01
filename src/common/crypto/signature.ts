import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signatures: header `t=<unix seconds>,v1=<hex>[,v1=<hex>...]`, MAC over `"<t>." + rawBody`.
 *
 * - The timestamp is part of the MAC, so replaying an old capture with a fresh `t` fails.
 * - The tolerance window bounds how long a capture stays valid; event-id de-duplication closes the
 *   remaining gap inside the window.
 * - Several `v1` values (and several secrets) allow key rotation without downtime.
 */
export type SignatureFailure = 'missing' | 'malformed' | 'expired' | 'future' | 'mismatch';

export class SignatureError extends Error {
  constructor(readonly reason: SignatureFailure) {
    super(reason);
  }
}

function mac(secret: string, timestamp: number, body: Buffer | string): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

export function buildSignatureHeader(
  secret: string,
  body: Buffer | string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${mac(secret, timestamp, body)}`;
}

export function verifySignature(
  header: string | undefined,
  body: Buffer,
  secrets: readonly string[],
  options: { toleranceSeconds?: number; now?: number } = {},
): number {
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.now ?? Date.now() / 1000;
  if (!header) throw new SignatureError('missing');
  if (secrets.length === 0) throw new SignatureError('mismatch'); // fail closed

  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const [key, ...rest] = part.trim().split('=');
    const value = rest.join('=');
    if (key === 't') {
      if (!/^\d{1,12}$/.test(value)) throw new SignatureError('malformed');
      timestamp = Number(value);
    } else if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) {
      candidates.push(value.toLowerCase());
    }
  }
  if (timestamp === undefined || candidates.length === 0) throw new SignatureError('malformed');
  if (now - timestamp > tolerance) throw new SignatureError('expired');
  if (timestamp - now > tolerance) throw new SignatureError('future');

  // Compare every (secret, candidate) pair; no early exit, constant-time per comparison.
  let matched = false;
  for (const secret of secrets) {
    const expected = Buffer.from(mac(secret, timestamp, body), 'hex');
    for (const candidate of candidates) {
      matched = timingSafeEqual(expected, Buffer.from(candidate, 'hex')) || matched;
    }
  }
  if (!matched) throw new SignatureError('mismatch');
  return timestamp;
}
