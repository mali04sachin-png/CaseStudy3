// Integration prep — read + toggle a buyer's ERP connections.
// Maps the prototype's Oracle/SAP "connect" screen (INTEGRATION.md §GET /integrations,
// POST /integrations/:name/connect) to the erp_connections table. BUYER_ADMIN only,
// scoped to the caller's tenant (from the verified JWT).

import type { AuthClaims } from '../auth/jwt.ts';
import { requireRole } from '../auth/guard.ts';
import { AppError } from '../auth/errors.ts';

// Accept friendly names from the UI and map to the erp_provider enum.
const ERP_ALIASES: Record<string, string> = {
  oracle: 'ORACLE_FUSION',
  oracle_fusion: 'ORACLE_FUSION',
  ORACLE_FUSION: 'ORACLE_FUSION',
  sap: 'SAP_ARIBA',
  sap_ariba: 'SAP_ARIBA',
  SAP_ARIBA: 'SAP_ARIBA',
  netsuite: 'NETSUITE',
  NETSUITE: 'NETSUITE',
};

export async function listConnections(db: any, claims: AuthClaims) {
  requireRole(claims, ['BUYER_ADMIN']);
  const { rows } = await db.query(
    `select erp_type, connection_status, sync_direction, last_synced_at
       from erp_connections
      where buyer_id = $1
      order by erp_type`,
    [claims.buyerId],
  );
  return rows;
}

export async function setConnection(
  db: any,
  claims: AuthClaims,
  erp: string,
  connect: boolean,
) {
  requireRole(claims, ['BUYER_ADMIN']);
  const erpType = ERP_ALIASES[erp];
  if (!erpType) {
    throw new AppError(`Unknown ERP "${erp}"`, 400);
  }
  const status = connect ? 'CONNECTED' : 'DISCONNECTED';

  const { rows } = await db.query(
    `update erp_connections
        set connection_status = $1,
            last_synced_at = case when $2 then now() else last_synced_at end
      where buyer_id = $3 and erp_type = $4
      returning erp_type, connection_status, sync_direction, last_synced_at`,
    [status, connect, claims.buyerId, erpType],
  );
  if (!rows[0]) {
    throw new AppError(`No ${erpType} connection configured for this tenant`, 404);
  }
  return rows[0];
}
