import { refundNeedsApproval } from './refund-policy';

describe('refundNeedsApproval', () => {
  it.each([
    ['member', 10_000, 10_000, false], // exactly at the threshold is still allowed
    ['member', 10_001, 10_000, true],
    ['viewer', 10_001, 10_000, true],
    ['admin', 10_000_000, 10_000, false],
    ['owner', 10_000_000, 10_000, false],
    ['member', 1, 0, true],
  ] as const)(
    '%s refunding %i with threshold %i -> needs approval: %s',
    (role, amount, threshold, expected) => {
      expect(refundNeedsApproval(role, amount, threshold)).toBe(expected);
    },
  );
});
