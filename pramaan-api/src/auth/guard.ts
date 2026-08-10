// Phase 3 — the role guard. Every protected route calls this. If the caller's
// role isn't in the allowed list, it throws a 403 — never a silently filtered
// "empty" view that pretends the data doesn't exist.

import type { AuthClaims, UserRole } from './jwt.ts';
import { AuthorizationError } from './errors.ts';

export function requireRole(claims: AuthClaims, allowed: UserRole[]): void {
  if (!allowed.includes(claims.role)) {
    throw new AuthorizationError(
      `Role ${claims.role} may not access this resource (requires: ${allowed.join(', ')})`,
    );
  }
}
