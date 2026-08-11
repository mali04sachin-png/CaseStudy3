// Verified-vendor directory: opt-in, cross-buyer search, one-click onboard.
// Runs against the live DB; skipped without DATABASE_URL.

import { test, before, after } from 'node:test';
import assert from 'node:assert';

import { createClient } from '../src/db/client.ts';
import { setDiscoverable, searchDirectory, onboardVendor } from '../src/directory/directory.ts';
import { AuthorizationError } from '../src/auth/errors.ts';
import type { AuthClaims } from '../src/auth/jwt.ts';

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL;
const RID = Date.now().toString(36);
let db: any;
const vendorIds: string[] = [];
const buyerIds: string[] = [];

before(async () => {
  if (skip) return;
  db = createClient(DB_URL);
  await db.connect();
});
after(async () => {
  if (skip || !db) return;
  await db.query('delete from buyer_vendor_links where vendor_id = any($1) or buyer_id = any($2)', [vendorIds, buyerIds]);
  if (vendorIds.length) await db.query('delete from vendors where id = any($1)', [vendorIds]);
  if (buyerIds.length) await db.query('delete from buyers where id = any($1)', [buyerIds]);
  await db.end();
});

async function newVendor(gst: string, discoverable: boolean): Promise<string> {
  const { rows: v } = await db.query(
    `insert into vendors (legal_name, vendor_type) values ($1,'Proprietorship') returning id`,
    [`Dir-${RID}-${gst}`],
  );
  vendorIds.push(v[0].id);
  await db.query(
    `insert into trust_passports (vendor_id, gst_number, registered_address, msme_classification, status, is_discoverable)
     values ($1,$2,'{}'::jsonb,'MICRO','ACTIVE',$3)`,
    [v[0].id, gst, discoverable],
  );
  return v[0].id;
}
async function newBuyer(): Promise<string> {
  const { rows } = await db.query(`insert into buyers (org_name, erp_type) values ($1,'STANDALONE') returning id`, [`Buyer-${RID}`]);
  buyerIds.push(rows[0].id);
  return rows[0].id;
}

test('vendor opt-in toggles discoverability', { skip }, async () => {
  const vid = await newVendor(`27DIRA0001A1Z1`, false);
  const claims: AuthClaims = { sub: 'u', email: 'v@t.com', role: 'VENDOR', buyerId: null, vendorId: vid };
  await setDiscoverable(db, claims, true);
  const { rows } = await db.query('select is_discoverable from trust_passports where vendor_id = $1', [vid]);
  assert.equal(rows[0].is_discoverable, true);
});

test('directory shows discoverable vendors only; onboard is one-click + idempotent', { skip }, async () => {
  const discoverable = await newVendor(`27DIRB0002B2Z2`, true);
  const hidden = await newVendor(`27DIRC0003C3Z3`, false);
  const buyer = await newBuyer();
  const admin: AuthClaims = { sub: 'a', email: 'a@t.com', role: 'BUYER_ADMIN', buyerId: buyer, vendorId: null };

  let dir = await searchDirectory(db, admin);
  const ids = dir.map((x: any) => x.vendor_id);
  assert.ok(ids.includes(discoverable), 'discoverable vendor is listed');
  assert.ok(!ids.includes(hidden), 'non-discoverable vendor is hidden');
  const before = dir.find((x: any) => x.vendor_id === discoverable);
  assert.equal(before.already_onboarded, false);
  assert.ok(!('tenant_overlay_data' in before), 'no private overlay leaked');

  const r1 = await onboardVendor(db, admin, discoverable);
  assert.equal(r1.newlyOnboarded, true);
  const r2 = await onboardVendor(db, admin, discoverable);
  assert.equal(r2.newlyOnboarded, false); // idempotent

  dir = await searchDirectory(db, admin);
  assert.equal(dir.find((x: any) => x.vendor_id === discoverable).already_onboarded, true);
});

test('cannot onboard a non-discoverable vendor', { skip }, async () => {
  const hidden = await newVendor(`27DIRD0004D4Z4`, false);
  const buyer = await newBuyer();
  const admin: AuthClaims = { sub: 'a', email: 'a@t.com', role: 'BUYER_ADMIN', buyerId: buyer, vendorId: null };
  await assert.rejects(() => onboardVendor(db, admin, hidden), AuthorizationError);
});
