// Phase 7 tests — ERP-agnostic pull API (bulk + incremental).
//
// Acceptance criteria (Pramaan_Implementation_Plan.md, Phase 7):
//   AC1. Even with page_size huge, never > 500 rows and never another buyer's vendors.
//   AC2. A `since` older than retention returns resync_required: true.
//   AC3. A fresh `since` returns only vendors changed after it, plus next_since.

import { test, before, after } from 'node:test';
import assert from 'node:assert';

import { createClient } from '../src/db/client.ts';
import { bulkVendors, changedVendors } from '../src/pull/vendors.ts';
import { clampPageSize, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '../src/pull/pagination.ts';
import { AuthorizationError } from '../src/auth/errors.ts';
import type { AuthClaims } from '../src/auth/jwt.ts';

test('clampPageSize: default, floor, and hard cap', () => {
  assert.equal(clampPageSize(undefined), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(0), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(50), 50);
  assert.equal(clampPageSize(100000), MAX_PAGE_SIZE);
  assert.equal(clampPageSize(-5), DEFAULT_PAGE_SIZE);
});

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
  if (vendorIds.length || buyerIds.length) {
    await db.query('delete from buyer_vendor_links where vendor_id = any($1) or buyer_id = any($2)', [
      vendorIds,
      buyerIds,
    ]);
  }
  if (vendorIds.length) await db.query('delete from vendors where id = any($1)', [vendorIds]);
  if (buyerIds.length) await db.query('delete from buyers where id = any($1)', [buyerIds]);
  await db.end();
});

async function newBuyer(suffix: string): Promise<string> {
  const { rows } = await db.query(
    `insert into buyers (org_name, erp_type) values ($1,'NETSUITE') returning id`,
    [`Buyer-${RID}-${suffix}`],
  );
  buyerIds.push(rows[0].id);
  return rows[0].id;
}

/** Create a vendor linked to a buyer, with a passport at a chosen updated_at. */
async function newLinkedVendor(buyerId: string, gst: string, updatedAt: string): Promise<string> {
  const { rows: vr } = await db.query(
    `insert into vendors (legal_name, vendor_type) values ($1,'Proprietary') returning id`,
    [`Vendor-${gst}`],
  );
  const vendorId = vr[0].id;
  vendorIds.push(vendorId);
  await db.query(
    `insert into trust_passports
       (vendor_id, gst_number, registered_address, msme_classification, status, updated_at)
     values ($1,$2,$3,'NOT_APPLICABLE','ACTIVE',$4)`,
    [vendorId, gst, JSON.stringify({}), updatedAt],
  );
  await db.query('insert into buyer_vendor_links (buyer_id, vendor_id) values ($1,$2)', [
    buyerId,
    vendorId,
  ]);
  return vendorId;
}

function claimsFor(buyerId: string): AuthClaims {
  return { sub: 'u', email: 'admin@t.com', role: 'BUYER_ADMIN', buyerId, vendorId: null };
}

test('AC1: huge page_size is capped at 500 and only own vendors are returned', { skip }, async () => {
  const now = new Date().toISOString();
  const buyerA = await newBuyer('A');
  const buyerB = await newBuyer('B');
  await newLinkedVendor(buyerA, `27AAAAA0001A1Z1`, now);
  await newLinkedVendor(buyerA, `27AAAAA0002A1Z1`, now);
  await newLinkedVendor(buyerB, `27AAAAA0003A1Z1`, now); // other tenant

  const res = await bulkVendors(db, claimsFor(buyerA), buyerA, { pageSize: 100000 });
  assert.equal(res.pageSize, 500, 'page size clamped to the hard cap');
  assert.equal(res.count, 2, 'only Buyer A vendors');
  assert.ok(res.vendors.every((v: any) => v.gst_number !== '27AAAAA0003A1Z1'));

  // Cannot pull another tenant's list at all.
  await assert.rejects(() => bulkVendors(db, claimsFor(buyerA), buyerB), AuthorizationError);
});

test('AC2: a `since` older than retention returns resync_required', { skip }, async () => {
  const buyer = await newBuyer('C');
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const res = await changedVendors(db, claimsFor(buyer), buyer, { since: sixtyDaysAgo });
  assert.equal(res.resync_required, true);
  assert.ok(!('vendors' in res), 'no partial list masquerading as complete');
});

test('AC3: a fresh `since` returns only later changes plus next_since', { skip }, async () => {
  const buyer = await newBuyer('D');
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  await newLinkedVendor(buyer, `27AAAAA0004A1Z1`, oneHourAgo); // changed BEFORE `since`
  await newLinkedVendor(buyer, `27AAAAA0005A1Z1`, now); // changed AFTER `since`

  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
  const res = await changedVendors(db, claimsFor(buyer), buyer, { since });

  assert.equal(res.resync_required, false);
  assert.equal(res.count, 1, 'only the vendor changed after `since`');
  assert.equal(res.vendors[0].gst_number, '27AAAAA0005A1Z1');
  assert.ok(res.next_since, 'a next cursor is returned');
});
