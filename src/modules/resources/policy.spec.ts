import { canModifyResource } from './policy';

const owner = 'u-owner';
const other = 'u-other';

describe('canModifyResource', () => {
  it.each([
    ['owner', owner, other, true],
    ['admin', 'u-admin', other, true],
    ['member', 'u-member', 'u-member', true],
    ['member', 'u-member', other, false],
    ['viewer', 'u-viewer', 'u-viewer', false],
    ['viewer', 'u-viewer', other, false],
  ] as const)('%s (%s) on a record created by %s -> %s', (role, userId, createdBy, expected) => {
    expect(canModifyResource({ userId, role }, { createdBy })).toBe(expected);
  });
});
