// Seeds demo accounts + sample data for the live app.
// Run:  DATABASE_URL="postgresql://…direct…" node scripts/seed-demo.mjs
// Idempotent: it clears its own fixed-id rows first, then re-inserts.

import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Client } = pg;
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');
const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const pw = bcrypt.hashSync('demo', 10);

// Fixed ids so re-running is clean.
const ACME = '10000000-0000-0000-0000-000000000001';
const V_RAVI = '20000000-0000-0000-0000-000000000001';
const V_MEHER = '20000000-0000-0000-0000-000000000002';
const V_KADAM = '20000000-0000-0000-0000-000000000003';
const emails = ['ravi@demo.in', 'priya@demo.in', 'ananya@demo.in'];
const vendors = [V_RAVI, V_MEHER, V_KADAM];

await db.connect();
try {
  await db.query('begin');

  // ---- clean prior demo rows (order respects FKs) ----
  await db.query('delete from buyer_vendor_links where buyer_id = $1 or vendor_id = any($2)', [ACME, vendors]);
  await db.query('delete from alerts where buyer_id = $1', [ACME]);
  await db.query('delete from erp_connections where buyer_id = $1', [ACME]);
  await db.query('delete from users where email = any($1)', [emails]);
  await db.query('delete from vendors where id = any($1)', [vendors]);
  await db.query('delete from buyers where id = $1', [ACME]);

  // ---- buyer + admin/compliance users ----
  await db.query(`insert into buyers (id, org_name, erp_type) values ($1,'Acme Manufacturing','ORACLE_FUSION')`, [ACME]);
  await db.query(`insert into users (email, password_hash, role, buyer_id, status) values ($1,$2,'BUYER_ADMIN',$3,'ACTIVE')`, ['ananya@demo.in', pw, ACME]);
  await db.query(`insert into users (email, password_hash, role, buyer_id, status) values ($1,$2,'COMPLIANCE',$3,'ACTIVE')`, ['priya@demo.in', pw, ACME]);

  // ---- Ravi: vendor + verified passport (aged for reputation) + proof + consent ----
  await db.query(`insert into vendors (id, legal_name, vendor_type) values ($1,'Ravi Logistics Pvt Ltd','Proprietorship')`, [V_RAVI]);
  const { rows: pp } = await db.query(
    `insert into trust_passports (vendor_id, gst_number, pan_number, registered_address, msme_classification, status, created_at, gst_last_verified_at)
     values ($1,'27AAAAA1111A1Z1','AAAAA1111A',$2,'SMALL','ACTIVE', now() - interval '240 days', now() - interval '2 hours') returning id`,
    [V_RAVI, JSON.stringify({ city: 'Pune', state: 'MH' })],
  );
  const passportId = pp[0].id;
  for (let i = 0; i < 6; i++) {
    await db.query(
      `insert into verification_records (passport_id, field_name, source_registry, source_provider, verified_value, status, verified_at)
       values ($1,'gst_number','GSTN','eKYCNow','{"status":"ACTIVE"}','VALID', now() - interval '1 day' * $2)`,
      [passportId, i * 30],
    );
  }
  await db.query(`insert into users (email, password_hash, role, vendor_id, status) values ($1,$2,'VENDOR',$3,'ACTIVE')`, ['ravi@demo.in', pw, V_RAVI]);
  await db.query(`insert into consent_records (vendor_id, purpose, consent_given_at, consent_manager_ref) values ($1,'Continuous verification under DPDP', now() - interval '240 days','cm-demo')`, [V_RAVI]);

  // ---- two more vendors for the alert dashboard ----
  await db.query(`insert into vendors (id, legal_name, vendor_type) values ($1,'Meher Textiles','Partnership'), ($2,'Kadam Suppliers','Private Limited')`, [V_MEHER, V_KADAM]);

  // ---- links (Acme <-> vendors) ----
  await db.query(
    `insert into buyer_vendor_links (buyer_id, vendor_id, internal_criticality) values ($1,$2,'CRITICAL'),($1,$3,'CRITICAL'),($1,$4,'SIGNIFICANT')`,
    [ACME, V_RAVI, V_MEHER, V_KADAM],
  );

  // ---- alerts for Priya's dashboard ----
  const mk = (v, ct, sev, proc, role, st) =>
    db.query(
      `insert into alerts (vendor_id, buyer_id, change_type, severity, affected_process, routed_to_role, raw_delta, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [v, ACME, ct, sev, proc, role, JSON.stringify({ before: {}, after: {} }), st],
    );
  await mk(V_RAVI, 'GST_SUSPENDED', 'HIGH', 'TAX', 'FINANCE', 'NEW');
  await mk(V_MEHER, 'BANK_CHANGE', 'CRITICAL', 'PAYMENT', 'FINANCE', 'NEW');
  await mk(V_KADAM, 'MSME_DUES_43B', 'HIGH', 'COMPLIANCE', 'COMPLIANCE', 'NEW');
  await mk(V_MEHER, 'GST_SUSPENDED', 'HIGH', 'TAX', 'FINANCE', 'RESOLVED');

  // ---- ERP connections for Ananya ----
  await db.query(`insert into erp_connections (buyer_id, erp_type, connection_status, sync_direction, credentials_vault_ref) values ($1,'ORACLE_FUSION','CONNECTED','OUTBOUND','vault://oracle/acme')`, [ACME]);
  await db.query(`insert into erp_connections (buyer_id, erp_type, connection_status, sync_direction, credentials_vault_ref) values ($1,'SAP_ARIBA','DISCONNECTED','INBOUND','vault://sap/acme')`, [ACME]);

  await db.query('commit');
  console.log('Seeded demo: Acme + Ravi/Priya/Ananya (password "demo"), 3 vendors, 4 alerts, 2 ERP connections.');
} catch (e) {
  await db.query('rollback');
  console.error('Seed failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
