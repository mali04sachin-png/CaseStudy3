// Phase 2 — a practice ("mock") verification provider.
// It behaves like a real aggregator adapter (eKYCNow / Deepvue) so we can build
// and prove the whole GRVL engine today, with no paid API keys. Swapping in a
// real adapter later means writing one class that implements VerificationProvider
// and hits the real HTTP endpoint — nothing else in the system changes.

import type { VerificationProvider, GstinResult, GstStatus } from '../types.ts';

export type MockMode = 'ok' | 'http500' | 'timeout';

export interface MockOptions {
  name: string; // e.g. 'eKYCNow' (primary) or 'Deepvue' (backup)
  mode?: MockMode; // how it behaves; default 'ok'
  delayMs?: number; // used by 'timeout' mode to simulate a slow registry
  gstStatus?: GstStatus;
  legalName?: string;
}

export class MockVerificationProvider implements VerificationProvider {
  readonly name: string;
  /** How many times this provider was actually called — handy for tests. */
  calls = 0;

  private mode: MockMode;
  private readonly delayMs: number;
  private readonly gstStatus: GstStatus;
  private readonly legalName: string;

  constructor(opts: MockOptions) {
    this.name = opts.name;
    this.mode = opts.mode ?? 'ok';
    this.delayMs = opts.delayMs ?? 100;
    this.gstStatus = opts.gstStatus ?? 'ACTIVE';
    this.legalName = opts.legalName ?? 'Ravi Logistics Pvt Ltd';
  }

  /** Flip behavior mid-test (e.g. simulate the primary recovering). */
  setMode(mode: MockMode): void {
    this.mode = mode;
  }

  async verifyGSTIN(gstin: string): Promise<GstinResult> {
    this.calls += 1;

    if (this.mode === 'http500') {
      const err = new Error(`${this.name}: upstream returned HTTP 500`) as Error & {
        httpStatus?: number;
      };
      err.httpStatus = 500;
      throw err;
    }

    if (this.mode === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    return {
      field: 'gst_number',
      input: gstin,
      status: 'VALID',
      legalName: this.legalName,
      gstStatus: this.gstStatus,
      registrationDate: '2019-07-01',
      sourceRegistry: 'GSTN',
      sourceProvider: this.name,
      raw: { provider: this.name, gstin, status: this.gstStatus },
      verifiedAt: new Date().toISOString(),
    };
  }
}
