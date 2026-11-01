import type { AuthUser } from '../../common/auth';

/**
 * Object-level authorization (the OWASP API #1 "BOLA" class). Tenant isolation is enforced below
 * this layer by row-level security; this answers the *within-tenant* question: may THIS user change
 * THIS record? Kept as a pure function so the rule is trivially unit-testable and reviewable.
 */
export function canModifyResource(
  user: Pick<AuthUser, 'userId' | 'role'>,
  resource: { createdBy: string },
): boolean {
  switch (user.role) {
    case 'owner':
    case 'admin':
      return true;
    case 'member':
      return resource.createdBy === user.userId;
    case 'viewer':
      return false;
  }
}
