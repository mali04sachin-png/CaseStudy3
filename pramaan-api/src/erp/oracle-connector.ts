// Phase 6 — the Oracle Fusion write-back connector (push).
// For each verified change it: maps → attaches an idempotency key → calls Oracle,
// retrying transient failures with exponential backoff. A change that never
// succeeds is dead-lettered and the connection is marked DEGRADED. Repeated
// pushes never create duplicate suppliers (idempotency).

import type { ErpClient, SupplierAttributes, VerifiedChange } from './types.ts';
import { idempotencyKey } from './idempotency.ts';
import { mapVendorToOracleSupplier } from './mapping.ts';

export type SyncOutcome = 'SYNCED' | 'DUPLICATE' | 'DEAD_LETTER';

export interface SyncOptions {
  maxRetries?: number; // total attempts per change (default 3)
  baseDelayMs?: number; // backoff base; 0 = no wait (default 0, tests keep it fast)
}

export interface SyncResult {
  outcome: SyncOutcome;
  idempotencyKey: string;
  attrs: SupplierAttributes;
  attempts: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Push a single verified change to Oracle, with retry + dead-letter. No DB. */
export async function syncChange(
  client: ErpClient,
  change: VerifiedChange,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 0;

  const key = idempotencyKey(change.vendorId, change.fieldName, change.verifiedValue, change.verifiedAt);
  const attrs = mapVendorToOracleSupplier(change);

  let attempts = 0;
  while (attempts < maxRetries) {
    attempts += 1;
    try {
      const res = await client.upsertSupplier(attrs, key);
      return {
        outcome: res.duplicate ? 'DUPLICATE' : 'SYNCED',
        idempotencyKey: key,
        attrs,
        attempts,
      };
    } catch {
      if (attempts < maxRetries && baseDelayMs > 0) {
        await sleep(baseDelayMs * 2 ** (attempts - 1)); // exponential backoff
      }
    }
  }
  // Persistent failure → dead-letter for out-of-band handling.
  return { outcome: 'DEAD_LETTER', idempotencyKey: key, attrs, attempts };
}

export interface RunResult {
  results: SyncResult[];
  synced: number;
  duplicates: number;
  deadLettered: number;
  status: 'CONNECTED' | 'DEGRADED';
}

/** Push a batch for one buyer and record the connection health in the DB.
 *  Sets sync_direction to OUTBOUND (or TWO_WAY if a pull side already exists). */
export async function runOracleSync(
  db: any,
  client: ErpClient,
  buyerId: string,
  changes: VerifiedChange[],
  opts: SyncOptions = {},
): Promise<RunResult> {
  const results: SyncResult[] = [];
  for (const change of changes) {
    results.push(await syncChange(client, change, opts));
  }

  const deadLettered = results.filter((r) => r.outcome === 'DEAD_LETTER').length;
  const status: RunResult['status'] = deadLettered > 0 ? 'DEGRADED' : 'CONNECTED';

  await db.query(
    `update erp_connections
        set connection_status = $1,
            last_synced_at = now(),
            sync_direction = (case when sync_direction = 'INBOUND' then 'TWO_WAY' else 'OUTBOUND' end)::sync_dir
      where buyer_id = $2 and erp_type = 'ORACLE_FUSION'`,
    [status, buyerId],
  );

  return {
    results,
    synced: results.filter((r) => r.outcome === 'SYNCED').length,
    duplicates: results.filter((r) => r.outcome === 'DUPLICATE').length,
    deadLettered,
    status,
  };
}
