// Phase 3 — the one shared login for all three roles.
// The request carries only email + password. The role is read from the stored
// account and stamped into the token — the client never sends or chooses it.

import { verifyPassword } from '../auth/password.ts';
import { signToken } from '../auth/jwt.ts';
import type { AuthClaims } from '../auth/jwt.ts';
import { AuthenticationError } from '../auth/errors.ts';

export async function login(db: any, email: string, password: string) {
  const { rows } = await db.query(
    `select id, email, password_hash, role, buyer_id, vendor_id, status
       from users where email = $1`,
    [email],
  );
  const user = rows[0];

  // Same error whether the email is unknown or the password is wrong — never
  // leak which one it was.
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    throw new AuthenticationError();
  }

  const claims: AuthClaims = {
    sub: user.id,
    email: user.email,
    role: user.role, // ← from the account, not the request
    buyerId: user.buyer_id,
    vendorId: user.vendor_id,
  };

  return { token: signToken(claims), claims };
}
