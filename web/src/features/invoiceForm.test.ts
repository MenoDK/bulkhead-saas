import { describe, expect, it } from 'vitest';
import { draftTotal, toPayload, validateLine } from './invoiceForm';

describe('invoice draft maths', () => {
  it('sums in integer minor units (no 0.1 + 0.2 drift)', () => {
    const lines = [
      { description: 'a', quantity: '3', unit: '0.10' },
      { description: 'b', quantity: '1', unit: '0.20' },
    ];
    expect(draftTotal(lines, 'USD')).toBe(50);
  });
  it('respects zero-decimal and three-decimal currencies', () => {
    expect(draftTotal([{ description: 'a', quantity: '2', unit: '500' }], 'JPY')).toBe(1000);
    expect(draftTotal([{ description: 'a', quantity: '1', unit: '1.005' }], 'KWD')).toBe(1005);
  });
  it('is null while anything is invalid or would overflow', () => {
    expect(draftTotal([{ description: 'a', quantity: '1', unit: '' }], 'USD')).toBeNull();
    expect(draftTotal([{ description: 'a', quantity: '100000', unit: '999999999999.99' }], 'USD')).toBeNull();
  });
  it('validates each field and says what is wrong', () => {
    expect(validateLine({ description: ' ', quantity: '0', unit: '1.234' }, 'USD')).toEqual({
      description: 'Describe the line.',
      quantity: 'Whole number from 1 to 100000.',
      unit: 'Enter a valid amount for this currency.',
    });
    expect(validateLine({ description: 'ok', quantity: '2', unit: '9,99' }, 'USD')).toEqual({});
  });
  it('builds the API payload with canonical decimal strings, never floats', () => {
    expect(toPayload([{ description: ' Tea ', quantity: '2', unit: '4,5' }], 'EUR')).toEqual({
      currency: 'EUR',
      lines: [{ description: 'Tea', quantity: 2, unitPrice: '4.50' }],
    });
  });
});
