import { signExport, verifyExportSignature, type ExportEnvelope } from './audit-export';

const SECRET = 'x'.repeat(40);
const envelope: ExportEnvelope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  generatedAt: '2026-01-01T00:00:00.000Z',
  count: 3,
  fromPrevHash: null,
  headHash: 'a'.repeat(64),
};

describe('audit export signature', () => {
  it('verifies an untouched envelope', () => {
    expect(verifyExportSignature(SECRET, envelope, signExport(SECRET, envelope))).toBe(true);
  });

  it.each([
    ['count', { count: 2 }],
    ['headHash', { headHash: 'b'.repeat(64) }],
    ['tenantId', { tenantId: '22222222-2222-4222-8222-222222222222' }],
    ['fromPrevHash', { fromPrevHash: 'c'.repeat(64) }],
  ])('rejects a tampered %s', (_name, change) => {
    const signature = signExport(SECRET, envelope);
    expect(verifyExportSignature(SECRET, { ...envelope, ...change }, signature)).toBe(false);
  });

  it('rejects a wrong secret and malformed signatures without throwing', () => {
    const signature = signExport(SECRET, envelope);
    expect(verifyExportSignature('y'.repeat(40), envelope, signature)).toBe(false);
    expect(verifyExportSignature(SECRET, envelope, 'nothex')).toBe(false);
    expect(verifyExportSignature(SECRET, envelope, '')).toBe(false);
  });

  it('is independent of key order in the envelope', () => {
    const reordered = Object.fromEntries(Object.entries(envelope).reverse()) as unknown as ExportEnvelope;
    expect(signExport(SECRET, reordered)).toBe(signExport(SECRET, envelope));
  });
});
