// Phase 5 — the compliance dashboard.
// Lists the pending alerts (NEW / ASSIGNED) for the caller's own tenant, most
// severe first. The read runs as the app role 'authenticated' bound to the
// caller's tenant, so Postgres RLS returns only this buyer's alerts.

import type { AuthClaims } from '../auth/jwt.ts';
import { requireRole } from '../auth/guard.ts';

export interface PendingAlert {
  id: string;
  vendor_id: string;
  change_type: string;
  severity: string;
  affected_process: string;
  routed_to_role: string;
  status: string;
  created_at: string;
}

export interface DashboardOptions {
  routedToRole?: string; // filter to one internal owner (FINANCE / COMPLIANCE / …)
}

export async function listPendingAlerts(
  db: any,
  claims: AuthClaims,
  opts: DashboardOptions = {},
): Promise<PendingAlert[]> {
  requireRole(claims, ['COMPLIANCE']); // Priya's screen

  try {
    await db.query('begin');
    await db.query('set local role authenticated');
    await db.query('select set_config($1, $2, true)', ['app.current_buyer_id', claims.buyerId]);

    const params: unknown[] = [];
    let filter = "where status in ('NEW', 'ASSIGNED')";
    if (opts.routedToRole) {
      params.push(opts.routedToRole);
      filter += ` and routed_to_role = $${params.length}`;
    }

    const { rows } = await db.query(
      `select id, vendor_id, change_type, severity, affected_process,
              routed_to_role, status, created_at
         from alerts
         ${filter}
        order by severity desc, created_at desc`,
      params,
    );

    await db.query('commit');
    return rows as PendingAlert[];
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}
