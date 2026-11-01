import { createHash } from 'node:crypto';

/** Deterministic JSON: object keys sorted recursively, so the same data always hashes the same. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export interface AuditEntryData {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string; // ISO-8601, as stored
}

/**
 * Hashes an explicit list of fields, never "whatever the object has": a stored row also carries
 * `seq` and `hash`, and those must not influence (or be able to break) its own hash.
 */
export function computeHash(entry: AuditEntryData, prevHash: string | null): string {
  const { id, tenantId, actorId, action, entityType, entityId, metadata, createdAt } = entry;
  return createHash('sha256')
    .update(
      canonicalize({ id, tenantId, actorId, action, entityType, entityId, metadata, createdAt, prevHash }),
    )
    .digest('hex');
}

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|credential|signature/i;

/** Audit trails must prove *what happened*, not become a second copy of the secrets. */
export function redactMetadata(value: unknown, depth = 0): Record<string, unknown> {
  const walk = (v: unknown, d: number): unknown => {
    if (d > 5) return '[truncated]';
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => walk(x, d + 1));
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [
          k,
          SENSITIVE_KEY.test(k) ? '[redacted]' : walk(x, d + 1),
        ]),
      );
    }
    return typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)}…` : v;
  };
  const out = walk(value, depth);
  return out !== null && typeof out === 'object' && !Array.isArray(out)
    ? (out as Record<string, unknown>)
    : {};
}

export interface StoredAuditEntry extends AuditEntryData {
  seq: number;
  prevHash: string | null;
  hash: string;
}

export interface ChainVerdict {
  valid: boolean;
  checked: number;
  /** First entry that does not verify, with the reason. */
  broken?: { seq: number; reason: 'prev_hash_mismatch' | 'hash_mismatch' };
}

/**
 * Verifies a slice of one tenant's chain in `seq` order. `expectedPrev` is the hash of the entry
 * just before the slice (null for the very first entry), so large chains can be checked in batches.
 */
export function verifyChain(
  entries: readonly StoredAuditEntry[],
  expectedPrev: string | null = null,
): ChainVerdict {
  let prev = expectedPrev;
  let checked = 0;
  for (const entry of entries) {
    if (entry.prevHash !== prev)
      return { valid: false, checked, broken: { seq: entry.seq, reason: 'prev_hash_mismatch' } };
    if (computeHash(entry, entry.prevHash) !== entry.hash) {
      return { valid: false, checked, broken: { seq: entry.seq, reason: 'hash_mismatch' } };
    }
    prev = entry.hash;
    checked += 1;
  }
  return { valid: true, checked };
}
