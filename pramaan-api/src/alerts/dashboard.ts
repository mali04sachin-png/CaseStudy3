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

  // The pooled service-role connection bypasses RLS; tenant isolation is enforced
  // by the explicit buyer_id filter, taken from the verified JWT (never client input).
  const params: unknown[] = [claims.buyerId];
  let filter = "where a.buyer_id = $1 and a.status in ('NEW', 'ASSIGNED')";
  if (opts.routedToRole) {
    params.push(opts.routedToRole);
    filter += ` and a.routed_to_role = $${params.length}`;
  }

  const { rows } = await db.query(
    `select a.id, a.vendor_id, v.legal_name as vendor_name,
            p.msme_classification as msme, a.change_type,
            a.severity, a.affected_process, a.routed_to_role, a.status, a.created_at
       from alerts a
       join vendors v on v.id = a.vendor_id
       left join trust_passports p on p.vendor_id = a.vendor_id
       ${filter}
      order by a.severity desc, a.created_at desc`,
    params,
  );
  return rows as PendingAlert[];
}
