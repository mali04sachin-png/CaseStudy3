// Phase 7 — the ERP-agnostic pull API (bulk + incremental).
// A buyer's own ERP polls these on its schedule. Both are strictly tenant-scoped:
// the path buyer_id must match the caller's token, and every query filters by it.

import type { AuthClaims } from '../auth/jwt.ts';
import { requireRole } from '../auth/guard.ts';
import { AuthorizationError, ValidationError } from '../auth/errors.ts';
import { clampPageSize } from './pagination.ts';

// How far back the incremental feed can look. A `since` older than this can no
// longer be served as a trustworthy delta → the caller must do a full resync.
export const RETENTION_DAYS = 30;

function assertOwnTenant(claims: AuthClaims, buyerId: string): void {
  requireRole(claims, ['BUYER_ADMIN', 'COMPLIANCE']);
  if (claims.buyerId !== buyerId) {
    throw new AuthorizationError('Cannot access another tenant');
  }
}

export interface BulkOptions {
  pageSize?: number;
  page?: number;
}

/** Bulk, paginated vendor list for one buyer. Page size is capped server-side. */
export async function bulkVendors(db: any, claims: AuthClaims, buyerId: string, opts: BulkOptions = {}) {
  assertOwnTenant(claims, buyerId);

  const pageSize = clampPageSize(opts.pageSize);
  const page = Math.max(0, Math.floor(opts.page ?? 0));

  const { rows } = await db.query(
    `select v.id as vendor_id, v.legal_name, p.gst_number, p.pan_number,
            p.msme_classification as msme, p.status, l.internal_criticality,
            p.updated_at
       from buyer_vendor_links l
       join vendors v on v.id = l.vendor_id
       join trust_passports p on p.vendor_id = v.id
      where l.buyer_id = $1
      order by v.id
      limit $2 offset $3`,
    [buyerId, pageSize, page * pageSize],
  );

  return { buyerId, page, pageSize, count: rows.length, vendors: rows };
}

/** Incremental change feed: vendors changed after `since`, plus a next cursor. */
export async function changedVendors(
  db: any,
  claims: AuthClaims,
  buyerId: string,
  opts: { since: string },
) {
  assertOwnTenant(claims, buyerId);

  const since = new Date(opts.since);
  if (Number.isNaN(since.getTime())) {
    throw new ValidationError('Invalid `since` timestamp');
  }

  // Too old to serve as a trustworthy delta → tell the caller to resync fully.
  const retentionCutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  if (since < retentionCutoff) {
    return { resync_required: true as const };
  }

  const { rows } = await db.query(
    `select v.id as vendor_id, v.legal_name, p.gst_number, p.status, p.updated_at
       from buyer_vendor_links l
       join vendors v on v.id = l.vendor_id
       join trust_passports p on p.vendor_id = v.id
      where l.buyer_id = $1 and p.updated_at > $2
      order by p.updated_at asc`,
    [buyerId, since.toISOString()],
  );

  // The next cursor is the newest change we returned (or the caller's own `since`
  // when nothing changed), so the next poll continues exactly where this left off.
  const nextSince = rows.length ? rows[rows.length - 1].updated_at : opts.since;

  // Record the watermark on the buyer's ERP connection, if one exists.
  await db.query('update erp_connections set last_pull_watermark = $1 where buyer_id = $2', [
    nextSince,
    buyerId,
  ]);

  return { resync_required: false as const, count: rows.length, vendors: rows, next_since: nextSince };
}
