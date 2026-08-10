// Phase 5 integration tests — run against the live Supabase DB.
// Skipped if DATABASE_URL is unset.
//
// Acceptance criteria (Pramaan_Implementation_Plan.md, Phase 5):
//   AC1. A bank-detail-change alert routes exclusively to the FINANCE role.
//   AC2. Acting on an alert appends a non-deletable entry to audit_log_entries.

import { test, before, after } from 'node:test';
import assert from 'node:assert';

import { createClient } from '../src/db/client.ts';
import { recordChange } from '../src/monitoring/cme.ts';
import { listPendingAlerts } from '../src/alerts/dashboard.ts';
import { alertsForRole } from '../src/alerts/routing.ts';
import { actOnAlert } from '../src/alerts/actions.ts';
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
  // NOTE: audit_log_entries rows created here are append-only and intentionally
  // cannot be deleted — that immutability is the whole point of Phase 5.
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

async function seedVendorWithBankAlert(suffix: string) {
  const { rows: br } = await db.query(
    `insert into buyers (org_name, erp_type) values ($1,'STANDALONE') returning id`,
    [`Buyer-${RID}-${suffix}`],
  );
  const buyerId = br[0].id;
  buyerIds.push(buyerId);

  const { rows: vr } = await db.query(
    `insert into vendors (legal_name, vendor_type) values ($1,'Proprietary') returning id`,
    [`Vendor-${RID}-${suffix}`],
  );
  const vendorId = vr[0].id;
  vendorIds.push(vendorId);

  const { rows: pr } = await db.query(
    `insert into trust_passports
       (vendor_id, gst_number, registered_address, msme_classification, status)
     values ($1,$2,$3,'NOT_APPLICABLE','ACTIVE') returning id`,
    [vendorId, `27AAAAA${suffix}A1Z1`, JSON.stringify({})],
  );
  const passportId = pr[0].id;

  await db.query(
    `insert into buyer_vendor_links (buyer_id, vendor_id, internal_criticality) values ($1,$2,'CRITICAL')`,
    [buyerId, vendorId],
  );

  // A bank-account change → material → alert routed to FINANCE.
  const { alertId } = await recordChange(db, {
    vendorId,
    buyerId,
    passportId,
    fieldName: 'bank_account_num',
    internalCriticality: 'CRITICAL',
    changeType: 'BANK_CHANGE',
    before: { acct: '****1111' },
    after: { acct: '****9999' },
  });

  return { buyerId, vendorId, alertId: alertId as string };
}

test('AC1: a bank-detail change routes exclusively to FINANCE', { skip }, async () => {
  const { buyerId, alertId } = await seedVendorWithBankAlert('7001');

  const priya: AuthClaims = {
    sub: 'priya',
    email: `priya-${RID}@t.com`,
    role: 'COMPLIANCE',
    buyerId,
    vendorId: null,
  };

  // The alert itself carries FINANCE.
  const { rows } = await db.query('select routed_to_role, severity from alerts where id = $1', [
    alertId,
  ]);
  assert.equal(rows[0].routed_to_role, 'FINANCE');
  assert.equal(rows[0].severity, 'CRITICAL');

  // The routing engine surfaces it under FINANCE, and NOT under COMPLIANCE.
  const finance = await alertsForRole(db, priya, 'FINANCE');
  assert.ok(finance.some((a) => a.id === alertId), 'should appear for FINANCE');

  const compliance = await alertsForRole(db, priya, 'COMPLIANCE');
  assert.ok(!compliance.some((a) => a.id === alertId), 'must NOT appear for COMPLIANCE');
});

test('dashboard is tenant-scoped: another buyer cannot see this alert', { skip }, async () => {
  const { alertId } = await seedVendorWithBankAlert('7002');

  const otherBuyer: AuthClaims = {
    sub: 'x',
    email: 'other@t.com',
    role: 'COMPLIANCE',
    buyerId: '00000000-0000-0000-0000-000000000000', // a tenant that owns nothing
    vendorId: null,
  };
  const visible = await listPendingAlerts(db, otherBuyer);
  assert.ok(!visible.some((a) => a.id === alertId), 'RLS must hide other tenants alerts');
});

test('AC2: acting on an alert appends a non-deletable audit entry', { skip }, async () => {
  const { buyerId, alertId } = await seedVendorWithBankAlert('7003');

  const priya: AuthClaims = {
    sub: 'priya',
    email: `priya-${RID}@t.com`,
    role: 'COMPLIANCE',
    buyerId,
    vendorId: null,
  };

  const result = await actOnAlert(db, priya, alertId, 'RESOLVE');
  assert.equal(result.status, 'RESOLVED');

  // Alert moved to RESOLVED.
  const { rows: ar } = await db.query('select status from alerts where id = $1', [alertId]);
  assert.equal(ar[0].status, 'RESOLVED');

  // An audit entry exists for this action.
  const { rows: lr } = await db.query(
    `select id, action, actor from audit_log_entries
       where entity_type = 'alerts' and entity_id = $1 and action = 'ALERT_RESOLVE'`,
    [alertId],
  );
  assert.equal(lr.length, 1);
  assert.equal(lr[0].actor, priya.email);

  // And it cannot be deleted or altered (append-only).
  await assert.rejects(
    () => db.query('delete from audit_log_entries where id = $1', [lr[0].id]),
    /append-only/,
  );
});

test('acting on another tenant\'s alert is refused', { skip }, async () => {
  const { alertId } = await seedVendorWithBankAlert('7004');

  const intruder: AuthClaims = {
    sub: 'z',
    email: 'intruder@t.com',
    role: 'COMPLIANCE',
    buyerId: '00000000-0000-0000-0000-000000000000',
    vendorId: null,
  };
  await assert.rejects(() => actOnAlert(db, intruder, alertId, 'RESOLVE'), AuthorizationError);
});
