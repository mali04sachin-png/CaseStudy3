// Phase 4 — the CME entry point a scheduler (cron) invokes on an interval.
// e.g. a Vercel Cron / Supabase scheduled job / OS cron running:
//     DATABASE_URL="postgresql://…" node src/monitoring/worker.ts
//
// In production the two mock providers are swapped for real GRVL adapters.

import { createClient } from '../db/client.ts';
import { GRVL } from '../verification/grvl.ts';
import { MockVerificationProvider } from '../verification/providers/mock-provider.ts';
import { runMonitoringCycle } from './cme.ts';

async function main() {
  const db = createClient();
  await db.connect();
  try {
    const grvl = new GRVL(
      new MockVerificationProvider({ name: 'eKYCNow' }),
      new MockVerificationProvider({ name: 'Deepvue' }),
    );
    const summary = await runMonitoringCycle(db, grvl);
    console.log(`CME cycle complete: checked=${summary.checked} alerts=${summary.alerts}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('CME cycle failed:', err);
  process.exit(1);
});
