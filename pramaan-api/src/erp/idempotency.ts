// Phase 6 — idempotency fingerprint (ERD Section 6).
// A stable SHA-256 over (vendor_id + field_name + verified_value + verified_at).
// The same verified change always yields the same key, so a repeat push is
// recognized by the ERP and does NOT create a duplicate supplier entry.

import { createHash } from 'node:crypto';

export function idempotencyKey(
  vendorId: string,
  fieldName: string,
  verifiedValue: unknown,
  verifiedAt: string,
): string {
  return createHash('sha256')
    .update(`${vendorId}|${fieldName}|${JSON.stringify(verifiedValue)}|${verifiedAt}`)
    .digest('hex');
}
