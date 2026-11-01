import { nextDelayMs } from './backoff';

describe('nextDelayMs', () => {
  const mid = () => 0.5; // jitter factor exactly 1.0

  it('doubles each attempt', () => {
    expect([1, 2, 3, 4].map((a) => nextDelayMs(a, mid))).toEqual([2_000, 4_000, 8_000, 16_000]);
  });

  it('is capped', () => {
    expect(nextDelayMs(30, mid)).toBe(15 * 60_000);
  });

  it('stays within +-20 % of the nominal delay', () => {
    expect(nextDelayMs(3, () => 0)).toBe(6_400);
    expect(nextDelayMs(3, () => 0.999999)).toBe(9_600);
  });

  it('tolerates attempt 0', () => {
    expect(nextDelayMs(0, mid)).toBe(2_000);
  });
});
