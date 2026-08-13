// Seeds the monitoring watchlist: a handful of REAL vendors that the scan will
// re-check against the live GST registry. Linked to the Acme demo tenant so any
// change surfaces on Priya's dashboard.
//
// Run:  DATABASE_URL="postgresql://…" node scripts/seed-watchlist.mjs
// Idempotent: clears its own fixed-id rows, then re-inserts.
//
// To add a real vendor: append to WATCHLIST below (fresh uuid + real GSTIN).
// `lastKnown` is the status we PRETEND we last saw — set it to what you expect,
// so the very next scan reveals any drift (e.g. ACTIVE here vs a real Cancelled
// registration produces a "GST cancelled" alert on the first tick).

import pg from 'pg';

const { Client } = pg;
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');

const ACME = '10000000-0000-0000-0000-000000000001'; // must match seed-demo.mjs

const WATCHLIST = [
  {
    id: '20000000-0000-0000-0000-0000000000a1',
    name: 'Infinity Power Engineers',
    gstin: '27CWLPP3342M1ZY',
    lastKnown: 'ACTIVE',       // really Cancelled — first scan will catch it
    criticality: 'CRITICAL',
  },
  // Add more real vendors here, e.g.:
  // { id: '20000000-0000-0000-0000-0000000000a2', name: 'Acme Supplier Co',
  //   gstin: '29AA...', lastKnown: 'ACTIVE', criticality: 'SIGNIFICANT' },
];

const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const ids = WATCHLIST.map((w) => w.id);
  await db.query('begin');

  // clean prior rows (FK order: links -> passports(+cascade records) -> vendors)
  await db.query('delete from buyer_vendor_links where vendor_id = any($1)', [ids]);
  await db.query('delete from trust_passports where vendor_id = any($1)', [ids]);
  await db.query('delete from vendors where id = any($1)', [ids]);

  for (const w of WATCHLIST) {
    await db.query(`insert into vendors (id, legal_name, vendor_type) values ($1,$2,'Proprietorship')`, [w.id, w.name]);
    await db.query(
      `insert into trust_passports (vendor_id, gst_number, registered_address, msme_classification, status, monitored, gst_last_verified_at)
       values ($1,$2,$3,'NOT_APPLICABLE',$4,true, now() - interval '30 days')`,
      [w.id, w.gstin, JSON.stringify({}), w.lastKnown],
    );
    await db.query(
      `insert into buyer_vendor_links (buyer_id, vendor_id, internal_criticality) values ($1,$2,$3)`,
      [ACME, w.id, w.criticality],
    );
  }

  await db.query('commit');
  console.log(`Seeded watchlist: ${WATCHLIST.length} monitored vendor(s) linked to Acme.`);
  for (const w of WATCHLIST) console.log(`  • ${w.name} (${w.gstin}) last-known=${w.lastKnown}`);
} catch (e) {
  await db.query('rollback');
  console.error('Watchlist seed failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
