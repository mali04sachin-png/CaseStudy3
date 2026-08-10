// Phase 8 — the portability engine (one-click profile sharing).
// A vendor grants a new buyer access to their ALREADY-verified passport. This is
// just a new buyer_vendor_links row for the same vendor — the trust_passport
// (tax/bank/identity) is never re-uploaded or duplicated. Idempotent: sharing
// again with the same buyer is a no-op.

import type { AuthClaims } from '../auth/jwt.ts';
import { requireRole } from '../auth/guard.ts';
import { AppError, AuthorizationError } from '../auth/errors.ts';

export async function shareProfile(db: any, vendor: AuthClaims, targetBuyerId: string) {
  requireRole(vendor, ['VENDOR']);
  const vendorId = vendor.vendorId;
  if (!vendorId) {
    throw new AuthorizationError('No vendor is bound to this token');
  }

  // The target buyer must exist.
  const { rows: br } = await db.query('select id from buyers where id = $1', [targetBuyerId]);
  if (!br[0]) {
    throw new AppError('Target buyer not found', 404);
  }

  // Link the existing passport to the new buyer — no re-upload. Unique
  // (buyer_id, vendor_id) makes a repeat share a no-op.
  const { rows } = await db.query(
    `insert into buyer_vendor_links (buyer_id, vendor_id)
     values ($1, $2)
     on conflict (buyer_id, vendor_id) do nothing
     returning id`,
    [targetBuyerId, vendorId],
  );

  return {
    vendorId,
    buyerId: targetBuyerId,
    shared: true,
    newlyShared: rows.length > 0, // false if it was already shared
  };
}
