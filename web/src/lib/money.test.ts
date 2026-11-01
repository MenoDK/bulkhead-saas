import { describe, expect, it } from 'vitest';
import { formatMinor, normaliseAmount, toDecimalString, toMinorUnits } from './money';

describe('normaliseAmount', () => {
  it.each([
    ['12.5', 'USD', '12.50'],
    ['12,5', 'USD', '12.50'],
    [' 1 234.56 ', 'EUR', '1234.56'],
    ['0', 'USD', '0.00'],
    ['7', 'JPY', '7'],
    ['1.234', 'KWD', '1.234'],
    ['5.', 'USD', '5.00'],
  ])('accepts %s (%s) as %s', (input, currency, expected) => {
    expect(normaliseAmount(input, currency)).toBe(expected);
  });

  it.each([
    ['-1', 'USD'],
    ['1e3', 'USD'],
    ['1.234', 'USD'],
    ['7.5', 'JPY'],
    ['abc', 'USD'],
    ['', 'USD'],
    ['1.2.3', 'USD'],
    ['1234567890123', 'USD'],
    ['0x10', 'USD'],
  ])('rejects %s (%s)', (input, currency) => {
    expect(normaliseAmount(input, currency)).toBeNull();
  });
});

describe('toMinorUnits', () => {
  it('is exact where floats are not (0.1 + 0.2 style traps)', () => {
    expect(toMinorUnits('0.30', 'USD')).toBe(30);
    expect(toMinorUnits('19.99', 'USD')).toBe(1999);
    expect(toMinorUnits('1.005', 'KWD')).toBe(1005);
    expect(toMinorUnits('5', 'JPY')).toBe(5);
  });
});

describe('formatMinor', () => {
  it('formats using each currency exponent', () => {
    expect(formatMinor(1999, 'USD', 'en-US')).toBe('$19.99');
    expect(formatMinor(5, 'USD', 'en-US')).toBe('$0.05');
    expect(formatMinor(1500, 'JPY', 'en-US')).toBe('¥1,500');
    expect(formatMinor(1005, 'KWD', 'en-US')).toContain('1.005');
    expect(formatMinor(1234567, 'BRL', 'pt-BR').replace(/\s/g, ' ')).toBe('R$ 12.345,67');
  });
  it('does not lose precision on large safe amounts', () => {
    expect(formatMinor(900_719_925_474_099, 'USD', 'en-US')).toBe('$9,007,199,254,740.99');
  });
});

describe('toDecimalString', () => {
  it.each([
    [1999, 'USD', '19.99'],
    [5, 'USD', '0.05'],
    [0, 'USD', '0.00'],
    [1500, 'JPY', '1500'],
    [1005, 'KWD', '1.005'],
    [7, 'KWD', '0.007'],
  ])('%i %s -> %s', (minor, currency, expected) => {
    expect(toDecimalString(minor, currency)).toBe(expected);
  });
  it('round-trips with normaliseAmount/toMinorUnits for every supported currency and awkward values', () => {
    for (const currency of ['USD', 'JPY', 'KWD', 'BRL']) {
      for (const minor of [0, 1, 9, 10, 99, 100, 101, 12_345, 999_999_999_999]) {
        const text = toDecimalString(minor, currency);
        expect(normaliseAmount(text, currency)).toBe(text);
        expect(toMinorUnits(text, currency)).toBe(minor);
      }
    }
  });
});
