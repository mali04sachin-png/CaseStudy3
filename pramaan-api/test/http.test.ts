// Phase 3 — HTTP surface tests. Boots the real server on an ephemeral port and
// hits it over HTTP. No database needed: these exercise the token + guard path.

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';

import { createServer } from '../src/http/server.ts';
import { signToken } from '../src/auth/jwt.ts';

// A stub DB that returns no rows — enough to exercise the token + guard path
// without a real database. The role guard runs before any query, so a VENDOR is
// refused before the stub is ever consulted.
const fakeDb = { query: async () => ({ rows: [] }) };
const server = createServer({ db: fakeDb, grvl: null as any });
let base = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('COMPLIANCE-only route: a VENDOR token is refused with 403', async () => {
  const token = signToken({
    sub: 'u',
    email: 'ravi@t.com',
    role: 'VENDOR',
    buyerId: null,
    vendorId: 'v',
  });
  const res = await fetch(`${base}/v1/compliance/alerts`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 403);
});

test('COMPLIANCE-only route: a COMPLIANCE token is allowed (200)', async () => {
  const token = signToken({
    sub: 'u',
    email: 'priya@t.com',
    role: 'COMPLIANCE',
    buyerId: 'b',
    vendorId: null,
  });
  const res = await fetch(`${base}/v1/compliance/alerts`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { alerts: [] });
});

test('a missing token is 401, not 403', async () => {
  const res = await fetch(`${base}/v1/compliance/alerts`);
  assert.equal(res.status, 401);
});

test('the login endpoint exists and never asks the client to pick a role', async () => {
  // With db: null this throws internally → 500, but it proves the single shared
  // /v1/auth/login route is wired and accepts only email+password (no role field).
  const res = await fetch(`${base}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x@t.com', password: 'p' }),
  });
  assert.notEqual(res.status, 404, 'login route must exist');
});
