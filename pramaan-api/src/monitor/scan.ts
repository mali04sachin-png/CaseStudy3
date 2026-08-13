// Continuous monitoring — one "cron tick".
//
// Pramaan's promise is "verify once, then keep watching." This is the watching:
// for each monitored vendor it re-checks the LIVE GST registry, appends the result
// to the immutable proof log, and — if the status changed since last time — flips
// the passport and raises an alert that lands on the compliance dashboard.
//
// It is deliberately trigger-only (a script run or an authenticated button press),
// never a background timer: the free registry API has a tiny request budget, so a
// real lookup happens only when someone explicitly runs a scan.

import { gstinCheckLookup } from '../verification/providers/gstincheck.ts';
import type { GstStatus } from '../verification/types.ts';

// GST registration status → our internal vendor lifecycle status.
function toVendorStatus(gst: GstStatus | null): 'ACTIVE' | 'SUSPENDED' | 'DEREGISTERED' | null {
  if (gst === 'ACTIVE') return 'ACTIVE';
  if (gst === 'SUSPENDED') return 'SUSPENDED';
  if (gst === 'CANCELLED') return 'DEREGISTERED';
  return null;
}

// How a given transition is flagged: what changed, how loud, and who owns it.
function classify(before: string, after: string): { changeType: string; severity: string } {
  if (after === 'DEREGISTERED') return { changeType: 'GST_CANCELLED', severity: 'CRITICAL' };
  if (after === 'SUSPENDED') return { changeType: 'GST_SUSPENDED', severity: 'HIGH' };
  if (after === 'ACTIVE') return { changeType: 'GST_REACTIVATED', severity: 'LOW' };
  return { changeType: 'GST_STATUS_CHANGE', severity: 'MEDIUM' };
}

export interface ScanChange {
  vendor: string;
  gstin: string;
  from: string;
  to: string;
  changeType: string;
  severity: string;
}
export interface ScanSummary {
  buyerId: string;
  scannedAt: string;
  provider: string;
  scanned: number;
  changed: ScanChange[];
  unchanged: { vendor: string; gstin: string; status: string }[];
  failed: { vendor: string; gstin: string; reason: string }[];
  alertsRaised: number;
}

/** Run one monitoring pass over a buyer's watchlisted vendors. Hits the live GST
 *  API once per vendor. Records history + raises alerts on change. */
export async function runMonitorScan(db: any, buyerId: string): Promise<ScanSummary> {
  const apiKey = process.env.GSTINCHECK_KEY;
  if (!apiKey) throw new Error('GSTINCHECK_KEY not configured — cannot run a live scan');

  const { rows } = await db.query(
    `select p.id as passport_id, v.id as vendor_id, v.legal_name, p.gst_number, p.status
       from trust_passports p
       join vendors v on v.id = p.vendor_id
       join buyer_vendor_links bvl on bvl.vendor_id = v.id and bvl.buyer_id = $1
      where p.monitored = true and p.gst_number is not null
      order by v.legal_name`,
    [buyerId],
  );

  const summary: ScanSummary = {
    buyerId,
    scannedAt: new Date().toISOString(),
    provider: 'GSTINCheck',
    scanned: rows.length,
    changed: [],
    unchanged: [],
    failed: [],
    alertsRaised: 0,
  };

  for (const r of rows) {
    let result;
    try {
      result = await gstinCheckLookup(apiKey, r.gst_number); // fresh live hit
    } catch (e: any) {
      // Registry busy / unreachable — log a DEGRADED proof, change nothing.
      await db.query(
        `insert into verification_records (passport_id, field_name, source_registry, source_provider, verified_value, status)
         values ($1,'gst_number','GSTN','GSTINCheck',$2,'DEGRADED')`,
        [r.passport_id, JSON.stringify({ error: String((e && e.message) || e) })],
      );
      summary.failed.push({ vendor: r.legal_name, gstin: r.gst_number, reason: String((e && e.message) || e) });
      continue;
    }

    // Append the live result to the immutable proof log.
    await db.query(
      `insert into verification_records (passport_id, field_name, source_registry, source_provider, verified_value, status)
       values ($1,'gst_number','GSTN','GSTINCheck',$2,'VALID')`,
      [r.passport_id, JSON.stringify({ gstStatus: result.gstStatus, legalName: result.legalName })],
    );

    const after = toVendorStatus(result.gstStatus);
    const before = r.status as string;

    if (after && after !== before) {
      const { changeType, severity } = classify(before, after);
      await db.query(
        `update trust_passports set status = $1, gst_last_verified_at = now(), updated_at = now() where id = $2`,
        [after, r.passport_id],
      );
      await db.query(
        `insert into alerts (vendor_id, buyer_id, change_type, severity, affected_process, routed_to_role, raw_delta, status)
         values ($1,$2,$3,$4,'TAX','FINANCE',$5,'NEW')`,
        [
          r.vendor_id,
          buyerId,
          changeType,
          severity,
          JSON.stringify({ before, after, gstStatus: result.gstStatus, legalName: result.legalName }),
        ],
      );
      summary.changed.push({
        vendor: r.legal_name,
        gstin: r.gst_number,
        from: before,
        to: after,
        changeType,
        severity,
      });
      summary.alertsRaised++;
    } else {
      await db.query(`update trust_passports set gst_last_verified_at = now() where id = $1`, [r.passport_id]);
      summary.unchanged.push({ vendor: r.legal_name, gstin: r.gst_number, status: before });
    }
  }

  return summary;
}
