// Phase 2 — the GRVL orchestrator.
// One entry point (verifyGSTIN) that: (1) rejects bad formats locally for free,
// (2) tries the primary provider through the circuit breaker, and (3) fails over
// to the backup provider if the primary is unhealthy — never crashing the caller.

import type { VerificationProvider, GstinResult } from './types.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
import { isValidGSTIN } from './validation.ts';

/** Thrown when a value fails local format validation — maps to HTTP 400 at the
 *  API layer, and by design NEVER triggers a paid external call. */
export class InvalidFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFormatError';
  }
}

export interface GRVLOptions {
  timeoutMs?: number; // a primary call slower than this counts as a failure (default 5000)
  breaker?: CircuitBreaker; // inject a pre-configured breaker (tests do this)
}

/** Reject a promise if it does not settle within `ms` milliseconds. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`provider timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class GRVL {
  private readonly primary: VerificationProvider;
  private readonly secondary: VerificationProvider;
  private readonly breaker: CircuitBreaker;
  private readonly timeoutMs: number;

  constructor(
    primary: VerificationProvider,
    secondary: VerificationProvider,
    opts: GRVLOptions = {},
  ) {
    this.primary = primary;
    this.secondary = secondary;
    this.breaker = opts.breaker ?? new CircuitBreaker();
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  /** Current breaker state — exposed for observability and tests. */
  get circuitState() {
    return this.breaker.state;
  }

  async verifyGSTIN(gstin: string): Promise<GstinResult> {
    // 1. Money-saver: bad format is rejected locally, before any paid API call.
    if (!isValidGSTIN(gstin)) {
      throw new InvalidFormatError(`GSTIN "${gstin}" failed local format validation`);
    }

    // 2. Try the primary provider, but only if the breaker permits it.
    if (this.breaker.allowsRequest()) {
      try {
        const result = await withTimeout(this.primary.verifyGSTIN(gstin), this.timeoutMs);
        this.breaker.onSuccess();
        return result;
      } catch {
        this.breaker.onFailure();
        // fall through to the backup provider
      }
    }

    // 3. Primary is open or just failed → serve from the backup provider.
    return this.secondary.verifyGSTIN(gstin);
  }
}
