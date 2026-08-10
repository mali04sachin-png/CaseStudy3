// Phase 3 integration tests — run against the live Supabase DB.
// Skipped automatically if DATABASE_URL is not set.
//
// Proves the Phase 3 acceptance criteria:
//   AC1. A vendor cannot register without DPDP consent.
//   AC2. A badly formatted GSTIN is rejected locally; the provider is never called.
//   AC3. A COMPLIANCE user of Buyer A sees only Buyer A's data.
//   AC4. Role is set by the account, never by the request (login).
//   AC5. A VENDOR calling a COMPLIANCE-only guard gets 403 (see auth-unit too).
//   AC6. A BUYER_ADMIN can only create a COMPLIANCE user in their OWN tenant.

import { test, before, after } from 'node:test';
import assert from 'node:assert';

import { createClient } from '../src/db/client.ts';
import { provisionBuyer } from '../src/services/buyers.ts';
import { registerVendor } from '../src/services/vendors.ts';
import { inviteComplianceUser } from '../src/services/invites.ts';
import { login } from '../src/services/auth.ts';
import { listVisibleVendorLinks } from '../src/services/access.ts';
import { GRVL } from '../src/verification/grvl.ts';
import { MockVerificationProvider } from '../src/verification/providers/mock-provider.ts';
import { ConsentRequiredError, ValidationError, AuthorizationError } from '../src/auth/errors.ts';
import type { AuthClaims } from '../src/auth/jwt.ts';

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL;
const RID = Date.now().toString(36); // unique suffix so reruns don't collide

let db: any;
const createdVendorIds: string[] = [];
const createdBuyerIds: string[] = [];
const createdEmails: string[] = [];

function makeGrvl() {
  const primary = new MockVerificationProvider({ name: 'eKYCNow' });
  const secondary = new MockVerificationProvider({ name: 'Deepvue' });
  return { grvl: new GRVL(primary, secondary), primary, secondary };
}

before(async () => {
  if (skip) return;
  db = createClient(DB_URL);
  await db.connect();
});

after(async () => {
  if (skip || !db) return;
  // Order matters: links (ON DELETE RESTRICT) first, then users, then vendors/buyers.
  if (createdVendorIds.length || createdBuyerIds.length) {
    await db.query(
      'delete from buyer_vendor_links where vendor_id = any($1) or buyer_id = any($2)',
      [createdVendorIds, createdBuyerIds],
    );
  }
  if (createdEmails.length) {
    await db.query('delete from users where email = any($1)', [createdEmails]);
  }
  if (createdVendorIds.length) {
    await db.query('delete from vendors where id = any($1)', [createdVendorIds]);
  }
  if (createdBuyerIds.length) {
    await db.query('delete from buyers where id = any($1)', [createdBuyerIds]);
  }
  await db.end();
});

test('AC1: registration without consent is rejected, and no provider is called', { skip }, async () => {
  const { grvl, primary } = makeGrvl();
  await assert.rejects(
    () =>
      registerVendor(db, grvl, {
        legalName: 'No Consent Co',
        vendorType: 'Proprietary',
        gstNumber: '27AAAAA1111A1Z1',
        panNumber: 'AAAAA1111A',
        email: `noconsent-${RID}@t.com`,
        password: 'pw',
        consentGiven: false,
        consentManagerRef: 'cm-ref',
      }),
    ConsentRequiredError,
  );
  assert.equal(primary.calls, 0, 'no verification call should happen without consent');
});

test('AC2: a badly formatted GSTIN is rejected locally, provider never called', { skip }, async () => {
  const { grvl, primary } = makeGrvl();
  await assert.rejects(
    () =>
      registerVendor(db, grvl, {
        legalName: 'Bad GST Co',
        vendorType: 'Proprietary',
        gstNumber: 'NOT-A-GSTIN',
        panNumber: 'AAAAA1111A',
        email: `badgst-${RID}@t.com`,
        password: 'pw',
        consentGiven: true,
        consentManagerRef: 'cm-ref',
      }),
    ValidationError,
  );
  assert.equal(primary.calls, 0, 'format check must precede any paid API call');
});

test('happy path: a consented, well-formed vendor is fully created', { skip }, async () => {
  const { grvl } = makeGrvl();
  const email = `ravi-${RID}@t.com`;
  const res = await registerVendor(db, grvl, {
    legalName: 'Ravi Logistics',
    vendorType: 'Proprietary',
    gstNumber: '27AAAAA1111A1Z1',
    panNumber: 'AAAAA1111A',
    email,
    password: 'ravi-pw',
    consentGiven: true,
    consentManagerRef: 'cm-ref-1',
  });
  createdVendorIds.push(res.vendorId);
  createdEmails.push(email);

  // The VENDOR user is tied to a vendor, not a buyer.
  const { rows: urows } = await db.query(
    'select role, vendor_id, buyer_id from users where id = $1',
    [res.userId],
  );
  assert.equal(urows[0].role, 'VENDOR');
  assert.equal(urows[0].vendor_id, res.vendorId);
  assert.equal(urows[0].buyer_id, null);

  // Passport, proof, and consent all exist.
  const { rows: prows } = await db.query('select status from trust_passports where id = $1', [
    res.passportId,
  ]);
  assert.equal(prows[0].status, 'ACTIVE');
  const { rows: vrows } = await db.query(
    'select count(*)::int n from verification_records where passport_id = $1',
    [res.passportId],
  );
  assert.equal(vrows[0].n, 1);
  const { rows: crows } = await db.query(
    'select count(*)::int n from consent_records where vendor_id = $1',
    [res.vendorId],
  );
  assert.equal(crows[0].n, 1);
});

test('AC4: login stamps the role from the account (client never picks it)', { skip }, async () => {
  const { grvl } = makeGrvl();
  const email = `login-${RID}@t.com`;
  const reg = await registerVendor(db, grvl, {
    legalName: 'Login Vendor',
    vendorType: 'Proprietary',
    gstNumber: '27AAAAA2222A2Z2',
    panNumber: 'AAAAA2222A',
    email,
    password: 'top-secret',
    consentGiven: true,
    consentManagerRef: 'cm-ref-2',
  });
  createdVendorIds.push(reg.vendorId);
  createdEmails.push(email);

  const { claims } = await login(db, email, 'top-secret');
  assert.equal(claims.role, 'VENDOR'); // came from the DB row, not the request
  assert.equal(claims.vendorId, reg.vendorId);

  await assert.rejects(() => login(db, email, 'wrong-password'));
});

test('AC6: BUYER_ADMIN invites a COMPLIANCE user into their OWN tenant only', { skip }, async () => {
  const adminEmail = `admin-${RID}@t.com`;
  const prov = await provisionBuyer(db, {
    orgName: 'Buyer Org',
    erpType: 'STANDALONE',
    adminEmail,
    adminPassword: 'admin-pw',
  });
  createdBuyerIds.push(prov.buyerId);
  createdEmails.push(adminEmail);

  const adminClaims: AuthClaims = {
    sub: prov.adminUserId,
    email: adminEmail,
    role: 'BUYER_ADMIN',
    buyerId: prov.buyerId,
    vendorId: null,
  };

  const inviteeEmail = `priya-${RID}@t.com`;
  const invited = await inviteComplianceUser(db, adminClaims, {
    email: inviteeEmail,
    password: 'priya-pw',
  });
  createdEmails.push(inviteeEmail);

  const { rows } = await db.query('select role, buyer_id from users where id = $1', [
    invited.userId,
  ]);
  assert.equal(rows[0].role, 'COMPLIANCE');
  assert.equal(rows[0].buyer_id, prov.buyerId, 'invitee inherits the admin tenant, nothing else');

  // A non-admin (VENDOR) may not invite at all.
  const vendorClaims: AuthClaims = {
    sub: 'x',
    email: 'v@t.com',
    role: 'VENDOR',
    buyerId: null,
    vendorId: 'x',
  };
  await assert.rejects(
    () => inviteComplianceUser(db, vendorClaims, { email: `nope-${RID}@t.com`, password: 'p' }),
    AuthorizationError,
  );
});

test('AC3: a COMPLIANCE user of Buyer A sees only Buyer A data (RLS)', { skip }, async () => {
  // Two tenants, one shared vendor, each with its own link.
  const { rows: br } = await db.query(
    `insert into buyers (org_name, erp_type) values ('A-${RID}','STANDALONE'),('B-${RID}','ORACLE_FUSION')
     returning id`,
  );
  const buyerA = br[0].id;
  const buyerB = br[1].id;
  createdBuyerIds.push(buyerA, buyerB);

  const { rows: vr } = await db.query(
    `insert into vendors (legal_name, vendor_type) values ('Shared-${RID}','Proprietary') returning id`,
  );
  const vendorId = vr[0].id;
  createdVendorIds.push(vendorId);

  await db.query(
    'insert into buyer_vendor_links (buyer_id, vendor_id) values ($1,$3),($2,$3)',
    [buyerA, buyerB, vendorId],
  );

  const priyaA: AuthClaims = {
    sub: 'priya',
    email: 'priya@t.com',
    role: 'COMPLIANCE',
    buyerId: buyerA,
    vendorId: null,
  };

  const visible = await listVisibleVendorLinks(db, priyaA);
  assert.equal(visible.length, 1, 'should see exactly its own tenant row');
  assert.equal(visible[0].buyer_id, buyerA);
});
