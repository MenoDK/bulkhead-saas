/** Browser storage can be missing or throw (private windows, blocked cookies): treat it as optional. */
type Store = 'local' | 'session';

function pick(store: Store): Storage | null {
  try {
    return store === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStored(store: Store, key: string): string | null {
  try {
    return pick(store)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(store: Store, key: string, value: string | null): void {
  try {
    const target = pick(store);
    if (!target) return;
    if (value === null) target.removeItem(key);
    else target.setItem(key, value);
  } catch {
    /* quota or policy error: the app works without persistence */
  }
}
