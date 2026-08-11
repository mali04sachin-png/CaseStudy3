// Phase 7 — the ERP-agnostic pull API (bulk + incremental).
// A buyer's own ERP polls these on its schedule. Both are strictly tenant-scoped:
// the path buyer_id must match the caller's token, and every query filters by it.

import type { AuthClaims } from '../auth/jwt.ts';
import { requireRole } from '../auth/guard.ts';
import { AppError, AuthorizationError, ValidationError } from '../auth/errors.ts';
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
  q?: string; // optional case-insensitive filter on vendor name or GSTIN
}

/** Bulk, paginated vendor list for one buyer. Page size is capped server-side. */
export async function bulkVendors(db: any, claims: AuthClaims, buyerId: string, opts: BulkOptions = {}) {
  assertOwnTenant(claims, buyerId);

  const pageSize = clampPageSize(opts.pageSize);
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const params: unknown[] = [buyerId];
  let search = '';
  if (opts.q && opts.q.trim()) {
    params.push(`%${opts.q.trim()}%`);
    search = ` and (v.legal_name ilike $${params.length} or p.gst_number ilike $${params.length})`;
  }
  params.push(pageSize, page * pageSize);

  const { rows } = await db.query(
    `select v.id as vendor_id, v.legal_name, p.gst_number, p.pan_number,
            p.msme_classification as msme, p.status, l.internal_criticality,
            p.updated_at
       from buyer_vendor_links l
       join vendors v on v.id = l.vendor_id
       join trust_passports p on p.vendor_id = v.id
      where l.buyer_id = $1${search}
      order by v.id
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  return { buyerId, page, pageSize, count: rows.length, vendors: rows };
}

/** Single-vendor detail + recent history. A VENDOR may read only its own record;
 *  a buyer (COMPLIANCE/BUYER_ADMIN) may read any vendor linked to their tenant. */
export async function vendorDetail(db: any, claims: AuthClaims, vendorId: string) {
  requireRole(claims, ['VENDOR', 'COMPLIANCE', 'BUYER_ADMIN']);

  if (claims.role === 'VENDOR') {
    if (claims.vendorId !== vendorId) throw new AuthorizationError('Not your vendor record');
  } else {
    const { rows } = await db.query(
      'select 1 from buyer_vendor_links where buyer_id = $1 and vendor_id = $2',
      [claims.buyerId, vendorId],
    );
    if (!rows[0]) throw new AuthorizationError('Vendor is not linked to your tenant');
  }

  const { rows: vr } = await db.query(
    `select v.id as vendor_id, v.legal_name, v.vendor_type, p.gst_number, p.pan_number,
            p.msme_classification as msme, p.status, p.registered_address, p.updated_at
       from vendors v
       left join trust_passports p on p.vendor_id = v.id
      where v.id = $1`,
    [vendorId],
  );
  if (!vr[0]) throw new AppError('Vendor not found', 404);

  // History: a buyer sees this vendor's alerts in their tenant; a vendor sees its
  // own verification checks.
  let history: Array<{ date: unknown; description: string }> = [];
  if (claims.role === 'VENDOR') {
    const { rows } = await db.query(
      `select vrec.verified_at as date, vrec.field_name, vrec.status
         from verification_records vrec
         join trust_passports p on p.id = vrec.passport_id
        where p.vendor_id = $1
        order by vrec.verified_at desc limit 10`,
      [vendorId],
    );
    history = rows.map((r: any) => ({ date: r.date, description: `${r.field_name} verified — ${r.status}` }));
  } else {
    const { rows } = await db.query(
      `select created_at as date, change_type, severity, routed_to_role
         from alerts where vendor_id = $1 and buyer_id = $2
        order by created_at desc limit 10`,
      [vendorId, claims.buyerId],
    );
    history = rows.map((r: any) => ({
      date: r.date,
      description: `${r.change_type} — ${r.severity}, routed to ${r.routed_to_role}`,
    }));
  }

  return { ...vr[0], history };
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
