// Phase 3 — vendor self-registration.
// Order matters and is enforced here:
//   1. No consent  → reject (400), touch nothing.
//   2. Bad format  → reject (400), never call the paid verification API.
//   3. Verify GSTIN via GRVL (Phase 2).
//   4. Create vendor + passport + proof + VENDOR user + consent record atomically.

import { hashPassword } from '../auth/password.ts';
import { isValidGSTIN, isValidPAN } from '../verification/validation.ts';
import { ValidationError, ConsentRequiredError } from '../auth/errors.ts';
import type { GRVL } from '../verification/grvl.ts';

export interface RegisterVendorInput {
  legalName: string;
  vendorType: string; // Proprietary / Partnership / Private Limited
  gstNumber: string;
  panNumber: string;
  email: string;
  password: string;
  consentGiven: boolean;
  consentManagerRef: string;
}

export async function registerVendor(db: any, grvl: GRVL, input: RegisterVendorInput) {
  // 1. Consent gate — the hard legal rule. Refuse before doing anything else.
  if (input.consentGiven !== true) {
    throw new ConsentRequiredError();
  }

  // 2. Local format checks — reject junk for free, before any paid verification.
  if (!isValidGSTIN(input.gstNumber)) {
    throw new ValidationError(`Invalid GSTIN format: ${input.gstNumber}`);
  }
  if (!isValidPAN(input.panNumber)) {
    throw new ValidationError(`Invalid PAN format: ${input.panNumber}`);
  }

  // 3. Verify against the government registry (GRVL; mock provider in dev).
  const verified = await grvl.verifyGSTIN(input.gstNumber);
  const passportStatus = verified.gstStatus === 'ACTIVE' ? 'ACTIVE' : 'UNVERIFIED';

  // 4. Persist everything in one transaction — all or nothing.
  try {
    await db.query('begin');

    const {
      rows: [vendor],
    } = await db.query(
      'insert into vendors (legal_name, vendor_type) values ($1, $2) returning id',
      [input.legalName, input.vendorType],
    );

    const {
      rows: [passport],
    } = await db.query(
      `insert into trust_passports
         (vendor_id, gst_number, pan_number, registered_address,
          msme_classification, status, gst_last_verified_at)
       values ($1, $2, $3, $4, 'NOT_APPLICABLE', $5, now()) returning id`,
      [vendor.id, input.gstNumber, input.panNumber, JSON.stringify({}), passportStatus],
    );

    await db.query(
      `insert into verification_records
         (passport_id, field_name, source_registry, source_provider, verified_value, status)
       values ($1, 'gst_number', $2, $3, $4, $5)`,
      [
        passport.id,
        verified.sourceRegistry,
        verified.sourceProvider,
        JSON.stringify(verified.raw),
        verified.status,
      ],
    );

    const {
      rows: [user],
    } = await db.query(
      `insert into users (email, password_hash, role, vendor_id)
       values ($1, $2, 'VENDOR', $3) returning id`,
      [input.email, hashPassword(input.password), vendor.id],
    );

    await db.query(
      `insert into consent_records
         (vendor_id, purpose, consent_given_at, consent_manager_ref)
       values ($1, $2, now(), $3)`,
      [
        vendor.id,
        'Government verification & continuous monitoring under DPDP Act 2023',
        input.consentManagerRef,
      ],
    );

    await db.query('commit');
    return {
      vendorId: vendor.id as string,
      passportId: passport.id as string,
      userId: user.id as string,
      verification: verified,
    };
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}
