// Phase 5 — the routing engine.
// Alerts are stamped with routed_to_role at creation (Phase 4, from the
// materiality rules). This surfaces them to the right internal owner: a
// bank-detail change goes to FINANCE and nowhere else; a contract-risk change
// goes to LEGAL; and so on.

import type { AuthClaims } from '../auth/jwt.ts';
import { listPendingAlerts } from './dashboard.ts';
import type { PendingAlert } from './dashboard.ts';

export type InternalRole = 'FINANCE' | 'COMPLIANCE' | 'LEGAL' | 'PROCUREMENT';

export function alertsForRole(
  db: any,
  claims: AuthClaims,
  role: InternalRole,
): Promise<PendingAlert[]> {
  return listPendingAlerts(db, claims, { routedToRole: role });
}
