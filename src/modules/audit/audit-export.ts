import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalize } from './audit-chain';

export interface ExportEnvelope {
  tenantId: string;
  generatedAt: string;
  count: number;
  /** Hash of the entry just before the first exported one (null = the export starts at the beginning of the chain). */
  fromPrevHash: string | null;
  /** Hash of the last exported entry: committing to it commits to the whole chain up to it. */
  headHash: string | null;
}

/** An export is signed over its envelope; the entries are protected by the hash chain itself. */
export function signExport(secret: string, envelope: ExportEnvelope): string {
  return createHmac('sha256', secret).update(canonicalize(envelope)).digest('hex');
}

export function verifyExportSignature(secret: string, envelope: ExportEnvelope, signature: string): boolean {
  const expected = Buffer.from(signExport(secret, envelope), 'hex');
  const given = /^[0-9a-f]{64}$/i.test(signature) ? Buffer.from(signature, 'hex') : Buffer.alloc(0);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
