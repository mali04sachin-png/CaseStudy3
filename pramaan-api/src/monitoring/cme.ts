// Phase 4 — the Continuous Monitoring Engine (CME).
// A scheduler (cron) calls runMonitoringCycle on an interval. For every active
// vendor↔buyer link it re-verifies the vendor against the registry, and when
// something changed it: (1) ALWAYS logs the proof to verification_records, and
// (2) raises an alert ONLY if the change is material for that buyer.

import type { GRVL } from '../verification/grvl.ts';
import { getMaterialityRule, isMaterial } from './materiality.ts';

export interface DetectedChange {
  vendorId: string;
  buyerId: string;
  passportId: string;
  fieldName: string; // gst_number / registered_address / bank_account_num / msme_classification
  internalCriticality: string; // from buyer_vendor_links
  changeType: string; // GST_SUSPENDED / BANK_CHANGE / MSME_CLASS_SHIFT / ADDRESS_CHANGE
  before: unknown;
  after: unknown;
  sourceProvider?: string;
}

/** Log one detected change and, if material, raise a routed alert.
 *  Returns the proof-log id and the alert id (null when log-only). */
export async function recordChange(
  db: any,
  change: DetectedChange,
): Promise<{ verificationRecordId: string; alertId: string | null }> {
  // 1. Always write the immutable proof (every check ever run).
  const {
    rows: [vr],
  } = await db.query(
    `insert into verification_records
       (passport_id, field_name, source_registry, source_provider, verified_value, status)
     values ($1, $2, 'GSTN', $3, $4, 'VALID') returning id`,
    [
      change.passportId,
      change.fieldName,
      change.sourceProvider ?? 'system_cme',
      JSON.stringify({ before: change.before, after: change.after }),
    ],
  );

  // 2. Decide whether this change is worth an alert.
  const rule = await getMaterialityRule(db, change.fieldName, change.internalCriticality);
  if (!isMaterial(rule)) {
    return { verificationRecordId: vr.id, alertId: null }; // logged, but silent
  }

  // 3. Material → raise an alert routed to the correct owner (Finance/Compliance/…).
  const {
    rows: [alert],
  } = await db.query(
    `insert into alerts
       (vendor_id, buyer_id, change_type, severity, affected_process, routed_to_role, raw_delta)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      change.vendorId,
      change.buyerId,
      change.changeType,
      rule!.severity,
      rule!.affected_process,
      rule!.routed_to_role,
      JSON.stringify({ before: change.before, after: change.after }),
    ],
  );
  return { verificationRecordId: vr.id, alertId: alert.id };
}

export interface CycleOptions {
  vendorIds?: string[]; // limit the sweep (used by tests); omit = all active vendors
}

/** One full monitoring pass. In production a cron triggers this on a schedule. */
export async function runMonitoringCycle(
  db: any,
  grvl: GRVL,
  opts: CycleOptions = {},
): Promise<{ checked: number; alerts: number }> {
  const params: unknown[] = [];
  let filter = '';
  if (opts.vendorIds) {
    filter = 'where l.vendor_id = any($1)';
    params.push(opts.vendorIds);
  }

  const { rows: links } = await db.query(
    `select l.buyer_id, l.vendor_id, l.internal_criticality,
            p.id as passport_id, p.gst_number, p.status as passport_status
       from buyer_vendor_links l
       join trust_passports p on p.vendor_id = l.vendor_id
       ${filter}`,
    params,
  );

  let alerts = 0;

  for (const link of links) {
    // Re-verify against the registry. If it is down, skip (a real system queues
    // a retry and never marks the vendor unverified on a transient failure).
    let verified;
    try {
      verified = await grvl.verifyGSTIN(link.gst_number);
    } catch {
      continue;
    }

    const newStatus =
      verified.gstStatus === 'ACTIVE'
        ? 'ACTIVE'
        : verified.gstStatus === 'SUSPENDED'
          ? 'SUSPENDED'
          : verified.gstStatus === 'CANCELLED'
            ? 'DEREGISTERED'
            : link.passport_status;

    if (newStatus === link.passport_status) continue; // nothing changed

    const changeType = newStatus === 'SUSPENDED' ? 'GST_SUSPENDED' : 'GST_STATUS_CHANGE';
    const res = await recordChange(db, {
      vendorId: link.vendor_id,
      buyerId: link.buyer_id,
      passportId: link.passport_id,
      fieldName: 'gst_number',
      internalCriticality: link.internal_criticality,
      changeType,
      before: { status: link.passport_status },
      after: { status: newStatus },
      sourceProvider: verified.sourceProvider,
    });
    if (res.alertId) alerts++;

    // Persist the new verified status on the passport.
    await db.query(
      'update trust_passports set status = $1, gst_last_verified_at = now() where id = $2',
      [newStatus, link.passport_id],
    );
  }

  return { checked: links.length, alerts };
}
