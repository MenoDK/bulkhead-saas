import { describe, expect, it } from 'vitest';
import { canModifyResource, canWrite, isAdmin } from './permissions';

describe('permissions mirror the server rules', () => {
  it('writers and admins', () => {
    expect(['owner', 'admin', 'member', 'viewer'].map((r) => canWrite(r as never))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(['owner', 'admin', 'member', 'viewer'].map((r) => isAdmin(r as never))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
  it('a member can change only what they created; a viewer nothing; admins everything', () => {
    expect(canModifyResource('member', 'u1', { createdBy: 'u1' })).toBe(true);
    expect(canModifyResource('member', 'u1', { createdBy: 'u2' })).toBe(false);
    expect(canModifyResource('viewer', 'u1', { createdBy: 'u1' })).toBe(false);
    expect(canModifyResource('admin', 'u1', { createdBy: 'u2' })).toBe(true);
  });
});
