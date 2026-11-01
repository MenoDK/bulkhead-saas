import { decodeCursor, encodeCursor, InvalidCursorError, toPage } from './pagination';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('keyset pagination', () => {
  it('round-trips a cursor', () => {
    const cursor = { createdAt: '2026-01-01T10:00:00.123Z', id: id(7) };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('treats a missing cursor as the first page', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor('')).toBeUndefined();
  });

  it.each([
    'not-base64-json',
    Buffer.from('{"createdAt":"yesterday","id":"x"}').toString('base64url'),
    Buffer.from('{"createdAt":"2026-01-01T10:00:00Z","id":"1 OR 1=1"}').toString('base64url'),
    Buffer.from('[]').toString('base64url'),
  ])('rejects a forged cursor %#', (raw) => {
    expect(() => decodeCursor(raw)).toThrow(InvalidCursorError);
  });

  it('only emits a next cursor when another page exists', () => {
    const rows = [1, 2, 3].map((n) => ({ id: id(n), created_at: new Date(2026, 0, n) }));
    const full = toPage(rows, 2);
    expect(full.items).toHaveLength(2);
    expect(full.nextCursor).not.toBeNull();
    expect(decodeCursor(full.nextCursor!)).toEqual({
      createdAt: rows[1]!.created_at.toISOString(),
      id: id(2),
    });

    expect(toPage(rows, 3).nextCursor).toBeNull();
    expect(toPage([], 10)).toEqual({ items: [], nextCursor: null });
  });
});
