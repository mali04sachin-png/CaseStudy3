// Verified-vendor directory (the network effect): a buyer discovers vendors
// Pramaan already verified, and onboards them with zero re-verification.
// Privacy: only vendors who opted in (is_discoverable) appear, and only their
// shared-core verified identity is returned — never another buyer's overlay.

import type { AuthClaims } from '../auth/jwt.ts';
import { requireRole } from '../auth/guard.ts';
import { AppError, AuthorizationError } from '../auth/errors.ts';

/** A vendor toggles whether they appear in the cross-buyer directory. */
export async function setDiscoverable(db: any, claims: AuthClaims, enabled: boolean) {
  requireRole(claims, ['VENDOR']);
  if (!claims.vendorId) throw new AuthorizationError('No vendor is bound to this token');
  await db.query('update trust_passports set is_discoverable = $1, updated_at = now() where vendor_id = $2', [
    !!enabled,
    claims.vendorId,
  ]);
  return { ok: true, is_discoverable: !!enabled };
}

/** Search discoverable, verified vendors across all tenants. Returns verified
 *  identity + a reputation score + whether the caller's buyer already has them. */
export async function searchDirectory(db: any, claims: AuthClaims, q?: string) {
  requireRole(claims, ['BUYER_ADMIN', 'COMPLIANCE']);
  const params: unknown[] = [claims.buyerId];
  let filter = "where p.is_discoverable = true and p.status = 'ACTIVE'";
  if (q && q.trim()) {
    params.push('%' + q.trim() + '%');
    filter += ` and (v.legal_name ilike $${params.length} or p.gst_number ilike $${params.length})`;
  }
  const { rows } = await db.query(
    `select v.id as vendor_id, v.legal_name, v.vendor_type,
            p.gst_number, p.pan_number, p.msme_classification as msme, p.status,
            least(100, floor(
              least(50, extract(epoch from (now() - p.created_at)) / 86400.0 / 365.0 * 50)
              + least(50, (select count(*) from verification_records vr
                             where vr.passport_id = p.id and vr.status = 'VALID') * 5)
            ))::int as reputation,
            exists(select 1 from buyer_vendor_links l
                     where l.vendor_id = v.id and l.buyer_id = $1) as already_onboarded
       from trust_passports p
       join vendors v on v.id = p.vendor_id
       ${filter}
      order by reputation desc, v.legal_name
      limit 50`,
    params,
  );
  return rows;
}

/** Onboard a discoverable vendor into the caller's tenant — a new
 *  buyer_vendor_link that reuses the existing verified passport (no re-verify). */
export async function onboardVendor(db: any, claims: AuthClaims, vendorId: string) {
  requireRole(claims, ['BUYER_ADMIN', 'COMPLIANCE']);

  const { rows: p } = await db.query('select is_discoverable from trust_passports where vendor_id = $1', [
    vendorId,
  ]);
  if (!p[0]) throw new AppError('Vendor not found', 404);
  if (!p[0].is_discoverable) throw new AuthorizationError('This vendor is not available for onboarding');

  const { rows } = await db.query(
    `insert into buyer_vendor_links (buyer_id, vendor_id) values ($1, $2)
     on conflict (buyer_id, vendor_id) do nothing returning id`,
    [claims.buyerId, vendorId],
  );
  return { ok: true, vendorId, buyerId: claims.buyerId, newlyOnboarded: rows.length > 0 };
}
