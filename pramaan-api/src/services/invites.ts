// Phase 3 — Buyer-Admin invites a Compliance user.
// Two rules baked in and impossible to bypass from the caller:
//   - Only a BUYER_ADMIN may invite (role guard).
//   - The new user's role is hard-coded COMPLIANCE, and their buyer_id is copied
//     from the admin's own token — so an admin can NEVER create a user in another
//     tenant, and can NEVER mint a different role.

import { hashPassword } from '../auth/password.ts';
import { requireRole } from '../auth/guard.ts';
import type { AuthClaims } from '../auth/jwt.ts';

export interface InviteInput {
  email: string;
  password: string;
}

export async function inviteComplianceUser(db: any, admin: AuthClaims, input: InviteInput) {
  requireRole(admin, ['BUYER_ADMIN']); // throws 403 otherwise

  const buyerId = admin.buyerId; // from the token, NOT from caller input

  const {
    rows: [user],
  } = await db.query(
    `insert into users (email, password_hash, role, buyer_id, invited_by_user_id)
     values ($1, $2, 'COMPLIANCE', $3, $4) returning id`,
    [input.email, hashPassword(input.password), buyerId, admin.sub],
  );

  return { userId: user.id as string, buyerId };
}
