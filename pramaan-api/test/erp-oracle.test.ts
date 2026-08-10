// Phase 6 tests — Oracle Fusion write-back connector.
//
// Acceptance criteria (Pramaan_Implementation_Plan.md, Phase 6):
//   AC1. Pramaan calls Oracle's API with mapped parameters on verified changes.
//   AC2. Submitting the same sync batch twice does NOT create duplicate suppliers.

import { test, before, after } from 'node:test';
import assert from 'node:assert';

import { syncChange, runOracleSync } from '../src/erp/oracle-connector.ts';
import { MockOracleFusionClient } from '../src/erp/providers/oracle-mock.ts';
import { idempotencyKey } from '../src/erp/idempotency.ts';
import { createClient } from '../src/db/client.ts';
import type { VerifiedChange } from '../src/erp/types.ts';

function change(overrides: Partial<VerifiedChange> = {}): VerifiedChange {
  return {
    vendorId: 'v-1',
    fieldName: 'gst_number',
    verifiedValue: { status: 'ACTIVE' },
    verifiedAt: '2026-08-11T00:00:00.000Z',
    legalName: 'Ravi Logistics',
    gstNumber: '27AAAAA1111A1Z1',
    panNumber: 'AAAAA1111A',
    status: 'ACTIVE',
    ...overrides,
  };
}

test('AC1: Oracle is called with mapped supplier attributes', async () => {
  const oracle = new MockOracleFusionClient();
  const res = await syncChange(oracle, change());

  assert.equal(res.outcome, 'SYNCED');
  assert.equal(oracle.calls.length, 1);
  const attrs = oracle.calls[0].attrs;
  assert.equal(attrs.SupplierName, 'Ravi Logistics');
  assert.equal(attrs.TaxRegistrationNumber, '27AAAAA1111A1Z1'); // GST mapped
  assert.equal(attrs.TaxpayerId, 'AAAAA1111A'); // PAN mapped
  assert.equal(oracle.suppliers.size, 1);
});

test('AC2: the same change pushed twice does not duplicate the supplier', async () => {
  const oracle = new MockOracleFusionClient();

  const first = await syncChange(oracle, change());
  const second = await syncChange(oracle, change()); // identical → idempotent

  assert.equal(first.outcome, 'SYNCED');
  assert.equal(second.outcome, 'DUPLICATE');
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(oracle.suppliers.size, 1, 'still exactly one supplier');
});

test('idempotency key is stable for the same change and differs when data changes', () => {
  const a = idempotencyKey('v1', 'gst_number', { s: 'ACTIVE' }, '2026-08-11T00:00:00Z');
  const b = idempotencyKey('v1', 'gst_number', { s: 'ACTIVE' }, '2026-08-11T00:00:00Z');
  const c = idempotencyKey('v1', 'gst_number', { s: 'SUSPENDED' }, '2026-08-11T00:00:00Z');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('transient timeouts are retried, then succeed', async () => {
  const oracle = new MockOracleFusionClient({ mode: 'timeout-then-ok', failuresBeforeOk: 2 });
  const res = await syncChange(oracle, change(), { maxRetries: 3, baseDelayMs: 0 });
  assert.equal(res.outcome, 'SYNCED');
  assert.equal(res.attempts, 3); // failed twice, succeeded on the third
});

test('a persistently failing push is dead-lettered', async () => {
  const oracle = new MockOracleFusionClient({ mode: 'timeout' });
  const res = await syncChange(oracle, change(), { maxRetries: 3, baseDelayMs: 0 });
  assert.equal(res.outcome, 'DEAD_LETTER');
  assert.equal(res.attempts, 3);
});

// ---- DB-backed: connection health is recorded. Skipped without DATABASE_URL. ----

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL;
const RID = Date.now().toString(36);
let db: any;
const buyerIds: string[] = [];

before(async () => {
  if (skip) return;
  db = createClient(DB_URL);
  await db.connect();
});

after(async () => {
  if (skip || !db) return;
  // Deleting the buyer cascades its erp_connections row.
  if (buyerIds.length) await db.query('delete from buyers where id = any($1)', [buyerIds]);
  await db.end();
});

async function seedBuyerWithOracle(suffix: string) {
  const { rows: br } = await db.query(
    `insert into buyers (org_name, erp_type) values ($1,'ORACLE_FUSION') returning id`,
    [`Buyer-${RID}-${suffix}`],
  );
  const buyerId = br[0].id;
  buyerIds.push(buyerId);
  await db.query(
    `insert into erp_connections
       (buyer_id, erp_type, connection_status, sync_direction, credentials_vault_ref)
     values ($1,'ORACLE_FUSION','DISCONNECTED','OUTBOUND','vault://oracle/test')`,
    [buyerId],
  );
  return buyerId;
}

test('a successful batch marks the connection CONNECTED and OUTBOUND', { skip }, async () => {
  const buyerId = await seedBuyerWithOracle('c1');
  const oracle = new MockOracleFusionClient();

  const run = await runOracleSync(db, oracle, buyerId, [change()]);
  assert.equal(run.synced, 1);
  assert.equal(run.status, 'CONNECTED');

  const { rows } = await db.query(
    `select connection_status, sync_direction, last_synced_at
       from erp_connections where buyer_id = $1`,
    [buyerId],
  );
  assert.equal(rows[0].connection_status, 'CONNECTED');
  assert.equal(rows[0].sync_direction, 'OUTBOUND');
  assert.ok(rows[0].last_synced_at, 'last_synced_at is set');
});

test('a failing batch marks the connection DEGRADED', { skip }, async () => {
  const buyerId = await seedBuyerWithOracle('c2');
  const oracle = new MockOracleFusionClient({ mode: 'timeout' });

  const run = await runOracleSync(db, oracle, buyerId, [change()], { maxRetries: 2, baseDelayMs: 0 });
  assert.equal(run.deadLettered, 1);
  assert.equal(run.status, 'DEGRADED');

  const { rows } = await db.query(
    'select connection_status from erp_connections where buyer_id = $1',
    [buyerId],
  );
  assert.equal(rows[0].connection_status, 'DEGRADED');
});
