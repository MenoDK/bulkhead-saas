import { Money, MoneyError } from './money';

describe('Money', () => {
  it('has no floating-point drift: 0.10 + 0.20 is exactly 0.30', () => {
    const sum = Money.parse('0.10', 'USD').add(Money.parse('0.20', 'USD'));
    expect(sum.cents).toBe(30);
    expect(sum.toString()).toBe('0.30');
  });

  it.each([
    ['12', 'USD', 1200],
    ['12.3', 'USD', 1230],
    ['12.34', 'USD', 1234],
    ['0.05', 'EUR', 5],
    ['100', 'JPY', 100],
    ['1.234', 'KWD', 1234],
  ])('parses %s %s as %d minor units', (text, currency, cents) => {
    expect(Money.parse(text, currency).cents).toBe(cents);
  });

  it.each(['12.345', '-1', '+1', '1e3', ' 1', '1 ', '1,5', '', '.5', '5.', 'abc', '1'.repeat(16)])(
    'rejects malformed amount %p',
    (text) => {
      expect(() => Money.parse(text, 'USD')).toThrow(MoneyError);
    },
  );

  it('rejects fractions for zero-decimal currencies and unknown currencies', () => {
    expect(() => Money.parse('1.5', 'JPY')).toThrow(MoneyError);
    expect(() => Money.parse('1', 'XYZ')).toThrow(MoneyError);
  });

  it('round-trips through toString', () => {
    for (const cents of [0, 5, 99, 100, 123_456_789]) {
      expect(Money.parse(Money.fromCents(cents, 'USD').toString(), 'USD').cents).toBe(cents);
    }
    expect(Money.fromCents(5, 'KWD').toString()).toBe('0.005');
  });

  it('refuses to overflow or go negative instead of returning a wrong number', () => {
    const big = Money.fromCents(Number.MAX_SAFE_INTEGER, 'USD');
    expect(() => big.add(Money.fromCents(1, 'USD'))).toThrow(MoneyError);
    expect(() => big.times(2)).toThrow(MoneyError);
    expect(() => Money.fromCents(1, 'USD').subtract(Money.fromCents(2, 'USD'))).toThrow(MoneyError);
    expect(() => Money.fromCents(1.5, 'USD')).toThrow(MoneyError);
    expect(() => Money.fromCents(Number.NaN, 'USD')).toThrow(MoneyError);
  });

  it('never mixes currencies', () => {
    expect(() => Money.fromCents(1, 'USD').add(Money.fromCents(1, 'EUR'))).toThrow(/mismatch/);
  });

  describe('allocate', () => {
    it('splits 100 into thirds without losing a cent', () => {
      const parts = Money.fromCents(100, 'USD').allocate([1, 1, 1]);
      expect(parts.map((p) => p.cents)).toEqual([34, 33, 33]);
    });

    it('always sums back to the original, for many amounts and ratios', () => {
      const ratios = [[1, 1, 1], [7, 3], [1, 0, 2], [5], [3, 3, 3, 1], [1, 2, 3, 4, 5]];
      for (let cents = 0; cents < 500; cents += 7) {
        for (const r of ratios) {
          const parts = Money.fromCents(cents, 'USD').allocate(r);
          expect(parts.reduce((s, p) => s + p.cents, 0)).toBe(cents);
          r.forEach((ratio, i) => {
            if (ratio === 0) expect(parts[i]?.cents).toBe(0);
          });
        }
      }
    });

    it('rejects invalid ratios', () => {
      const m = Money.fromCents(10, 'USD');
      expect(() => m.allocate([])).toThrow(MoneyError);
      expect(() => m.allocate([0, 0])).toThrow(MoneyError);
      expect(() => m.allocate([-1, 2])).toThrow(MoneyError);
      expect(() => m.allocate([1.5, 1])).toThrow(MoneyError);
    });
  });
});
