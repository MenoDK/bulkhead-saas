import type { Role } from '../../common/auth';

/**
 * Four-eyes style control on money going OUT: any writer may issue a small refund, but anything above
 * the threshold needs an admin/owner. Pure function so the rule (and its boundary) is unit-tested.
 */
export function refundNeedsApproval(role: Role, amountCents: number, thresholdCents: number): boolean {
  const isApprover = role === 'owner' || role === 'admin';
  return !isApprover && amountCents > thresholdCents;
}
