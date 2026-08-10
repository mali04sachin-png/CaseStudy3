// Phase 2 — GRVL circuit breaker (ERD Section 4.A).
// Keeps a flaky government registry from becoming a Pramaan outage.
//
//   CLOSED    → primary healthy; calls go to the primary.
//   OPEN      → tripped by `failureThreshold` consecutive fails (or timeouts);
//               primary is skipped, calls route to the backup.
//   HALF_OPEN → after `cooldownMs`, a small `canaryRate` of calls tests the
//               primary again. A success closes the circuit; a failure re-opens it.
//
// The clock and RNG are injectable so tests are deterministic.

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // consecutive fails to trip OPEN (default 3)
  cooldownMs?: number; // wait before HALF_OPEN (default 10 minutes)
  canaryRate?: number; // fraction of calls let through in HALF_OPEN (default 0.05)
  now?: () => number; // injectable clock (default Date.now)
  random?: () => number; // injectable RNG (default Math.random)
}

export class CircuitBreaker {
  state: CircuitState = 'CLOSED';

  private consecutiveFailures = 0;
  private openedAt = 0;

  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly canaryRate: number;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 10 * 60 * 1000;
    this.canaryRate = opts.canaryRate ?? 0.05;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
  }

  /** Whether the primary provider may be attempted right now. */
  allowsRequest(): boolean {
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        return this.random() < this.canaryRate; // canary probe
      }
      return false; // still cooling down → skip primary
    }

    // HALF_OPEN: only let the canary fraction through.
    return this.random() < this.canaryRate;
  }

  /** Record a successful primary call. */
  onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
  }

  /** Record a failed (or timed-out) primary call. */
  onFailure(): void {
    this.consecutiveFailures += 1;
    // A failure while probing, or enough failures in a row, trips the breaker.
    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }
}
