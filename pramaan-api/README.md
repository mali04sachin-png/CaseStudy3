# pramaan-api

Pramaan backend. Built phase by phase per `../Pramaan_Implementation_Plan.md`.

## Phase 2 — Government Registry Verification Layer (GRVL) ✅

The fact-checker: confirms a vendor's GST/PAN against a government registry, with
automatic failover so a flaky provider never takes Pramaan down.

- `src/verification/types.ts` — the `VerificationProvider` interface (the universal
  socket every provider plugs into) and the normalized `GstinResult` shape.
- `src/verification/validation.ts` — local GSTIN/PAN/IFSC format checks, run **before**
  any paid API call.
- `src/verification/circuit-breaker.ts` — CLOSED → OPEN → HALF_OPEN failover logic
  (ERD Section 4.A).
- `src/verification/providers/mock-provider.ts` — a practice provider that behaves
  like a real aggregator (eKYCNow / Deepvue). Swap in real API adapters later by
  writing one class that implements `VerificationProvider`.
- `src/verification/grvl.ts` — the orchestrator: validate → try primary via breaker →
  fail over to backup.

### Real providers later

Nothing else changes when real keys arrive: add e.g. `providers/ekycnow.ts` that
implements `VerificationProvider` by calling the real HTTP endpoint, and pass it to
`GRVL` in place of a mock.

## Requirements

- Node.js 22.6+ (uses native TypeScript type-stripping and the built-in test runner).
  Verified on Node 24. No build step, no dependencies.

## Test

```bash
npm test
```
