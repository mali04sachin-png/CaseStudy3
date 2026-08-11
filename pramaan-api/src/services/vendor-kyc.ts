// Vendor self-service: consent → KYC (verify + persist) → withdraw (DPDP erase).
// All scoped to the logged-in VENDOR (AUTH.vendorId). Maps INTEGRATION.md's
// /vendors/:id/consent, /kyc, /withdraw to real backend actions.

import type { AuthClaims } from '../auth/jwt.ts';
import { requireRole } from '../auth/guard.ts';
import { ConsentRequiredError, ValidationError, AuthorizationError, AppError } from '../auth/errors.ts';
import { isValidGSTIN, isValidPAN, isValidIFSC } from '../verification/validation.ts';
import type { GRVL } from '../verification/grvl.ts';

function ownVendorId(claims: AuthClaims): string {
  requireRole(claims, ['VENDOR']);
  if (!claims.vendorId) throw new AuthorizationError('No vendor is bound to this token');
  return claims.vendorId;
}

/** Record fresh DPDP consent for the vendor (reactivates after a withdrawal). */
export async function submitConsent(db: any, claims: AuthClaims) {
  const vid = ownVendorId(claims);
  await db.query(
    `insert into consent_records (vendor_id, purpose, consent_given_at, consent_manager_ref, is_withdrawn)
     values ($1, 'Continuous verification & monitoring under DPDP Act 2023', now(), 'cm-app', false)`,
    [vid],
  );
  return { ok: true, consent: 'granted' };
}

/** Submit KYC: local format checks → GRVL verify (circuit breaker + failover) →
 *  upsert the vendor's passport + append a verification record. Consent required. */
export async function submitKyc(
  db: any,
  grvl: GRVL,
  claims: AuthClaims,
  input: { gst: string; pan: string; bank?: string; ifsc?: string },
) {
  const vid = ownVendorId(claims);

  const { rows: c } = await db.query(
    `select 1 from consent_records where vendor_id = $1 and is_withdrawn = false
       order by consent_given_at desc limit 1`,
    [vid],
  );
  if (!c[0]) throw new ConsentRequiredError('Consent is required before KYC');

  const gst = (input.gst || '').toUpperCase();
  const pan = (input.pan || '').toUpperCase();
  const ifsc = (input.ifsc || '').toUpperCase();
  if (!isValidGSTIN(gst)) throw new ValidationError('Invalid GSTIN format');
  if (!isValidPAN(pan)) throw new ValidationError('Invalid PAN format');
  if (ifsc && !isValidIFSC(ifsc)) throw new ValidationError('Invalid IFSC format');

  const verified = await grvl.verifyGSTIN(gst); // primary → backup failover inside
  const status = verified.gstStatus === 'ACTIVE' ? 'ACTIVE' : 'UNVERIFIED';

  const { rows: pp } = await db.query(
    `insert into trust_passports
        (vendor_id, gst_number, pan_number, bank_ifsc, registered_address,
         msme_classification, status, gst_last_verified_at, updated_at)
     values ($1,$2,$3,$4,'{}'::jsonb,'NOT_APPLICABLE',$5, now(), now())
     on conflict (vendor_id) do update
        set gst_number = excluded.gst_number, pan_number = excluded.pan_number,
            bank_ifsc = excluded.bank_ifsc, status = excluded.status,
            gst_last_verified_at = now(), updated_at = now()
     returning id`,
    [vid, gst, pan, ifsc || null, status],
  );
  await db.query(
    `insert into verification_records
        (passport_id, field_name, source_registry, source_provider, verified_value, status)
     values ($1, 'gst_number', $2, $3, $4, $5)`,
    [pp[0].id, verified.sourceRegistry, verified.sourceProvider, JSON.stringify(verified.raw), verified.status],
  );

  return { ok: true, provider: verified.sourceProvider, gstStatus: verified.gstStatus, status };
}

/** DPDP "Right to Erase": withdraw consent, null sensitive fields, keep GST/PAN. */
export async function withdrawConsent(db: any, claims: AuthClaims) {
  const vid = ownVendorId(claims);
  await db.query(
    `update consent_records set is_withdrawn = true, withdrawn_at = now()
      where vendor_id = $1 and is_withdrawn = false`,
    [vid],
  );
  await db.query(
    `update trust_passports
        set bank_ifsc = null, bank_account_num_encrypted = null,
            registered_address = '{}'::jsonb, updated_at = now()
      where vendor_id = $1`,
    [vid],
  );
  return { ok: true, consent: 'withdrawn' };
}

/** The logged-in vendor's own passport snapshot (for their screen). */
export async function getMyVendor(db: any, claims: AuthClaims) {
  const vid = ownVendorId(claims);
  const { rows } = await db.query(
    `select v.legal_name, p.gst_number, p.pan_number, p.bank_ifsc,
            p.msme_classification as msme, p.status,
            (select count(*) > 0 from consent_records c
               where c.vendor_id = v.id and c.is_withdrawn = false) as has_consent
       from vendors v
       left join trust_passports p on p.vendor_id = v.id
      where v.id = $1`,
    [vid],
  );
  if (!rows[0]) throw new AppError('Vendor not found', 404);
  return rows[0];
}
