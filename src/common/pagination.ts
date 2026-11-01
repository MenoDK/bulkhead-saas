/**
 * Keyset ("seek") pagination: the cursor is the sort key of the last row seen, so page N costs the
 * same as page 1 (OFFSET would scan and discard N pages) and rows inserted meanwhile never shift
 * or duplicate results. Cursors are opaque to clients and validated on the way back in.
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (
      typeof parsed.createdAt === 'string' &&
      ISO.test(parsed.createdAt) &&
      typeof parsed.id === 'string' &&
      UUID.test(parsed.id)
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    /* fall through */
  }
  throw new InvalidCursorError();
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor');
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Fetch `limit + 1` rows; the extra one only tells us whether another page exists. */
export function toPage<T extends { id: string; created_at: Date }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const hasMore = rows.length > limit && last !== undefined;
  return {
    items,
    nextCursor: hasMore ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null,
  };
}
