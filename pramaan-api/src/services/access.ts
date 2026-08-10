// Phase 3 — tenant-scoped data access.
// Proves the login actually confines a user to their own company's data. We run
// the read as a normal app user ('authenticated') bound to the caller's tenant,
// so Postgres Row-Level Security (Phase 1) returns only that buyer's rows —
// a COMPLIANCE user of Buyer A can never see Buyer B's.

import type { AuthClaims } from '../auth/jwt.ts';

export async function listVisibleVendorLinks(db: any, claims: AuthClaims) {
  try {
    await db.query('begin');
    // Drop from the privileged connection role down to a normal app user, so RLS
    // is enforced (the service/postgres role bypasses it by design).
    await db.query('set local role authenticated');
    // Bind this session to the caller's tenant (parameterized, local to the txn).
    await db.query('select set_config($1, $2, true)', ['app.current_buyer_id', claims.buyerId]);

    const { rows } = await db.query('select buyer_id, vendor_id from buyer_vendor_links');

    await db.query('commit');
    return rows as Array<{ buyer_id: string; vendor_id: string }>;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}
