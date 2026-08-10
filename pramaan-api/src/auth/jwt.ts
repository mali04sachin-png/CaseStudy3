// Phase 3 — login tokens (JWT).
// The token carries WHO the user is (role + tenant/vendor binding). The role is
// stamped from the account at login time — the client never sends or picks it.

import jwt from 'jsonwebtoken';
import { AuthenticationError } from './errors.ts';

export type UserRole = 'VENDOR' | 'COMPLIANCE' | 'BUYER_ADMIN';

export interface AuthClaims {
  sub: string; // user id
  email: string;
  role: UserRole;
  buyerId: string | null; // set for COMPLIANCE & BUYER_ADMIN
  vendorId: string | null; // set for VENDOR
}

const SECRET = process.env.JWT_SECRET ?? 'dev-only-secret-change-me';

export function signToken(claims: AuthClaims, expiresIn: string = '8h'): string {
  // @ts-ignore — expiresIn accepts a string like '8h' at runtime.
  return jwt.sign(claims, SECRET, { expiresIn });
}

export function verifyToken(token: string): AuthClaims {
  try {
    const d = jwt.verify(token, SECRET) as Record<string, unknown>;
    return {
      sub: String(d.sub),
      email: String(d.email),
      role: d.role as UserRole,
      buyerId: (d.buyerId as string | null) ?? null,
      vendorId: (d.vendorId as string | null) ?? null,
    };
  } catch {
    throw new AuthenticationError('Invalid or expired token');
  }
}
