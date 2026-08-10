// Phase 3 — password hashing. We never store a raw password; we store a bcrypt
// hash and compare against it at login.

import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}
