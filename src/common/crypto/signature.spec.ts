import { buildSignatureHeader, SignatureError, verifySignature } from './signature';

const body = Buffer.from('{"id":"evt_1","type":"ping"}');
const secrets = ['current-secret', 'previous-secret'];
const reason = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as SignatureError).reason;
  }
  return 'no-error';
};

describe('webhook signature', () => {
  it('accepts a valid signature and returns its timestamp', () => {
    const header = buildSignatureHeader('current-secret', body, 1_000);
    expect(verifySignature(header, body, secrets, { now: 1_100 })).toBe(1_000);
  });

  it('accepts the previous secret during rotation', () => {
    const header = buildSignatureHeader('previous-secret', body, 1_000);
    expect(verifySignature(header, body, secrets, { now: 1_000 })).toBe(1_000);
  });

  it.each([
    [undefined, 'missing'],
    ['', 'missing'],
    ['garbage', 'malformed'],
    ['t=abc,v1=' + '0'.repeat(64), 'malformed'],
    ['t=1000', 'malformed'],
    ['v1=' + '0'.repeat(64), 'malformed'],
    ['t=1000,v1=nothex', 'malformed'],
  ])('rejects unusable header %p as %s', (header, expected) => {
    expect(reason(() => verifySignature(header, body, secrets, { now: 1_000 }))).toBe(expected);
  });

  it('rejects replays outside the tolerance window, and timestamps from the future', () => {
    const header = buildSignatureHeader('current-secret', body, 1_000);
    expect(reason(() => verifySignature(header, body, secrets, { toleranceSeconds: 300, now: 1_301 }))).toBe(
      'expired',
    );
    expect(verifySignature(header, body, secrets, { toleranceSeconds: 300, now: 1_300 })).toBe(1_000);
    const future = buildSignatureHeader('current-secret', body, 5_000);
    expect(reason(() => verifySignature(future, body, secrets, { now: 1_000 }))).toBe('future');
  });

  it('detects tampering with the body and with the timestamp', () => {
    const header = buildSignatureHeader('current-secret', body, 1_000);
    expect(
      reason(() => verifySignature(header, Buffer.from('{"id":"evt_2"}'), secrets, { now: 1_000 })),
    ).toBe('mismatch');
    // refreshing an old capture by editing t does not work: t is inside the MAC
    const forged = header.replace('t=1000', 't=1200');
    expect(reason(() => verifySignature(forged, body, secrets, { now: 1_200 }))).toBe('mismatch');
  });

  it('fails closed when no secret is configured', () => {
    const header = buildSignatureHeader('anything', body, 1_000);
    expect(reason(() => verifySignature(header, body, [], { now: 1_000 }))).toBe('mismatch');
  });
});
