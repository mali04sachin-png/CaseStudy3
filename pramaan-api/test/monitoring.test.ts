// Phase 4 integration tests — run against the live Supabase DB.
// Skipped if DATABASE_URL is unset.
//
// Acceptance criteria (Pramaan_Implementation_Plan.md, Phase 4):
//   AC1. A suspended GST status on the (mock) registry triggers an alert record.
//   AC2. A non-essential address change is logged in verification_records but
//        raises NO active alert.

import { test, before, after } from 'node:test';
import assert from 'node:assert';

import { createClient } from '../src/db/client.ts';
import { runMonitoringCycle, recordChange } from '../src/monitoring/cme.ts';
import { getMaterialityRule, isMaterial } from '../src/monitoring/materiality.ts';
import { GRVL } from '../src/verification/grvl.ts';
import { MockVerificationProvider } from '../src/verification/providers/mock-provider.ts';

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
  // links (ON DELETE RESTRICT) first; deleting the vendor cascades passports,
  // verification_records, and alerts.
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

/** Create a buyer, a vendor+ACTIVE passport, and link them at a given criticality. */
async function seedLinkedVendor(criticality: string, gstSuffix: string) {
  const { rows: br } = await db.query(
    `insert into buyers (org_name, erp_type) values ($1,'STANDALONE') returning id`,
    [`Buyer-${RID}-${gstSuffix}`],
  );
  const buyerId = br[0].id;
  buyerIds.push(buyerId);

  const { rows: vr } = await db.query(
    `insert into vendors (legal_name, vendor_type) values ($1,'Proprietary') returning id`,
    [`Vendor-${RID}-${gstSuffix}`],
  );
  const vendorId = vr[0].id;
  vendorIds.push(vendorId);

  const { rows: pr } = await db.query(
    `insert into trust_passports
       (vendor_id, gst_number, registered_address, msme_classification, status)
     values ($1,$2,$3,'NOT_APPLICABLE','ACTIVE') returning id`,
    [vendorId, `27AAAAA${gstSuffix}A1Z1`, JSON.stringify({ city: 'Pune' })],
  );
  const passportId = pr[0].id;

  await db.query(
    `insert into buyer_vendor_links (buyer_id, vendor_id, internal_criticality) values ($1,$2,$3)`,
    [buyerId, vendorId, criticality],
  );

  return { buyerId, vendorId, passportId };
}

test('AC1: a suspended GST status triggers an alert routed to Finance', { skip }, async () => {
  const { vendorId, buyerId } = await seedLinkedVendor('CRITICAL', '1234');

  // The mock registry now reports this vendor's GST as SUSPENDED.
  const grvl = new GRVL(
    new MockVerificationProvider({ name: 'eKYCNow', gstStatus: 'SUSPENDED' }),
    new MockVerificationProvider({ name: 'Deepvue', gstStatus: 'SUSPENDED' }),
  );

  const summary = await runMonitoringCycle(db, grvl, { vendorIds: [vendorId] });
  assert.equal(summary.checked, 1);
  assert.equal(summary.alerts, 1);

  const { rows } = await db.query(
    `select change_type, severity, routed_to_role, status
       from alerts where vendor_id = $1 and buyer_id = $2`,
    [vendorId, buyerId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].change_type, 'GST_SUSPENDED');
  assert.equal(rows[0].severity, 'HIGH'); // gst_number + CRITICAL → HIGH
  assert.equal(rows[0].routed_to_role, 'FINANCE');
  assert.equal(rows[0].status, 'NEW');

  // The passport was updated to reflect the new status.
  const { rows: prows } = await db.query(
    'select status from trust_passports where vendor_id = $1',
    [vendorId],
  );
  assert.equal(prows[0].status, 'SUSPENDED');
});

test('AC2: a non-essential address change is logged but raises no alert', { skip }, async () => {
  const { vendorId, buyerId, passportId } = await seedLinkedVendor('NON_ESSENTIAL', '5678');

  const before = { city: 'Pune' };
  const after = { city: 'Mumbai' };

  const res = await recordChange(db, {
    vendorId,
    buyerId,
    passportId,
    fieldName: 'registered_address',
    internalCriticality: 'NON_ESSENTIAL',
    changeType: 'ADDRESS_CHANGE',
    before,
    after,
  });

  // Logged to the proof trail...
  assert.ok(res.verificationRecordId);
  const { rows: vr } = await db.query(
    `select count(*)::int n from verification_records
       where passport_id = $1 and field_name = 'registered_address'`,
    [passportId],
  );
  assert.equal(vr[0].n, 1);

  // ...but NO alert.
  assert.equal(res.alertId, null);
  const { rows: ar } = await db.query('select count(*)::int n from alerts where vendor_id = $1', [
    vendorId,
  ]);
  assert.equal(ar[0].n, 0);
});

test('materiality rules: bank change is material, non-essential address is not', { skip }, async () => {
  const bank = await getMaterialityRule(db, 'bank_account_num', 'CRITICAL');
  assert.ok(isMaterial(bank));
  assert.equal(bank!.severity, 'CRITICAL');
  assert.equal(bank!.routed_to_role, 'FINANCE');

  const addr = await getMaterialityRule(db, 'registered_address', 'NON_ESSENTIAL');
  assert.ok(!isMaterial(addr), 'non-essential address change must be silent');
});
