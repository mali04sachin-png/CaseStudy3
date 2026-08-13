// Monitoring trigger — "run one cron tick by hand".
// Hits the live GST registry for every watchlisted vendor, records the result,
// and raises an alert on any status change. This is the exact work a scheduled
// cron would do; here YOU decide when it fires (so the free API is only ever
// touched on purpose).
//
// Run:
//   DATABASE_URL="postgresql://…" GSTINCHECK_KEY="…" node scripts/monitor-scan.mjs
// Optional: BUYER_ID=<uuid> to scan a different tenant (defaults to Acme demo).

import pg from 'pg';
import { runMonitorScan } from '../src/monitor/scan.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');
if (!process.env.GSTINCHECK_KEY) throw new Error('Set GSTINCHECK_KEY');
const buyerId = process.env.BUYER_ID || '10000000-0000-0000-0000-000000000001';

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  console.log('⏱  Monitoring scan started — checking live GST registry…\n');
  const s = await runMonitorScan(db, buyerId);

  console.log(`Scanned ${s.scanned} vendor(s) via ${s.provider} at ${s.scannedAt}\n`);

  if (s.changed.length) {
    console.log(`🚨 ${s.changed.length} status change(s) — alert(s) raised:`);
    for (const c of s.changed)
      console.log(`   • ${c.vendor} (${c.gstin}): ${c.from} → ${c.to}  [${c.severity} · ${c.changeType}]`);
    console.log('');
  }
  if (s.unchanged.length) {
    console.log(`✅ ${s.unchanged.length} unchanged:`);
    for (const u of s.unchanged) console.log(`   • ${u.vendor} (${u.gstin}): still ${u.status}`);
    console.log('');
  }
  if (s.failed.length) {
    console.log(`⚠️  ${s.failed.length} could not be checked (registry busy — try again):`);
    for (const f of s.failed) console.log(`   • ${f.vendor} (${f.gstin}): ${f.reason}`);
    console.log('');
  }
  console.log(`Done. ${s.alertsRaised} new alert(s) on the compliance dashboard.`);
} catch (e) {
  console.error('Scan failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
