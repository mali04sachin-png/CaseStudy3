// Phase 3 — buyer provisioning.
// When a buyer company is first set up, it gets exactly ONE root BUYER_ADMIN
// account (not self-service, not invite-based). That admin later invites their
// COMPLIANCE staff (see invites.ts).

import { hashPassword } from '../auth/password.ts';

export interface ProvisionBuyerInput {
  orgName: string;
  erpType: string; // SAP_ARIBA / ORACLE_FUSION / NETSUITE / STANDALONE
  adminEmail: string;
  adminPassword: string;
}

export async function provisionBuyer(db: any, input: ProvisionBuyerInput) {
  const {
    rows: [buyer],
  } = await db.query('insert into buyers (org_name, erp_type) values ($1, $2) returning id', [
    input.orgName,
    input.erpType,
  ]);

  const {
    rows: [admin],
  } = await db.query(
    `insert into users (email, password_hash, role, buyer_id)
     values ($1, $2, 'BUYER_ADMIN', $3) returning id`,
    [input.adminEmail, hashPassword(input.adminPassword), buyer.id],
  );

  return { buyerId: buyer.id as string, adminUserId: admin.id as string };
}
