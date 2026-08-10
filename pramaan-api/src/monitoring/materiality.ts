// Phase 4 — the materiality filter.
// Not every change deserves an alert. This looks up the rules table (ERD 4.B)
// for a given field + how critical the vendor is to the buyer, and decides
// whether the change is "material" (worth alerting) or just log-only.

export interface MaterialityRule {
  field_name: string;
  internal_criticality: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  affected_process: string;
  routed_to_role: string;
}

export async function getMaterialityRule(
  db: any,
  fieldName: string,
  internalCriticality: string,
): Promise<MaterialityRule | null> {
  const { rows } = await db.query(
    `select field_name, internal_criticality, severity, affected_process, routed_to_role
       from materiality_rules
      where field_name = $1 and internal_criticality = $2`,
    [fieldName, internalCriticality],
  );
  return rows[0] ?? null;
}

/** A change is material (raises an alert) only if a rule matches AND it routes to
 *  a real owner. A rule routed to 'NONE' (e.g. a non-essential address change) is
 *  logged but silent. No rule at all → also silent. */
export function isMaterial(rule: MaterialityRule | null): boolean {
  return !!rule && rule.routed_to_role !== 'NONE';
}
