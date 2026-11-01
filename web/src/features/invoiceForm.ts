import { formatMinor, normaliseAmount, toMinorUnits } from '../lib/money';

export interface LineDraft {
  description: string;
  quantity: string;
  unit: string;
}
export interface LineErrors {
  description?: string;
  quantity?: string;
  unit?: string;
}

export const emptyLine = (): LineDraft => ({ description: '', quantity: '1', unit: '' });

export function validateLine(line: LineDraft, currency: string): LineErrors {
  const errors: LineErrors = {};
  if (!line.description.trim()) errors.description = 'Describe the line.';
  const quantity = Number(line.quantity);
  if (!/^\d+$/.test(line.quantity.trim()) || quantity < 1 || quantity > 100_000)
    errors.quantity = 'Whole number from 1 to 100000.';
  if (normaliseAmount(line.unit, currency) === null) errors.unit = 'Enter a valid amount for this currency.';
  return errors;
}

/** Total in minor units, computed from integers only. Returns null while any line is still invalid. */
export function draftTotal(lines: readonly LineDraft[], currency: string): number | null {
  let total = 0;
  for (const line of lines) {
    const amount = normaliseAmount(line.unit, currency);
    const quantity = Number(line.quantity);
    if (amount === null || !Number.isSafeInteger(quantity) || quantity < 1) return null;
    total += toMinorUnits(amount, currency) * quantity;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function toPayload(lines: readonly LineDraft[], currency: string) {
  return {
    currency,
    lines: lines.map((l) => ({
      description: l.description.trim(),
      quantity: Number(l.quantity),
      unitPrice: normaliseAmount(l.unit, currency) as string,
    })),
  };
}

export const describeTotal = (lines: readonly LineDraft[], currency: string): string => {
  const total = draftTotal(lines, currency);
  return total === null ? '—' : formatMinor(total, currency);
};
