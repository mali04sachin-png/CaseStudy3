// Phase 8 — reputation score.
// Two honest inputs: tenure (how long the vendor has been verified) and
// validation history (how many successful government checks they've passed).
// The pure function makes the scaling behavior testable on its own; the DB
// wrapper gathers the inputs for a real vendor.

import { AppError } from '../auth/errors.ts';

export interface ReputationInputs {
  tenureDays: number;
  validationCount: number;
}

/** 0–100. Tenure earns up to 50 (full at ~1 year); each successful validation
 *  earns 5, up to 50. Monotonic in both inputs, capped at 100. */
export function reputationScore({ tenureDays, validationCount }: ReputationInputs): number {
  const tenurePoints = Math.min(50, (Math.max(0, tenureDays) / 365) * 50);
  const validationPoints = Math.min(50, Math.max(0, validationCount) * 5);
  return Math.round(Math.min(100, tenurePoints + validationPoints));
}

export async function getVendorReputation(db: any, vendorId: string) {
  const { rows: pr } = await db.query(
    'select id, created_at from trust_passports where vendor_id = $1',
    [vendorId],
  );
  if (!pr[0]) {
    throw new AppError('Vendor passport not found', 404);
  }
  const passportId = pr[0].id;
  const tenureDays = Math.max(
    0,
    (Date.now() - new Date(pr[0].created_at).getTime()) / (24 * 60 * 60 * 1000),
  );

  const { rows: vc } = await db.query(
    `select count(*)::int n from verification_records
       where passport_id = $1 and status = 'VALID'`,
    [passportId],
  );
  const validationCount = vc[0].n;

  return {
    vendorId,
    tenureDays: Math.floor(tenureDays),
    validationCount,
    score: reputationScore({ tenureDays, validationCount }),
  };
}
