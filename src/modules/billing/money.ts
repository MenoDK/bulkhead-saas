/**
 * Money as integer minor units. No floats anywhere: 0.1 + 0.2 must be exactly 0.3.
 *
 * Every operation checks that the result is a safe integer, so an overflow is an error instead of a
 * silently wrong amount. Parsing accepts a strict grammar only (no signs, exponents, separators).
 */
const EXPONENTS: Readonly<Record<string, number>> = { USD: 2, EUR: 2, GBP: 2, BRL: 2, JPY: 0, KWD: 3 };

export class MoneyError extends Error {}

export class Money {
  private constructor(
    readonly cents: number,
    readonly currency: string,
  ) {}

  static exponent(currency: string): number {
    const e = EXPONENTS[currency];
    if (e === undefined) throw new MoneyError(`Unsupported currency: ${currency}`);
    return e;
  }

  static fromCents(cents: number | string | bigint, currency: string): Money {
    Money.exponent(currency);
    const n = typeof cents === 'number' ? cents : Number(cents);
    if (!Number.isSafeInteger(n) || n < 0) throw new MoneyError('Amount must be a non-negative safe integer');
    return new Money(n, currency);
  }

  /** "12.34" -> 1234. Rejects "12.345", "-1", "1e3", " 1", "1,5" and anything with more digits than fit. */
  static parse(text: string, currency: string): Money {
    const exp = Money.exponent(currency);
    const grammar = exp === 0 ? /^(\d{1,15})$/ : new RegExp(`^(\\d{1,15})(?:\\.(\\d{1,${exp}}))?$`);
    const match = grammar.exec(text);
    if (!match) throw new MoneyError(`Invalid ${currency} amount: "${text}"`);
    const whole = match[1] ?? '0';
    const fraction = (match[2] ?? '').padEnd(exp, '0');
    return Money.fromCents(Number(whole + fraction), currency);
  }

  static zero(currency: string): Money {
    return Money.fromCents(0, currency);
  }

  add(other: Money): Money {
    this.sameCurrency(other);
    return Money.fromCents(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.sameCurrency(other);
    if (other.cents > this.cents) throw new MoneyError('Result would be negative');
    return Money.fromCents(this.cents - other.cents, this.currency);
  }

  times(quantity: number): Money {
    if (!Number.isSafeInteger(quantity) || quantity < 0)
      throw new MoneyError('Quantity must be a non-negative integer');
    return Money.fromCents(this.cents * quantity, this.currency);
  }

  /**
   * Splits into `ratios.length` parts proportionally, distributing the leftover minor units one by
   * one (largest remainder first) so that the parts ALWAYS add up to the original amount.
   */
  allocate(ratios: readonly number[]): Money[] {
    if (ratios.length === 0 || ratios.some((r) => !Number.isSafeInteger(r) || r < 0)) {
      throw new MoneyError('Ratios must be non-negative integers');
    }
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total === 0) throw new MoneyError('At least one ratio must be positive');

    const shares = ratios.map((r) => Math.floor((this.cents * r) / total));
    let remainder = this.cents - shares.reduce((a, b) => a + b, 0);
    const order = ratios
      .map((r, index) => ({ index, fraction: (this.cents * r) % total }))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (const { index } of order) {
      if (remainder === 0) break;
      shares[index] = (shares[index] ?? 0) + 1;
      remainder -= 1;
    }
    return shares.map((s) => Money.fromCents(s, this.currency));
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.cents === other.cents;
  }

  /** "12.34" (exact: built from integer arithmetic, never from a float division). */
  toString(): string {
    const exp = Money.exponent(this.currency);
    if (exp === 0) return String(this.cents);
    const digits = String(this.cents).padStart(exp + 1, '0');
    return `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  }

  private sameCurrency(other: Money): void {
    if (this.currency !== other.currency)
      throw new MoneyError(`Currency mismatch: ${this.currency} vs ${other.currency}`);
  }
}
