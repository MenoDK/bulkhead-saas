import type { Role } from './api';

/** Mirrors the server's role groups. This only decides what to SHOW; the server stays the authority and re-checks every call. */
export const WRITERS: readonly Role[] = ['owner', 'admin', 'member'];
export const ADMINS: readonly Role[] = ['owner', 'admin'];

export const canWrite = (role: Role): boolean => WRITERS.includes(role);
export const isAdmin = (role: Role): boolean => ADMINS.includes(role);

/** Same rule as the server's `canModifyResource`: members may only touch what they created. */
export function canModifyResource(role: Role, userId: string, resource: { createdBy: string }): boolean {
  if (isAdmin(role)) return true;
  return role === 'member' && resource.createdBy === userId;
}
