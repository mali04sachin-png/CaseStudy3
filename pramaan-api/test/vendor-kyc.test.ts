// Vendor self-service (consent → KYC → withdraw). Runs against the live DB;
// skipped without DATABASE_URL.

import { test, before, after } from 'node:test';
import assert from 'node:assert';

import { createClient } from '../src/db/client.ts';
import { submitConsent, submitKyc, withdrawConsent, getMyVendor } from '../src/services/vendor-kyc.ts';
import { GRVL } from '../src/verification/grvl.ts';
import { MockVerificationProvider } from '../src/verification/providers/mock-provider.ts';
import { ConsentRequiredError, ValidationError } from '../src/auth/errors.ts';
import type { AuthClaims } from '../src/auth/jwt.ts';

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL;
const RID = Date.now().toString(36);
let db: any;
const vendorIds: string[] = [];

const grvl = new GRVL(
  new MockVerificationProvider({ name: 'eKYCNow' }),
  new MockVerificationProvider({ name: 'Deepvue' }),
);

before(async () => {
  if (skip) return;
  db = createClient(DB_URL);
  await db.connect();
});
after(async () => {
  if (skip || !db) return;
  if (vendorIds.length) await db.query('delete from vendors where id = any($1)', [vendorIds]);
  await db.end();
});

async function newVendorClaims(): Promise<AuthClaims> {
  const { rows } = await db.query(
    `insert into vendors (legal_name, vendor_type) values ($1,'Proprietorship') returning id`,
    [`KYC-${RID}-${vendorIds.length}`],
  );
  vendorIds.push(rows[0].id);
  return { sub: 'u', email: 'v@t.com', role: 'VENDOR', buyerId: null, vendorId: rows[0].id };
}

const GST = '27ZKYCX1111X1Z1';
const PAN = 'ZKYCX1111X';

test('KYC without consent is refused', { skip }, async () => {
  const claims = await newVendorClaims();
  await assert.rejects(
    () => submitKyc(db, grvl, claims, { gst: GST, pan: PAN, ifsc: 'HDFC0001234' }),
    ConsentRequiredError,
  );
});

test('bad GSTIN is rejected after consent, before any persist', { skip }, async () => {
  const claims = await newVendorClaims();
  await submitConsent(db, claims);
  await assert.rejects(
    () => submitKyc(db, grvl, claims, { gst: 'NOTAGST', pan: PAN, ifsc: 'HDFC0001234' }),
    ValidationError,
  );
});

test('consent → KYC verifies and persists; withdraw erases', { skip }, async () => {
  const claims = await newVendorClaims();
  await submitConsent(db, claims);

  const gst = '27ZKYCY2222Y2Z2';
  const res = await submitKyc(db, grvl, claims, { gst, pan: 'ZKYCY2222Y', bank: '502011044521', ifsc: 'HDFC0004521' });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'ACTIVE');
  assert.ok(res.provider); // came from a real GRVL call

  let me = await getMyVendor(db, claims);
  assert.equal(me.gst_number, gst);
  assert.equal(me.bank_ifsc, 'HDFC0004521');
  assert.equal(me.status, 'ACTIVE');
  assert.equal(me.has_consent, true);

  await withdrawConsent(db, claims);
  me = await getMyVendor(db, claims);
  assert.equal(me.has_consent, false);
  assert.equal(me.bank_ifsc, null); // DPDP erase
  assert.equal(me.gst_number, gst); // GST retained for audit
});
