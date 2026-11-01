export const formatDateTime = (iso: string, locale?: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
export const shortId = (id: string): string => id.slice(0, 8);
export const shortHash = (hash: string | null): string => (hash ? `${hash.slice(0, 10)}…` : '—');
