// Phase 8 tests — profile sharing, reuse & reputation.
//
// Acceptance criteria (Pramaan_Implementation_Plan.md, Phase 8):
//   AC1. A vendor shares their passport with Buyer B in one call — no re-upload.
//   AC2. The reputation score scales with tenure and successful validations.

import { test, before, after } from 'node:test';
import assert from 'node:assert';

import { createClient } from '../src/db/client.ts';
import { shareProfile } from '../src/sharing/share.ts';
import { reputationScore, getVendorReputation } from '../src/sharing/reputation.ts';
import { bulkVendors } from '../src/pull/vendors.ts';
import type { AuthClaims } from '../src/auth/jwt.ts';

// ---- Pure reputation scaling (no DB) ----

test('reputationScore: zero, caps, and monotonic scaling', () => {
  assert.equal(reputationScore({ tenureDays: 0, validationCount: 0 }), 0);
  assert.equal(reputationScore({ tenureDays: 365, validationCount: 0 }), 50); // full tenure
  assert.equal(reputationScore({ tenureDays: 0, validationCount: 10 }), 50); // validation cap
  assert.equal(reputationScore({ tenureDays: 730, validationCount: 20 }), 100); // overall cap

  // More tenure never lowers the score; more validations never lowers it.
  assert.ok(
    reputationScore({ tenureDays: 200, validationCount: 2 }) >
      reputationScore({ tenureDays: 100, validationCount: 2 }),
  );
  assert.ok(
    reputationScore({ tenureDays: 100, validationCount: 4 }) >
      reputationScore({ tenureDays: 100, validationCount: 2 }),
  );
});

// ---- DB-backed. Skipped without DATABASE_URL. ----

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
    `insert into buyers (org_name, erp_type) values ($1,'STANDALONE') returning id`,
    [`Buyer-${RID}-${suffix}`],
  );
  buyerIds.push(rows[0].id);
  return rows[0].id;
}

/** A vendor + passport, with control over created_at and how many VALID checks. */
async function newVendor(gst: string, createdAt: string, validChecks: number): Promise<string> {
  const { rows: vr } = await db.query(
    `insert into vendors (legal_name, vendor_type) values ($1,'Proprietary') returning id`,
    [`Vendor-${gst}`],
  );
  const vendorId = vr[0].id;
  vendorIds.push(vendorId);
  const { rows: pr } = await db.query(
    `insert into trust_passports
       (vendor_id, gst_number, registered_address, msme_classification, status, created_at)
     values ($1,$2,$3,'NOT_APPLICABLE','ACTIVE',$4) returning id`,
    [vendorId, gst, JSON.stringify({}), createdAt],
  );
  const passportId = pr[0].id;
  for (let i = 0; i < validChecks; i++) {
    await db.query(
      `insert into verification_records
         (passport_id, field_name, source_registry, source_provider, verified_value, status)
       values ($1,'gst_number','GSTN','eKYCNow','{}','VALID')`,
      [passportId],
    );
  }
  return vendorId;
}

function vendorClaims(vendorId: string): AuthClaims {
  return { sub: 'u', email: 'ravi@t.com', role: 'VENDOR', buyerId: null, vendorId };
}
function adminClaims(buyerId: string): AuthClaims {
  return { sub: 'a', email: 'admin@t.com', role: 'BUYER_ADMIN', buyerId, vendorId: null };
}

test('AC1: a vendor shares with a new buyer in one call, with no passport re-upload', { skip }, async () => {
  const now = new Date().toISOString();
  const vendorId = await newVendor(`27AAAAA8001A1Z1`, now, 1);
  const buyerB = await newBuyer('B');

  const res = await shareProfile(db, vendorClaims(vendorId), buyerB);
  assert.equal(res.newlyShared, true);

  // Exactly ONE passport still — nothing was re-uploaded or duplicated.
  const { rows: pc } = await db.query(
    'select count(*)::int n from trust_passports where vendor_id = $1',
    [vendorId],
  );
  assert.equal(pc[0].n, 1);

  // Buyer B now sees the vendor through the pull API.
  const pulled = await bulkVendors(db, adminClaims(buyerB), buyerB);
  assert.ok(pulled.vendors.some((v: any) => v.vendor_id === vendorId));

  // Sharing again is idempotent — no duplicate link.
  const again = await shareProfile(db, vendorClaims(vendorId), buyerB);
  assert.equal(again.newlyShared, false);
  const { rows: lc } = await db.query(
    'select count(*)::int n from buyer_vendor_links where vendor_id = $1 and buyer_id = $2',
    [vendorId, buyerB],
  );
  assert.equal(lc[0].n, 1);
});

test('AC2: reputation reflects tenure and validation history', { skip }, async () => {
  const twoHundredDaysAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const seasoned = await newVendor(`27AAAAA8002A1Z1`, twoHundredDaysAgo, 4);
  const fresh = await newVendor(`27AAAAA8003A1Z1`, now, 0);

  const repSeasoned = await getVendorReputation(db, seasoned);
  const repFresh = await getVendorReputation(db, fresh);

  assert.ok(repSeasoned.score > repFresh.score, 'a seasoned vendor outranks a brand-new one');
  assert.equal(repFresh.score, 0);
  assert.equal(repSeasoned.validationCount, 4);
  assert.ok(repSeasoned.tenureDays >= 199 && repSeasoned.tenureDays <= 201);
});
