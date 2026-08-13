// Provisions a real Google-account email as a Pramaan user, so "Sign in with
// Google" has someone to match. Password stays null — this account signs in only
// via Google. Role is set here (we control it), never by Google.
//
// Run:  DATABASE_URL="postgresql://…" node scripts/seed-google-user.mjs
// Edit GOOGLE_USERS below to add/point accounts. Idempotent per email.

import pg from 'pg';

const { Client } = pg;
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');

const ACME = '10000000-0000-0000-0000-000000000001'; // Acme demo tenant

// role: COMPLIANCE | BUYER_ADMIN (both bind to a buyer). VENDOR would need a vendor_id.
const GOOGLE_USERS = [
  { email: 'mali04.sachin@gmail.com', role: 'COMPLIANCE', buyerId: ACME },
];

const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  for (const u of GOOGLE_USERS) {
    await db.query('delete from users where lower(email) = lower($1)', [u.email]);
    await db.query(
      `insert into users (email, password_hash, role, buyer_id, status)
       values ($1, null, $2, $3, 'ACTIVE')`,
      [u.email, u.role, u.buyerId],
    );
    console.log(`Provisioned ${u.email} as ${u.role} (Google sign-in ready).`);
  }
} catch (e) {
  console.error('Google-user seed failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
