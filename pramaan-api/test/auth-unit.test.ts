// Phase 3 unit tests — no database required.

import { test } from 'node:test';
import assert from 'node:assert';

import { hashPassword, verifyPassword } from '../src/auth/password.ts';
import { signToken, verifyToken } from '../src/auth/jwt.ts';
import type { AuthClaims } from '../src/auth/jwt.ts';
import { requireRole } from '../src/auth/guard.ts';
import { AuthenticationError, AuthorizationError } from '../src/auth/errors.ts';

const vendorClaims: AuthClaims = {
  sub: 'u1',
  email: 'ravi@example.com',
  role: 'VENDOR',
  buyerId: null,
  vendorId: 'v1',
};

test('password: correct verifies, wrong does not, hash is not the plaintext', () => {
  const hash = hashPassword('s3cret!');
  assert.notEqual(hash, 's3cret!');
  assert.ok(verifyPassword('s3cret!', hash));
  assert.ok(!verifyPassword('wrong', hash));
});

test('jwt: sign then verify round-trips the claims', () => {
  const token = signToken(vendorClaims);
  const back = verifyToken(token);
  assert.equal(back.role, 'VENDOR');
  assert.equal(back.vendorId, 'v1');
  assert.equal(back.buyerId, null);
});

test('jwt: a tampered token is rejected as 401', () => {
  const token = signToken(vendorClaims);
  const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
  assert.throws(() => verifyToken(tampered), (e: unknown) => {
    assert.ok(e instanceof AuthenticationError);
    assert.equal((e as AuthenticationError).httpStatus, 401);
    return true;
  });
});

test('guard: a VENDOR hitting a COMPLIANCE-only route throws 403', () => {
  assert.throws(() => requireRole(vendorClaims, ['COMPLIANCE']), (e: unknown) => {
    assert.ok(e instanceof AuthorizationError);
    assert.equal((e as AuthorizationError).httpStatus, 403);
    return true;
  });
});

test('guard: the right role passes through', () => {
  const priya: AuthClaims = { ...vendorClaims, role: 'COMPLIANCE', buyerId: 'b1', vendorId: null };
  assert.doesNotThrow(() => requireRole(priya, ['COMPLIANCE']));
});
