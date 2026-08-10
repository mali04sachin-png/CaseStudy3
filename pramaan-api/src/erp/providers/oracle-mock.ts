// Phase 6 — a practice ("mock") Oracle Fusion client.
// Behaves like the real supplier-master REST endpoint: it keeps a supplier book
// keyed by tax registration number, and it honors the idempotency key so a
// repeated push is a no-op (no duplicate entry). Real credentials later mean one
// class implementing ErpClient that hits the real endpoint — nothing else changes.

import type { ErpClient, SupplierAttributes, UpsertResult } from '../types.ts';

export type OracleMode = 'ok' | 'timeout' | 'timeout-then-ok';

export interface OracleMockOptions {
  mode?: OracleMode;
  failuresBeforeOk?: number; // for 'timeout-then-ok': how many attempts fail first
}

export class MockOracleFusionClient implements ErpClient {
  /** The Oracle "supplier master", keyed by a natural key (tax reg no). */
  readonly suppliers = new Map<string, SupplierAttributes>();
  /** Every upsert attempt, for assertions. */
  readonly calls: Array<{ attrs: SupplierAttributes; idempotencyKey: string }> = [];

  private readonly seenKeys = new Set<string>();
  private readonly mode: OracleMode;
  private failuresBeforeOk: number;

  constructor(opts: OracleMockOptions = {}) {
    this.mode = opts.mode ?? 'ok';
    this.failuresBeforeOk = opts.failuresBeforeOk ?? 0;
  }

  async upsertSupplier(attrs: SupplierAttributes, idempotencyKey: string): Promise<UpsertResult> {
    this.calls.push({ attrs, idempotencyKey });

    if (this.mode === 'timeout') {
      throw this.timeout();
    }
    if (this.mode === 'timeout-then-ok' && this.failuresBeforeOk > 0) {
      this.failuresBeforeOk -= 1;
      throw this.timeout();
    }

    const naturalKey = String(attrs.TaxRegistrationNumber ?? attrs.SupplierName ?? idempotencyKey);

    // Idempotency: this exact change was already applied → no new/updated entry.
    if (this.seenKeys.has(idempotencyKey)) {
      return { duplicate: true, supplierId: naturalKey };
    }

    this.seenKeys.add(idempotencyKey);
    this.suppliers.set(naturalKey, attrs); // create-or-update (never duplicates)
    return { duplicate: false, supplierId: naturalKey };
  }

  private timeout(): Error {
    const e = new Error('Oracle Fusion request timed out') as Error & { code?: string };
    e.code = 'ETIMEDOUT';
    return e;
  }
}
