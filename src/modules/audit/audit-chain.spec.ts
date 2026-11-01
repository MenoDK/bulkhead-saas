import { canonicalize, computeHash, redactMetadata, type StoredAuditEntry, verifyChain } from './audit-chain';

function build(n: number): StoredAuditEntry[] {
  const out: StoredAuditEntry[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= n; i++) {
    const data = {
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      tenantId: '11111111-1111-4111-8111-111111111111',
      actorId: null,
      action: 'thing.created',
      entityType: 'thing',
      entityId: String(i),
      metadata: { n: i, nested: { b: 2, a: 1 } },
      createdAt: `2026-01-01T00:00:0${i}.000Z`,
    };
    const hash = computeHash(data, prev);
    out.push({ ...data, seq: i, prevHash: prev, hash });
    prev = hash;
  }
  return out;
}

describe('audit chain', () => {
  it('canonicalize ignores key order and drops undefined', () => {
    expect(canonicalize({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}',
    );
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it('accepts an untouched chain', () => {
    expect(verifyChain(build(5))).toEqual({ valid: true, checked: 5 });
  });

  it('detects an edited entry', () => {
    const chain = build(5);
    chain[2] = { ...chain[2]!, metadata: { n: 999 } };
    expect(verifyChain(chain)).toEqual({
      valid: false,
      checked: 2,
      broken: { seq: 3, reason: 'hash_mismatch' },
    });
  });

  it('detects a deleted entry, an inserted entry and a reordering', () => {
    const chain = build(5);
    expect(verifyChain([...chain.slice(0, 2), ...chain.slice(3)]).broken).toEqual({
      seq: 4,
      reason: 'prev_hash_mismatch',
    });
    expect(verifyChain([chain[1]!, chain[0]!, ...chain.slice(2)]).valid).toBe(false);
    expect(verifyChain(chain.slice(1)).broken?.reason).toBe('prev_hash_mismatch'); // head removed
  });

  it('detects a rewritten history even if the attacker recomputes the edited hash', () => {
    const chain = build(4);
    const edited = { ...chain[1]!, metadata: { n: 'forged' } };
    edited.hash = computeHash(edited, edited.prevHash);
    chain[1] = edited;
    // entry 3 still points at the ORIGINAL hash of entry 2
    expect(verifyChain(chain).broken).toEqual({ seq: 3, reason: 'prev_hash_mismatch' });
  });

  it('verifies in batches when told the hash that precedes the slice', () => {
    const chain = build(6);
    expect(verifyChain(chain.slice(3), chain[2]!.hash)).toEqual({ valid: true, checked: 3 });
    expect(verifyChain(chain.slice(3), 'wrong').valid).toBe(false);
  });

  it('redacts secrets and truncates, never storing credentials in the trail', () => {
    const out = redactMetadata({
      email: 'a@b.c',
      password: 'hunter2',
      nested: { apiKey: 'k', list: [{ token: 't', ok: 1 }] },
      long: 'x'.repeat(600),
    });
    expect(out.password).toBe('[redacted]');
    expect(JSON.stringify(out)).not.toContain('hunter2');
    expect((out.nested as { apiKey: string }).apiKey).toBe('[redacted]');
    expect((out.long as string).length).toBeLessThan(600);
    expect(redactMetadata('not an object')).toEqual({});
  });
});
