/**
 * Money on the client: integers in minor units and decimal STRINGS, never floats.
 * The exponent table mirrors the server's, so what the form accepts is what the API accepts.
 */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'JPY', 'KWD'] as const;
export type Currency = (typeof CURRENCIES)[number];

const EXPONENTS: Record<Currency, number> = { USD: 2, EUR: 2, GBP: 2, BRL: 2, JPY: 0, KWD: 3 };

export const exponentOf = (currency: string): number => EXPONENTS[currency as Currency] ?? 2;

/**
 * "12,5" | "12.50" | " 1 234.5 " -> "12.50" (canonical, exactly `exponent` decimals) or null when it is not a valid amount.
 * Rejects negatives, exponents, more decimals than the currency has, and absurd sizes.
 */
export function normaliseAmount(input: string, currency: string): string | null {
  const exp = exponentOf(currency);
  const text = input.trim().replace(/\s+/g, '').replace(',', '.');
  const match = /^(\d{1,12})(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (fraction.length > exp) return null;
  if (exp === 0) return fraction.length === 0 ? whole : null;
  return `${whole}.${fraction.padEnd(exp, '0')}`;
}

/** Canonical decimal string -> integer minor units (safe: at most 12 integer digits + 3 decimals). */
export function toMinorUnits(amount: string, currency: string): number {
  const exp = exponentOf(currency);
  const [whole = '0', fraction = ''] = amount.split('.');
  return Number(whole + fraction.padEnd(exp, '0').slice(0, exp));
}

/** Minor units -> canonical decimal string ("1999" USD -> "19.99"). Pure string arithmetic: no division, no float drift. */
export function toDecimalString(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  const negative = minor < 0;
  const digits = String(Math.abs(Math.trunc(minor))).padStart(exp + 1, '0');
  const whole = digits.slice(0, digits.length - exp);
  const fraction = exp === 0 ? '' : `.${digits.slice(digits.length - exp)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Minor units -> localised currency text, computed from the exact decimal string. */
export function formatMinor(minor: number, currency: string, locale?: string): string {
  const exp = exponentOf(currency);
  const decimal = toDecimalString(minor, currency) as `${number}`;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(decimal);
}
