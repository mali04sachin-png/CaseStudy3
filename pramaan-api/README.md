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

## Phase 3 — Role-locked login, signup & consent ✅

The doors real people use, with the rules baked in.

- `src/auth/` — `errors.ts` (typed, HTTP-status-carrying errors), `password.ts` (bcrypt),
  `jwt.ts` (login tokens; role is stamped from the account, never sent by the client),
  `guard.ts` (`requireRole` → 403 on mismatch, never a silent empty view).
- `src/db/client.ts` — Postgres connection to Supabase.
- `src/services/` — `buyers.ts` (provision a buyer + its single BUYER_ADMIN),
  `vendors.ts` (self-registration: consent gate → local format check → verify → atomic write),
  `invites.ts` (BUYER_ADMIN invites COMPLIANCE, tenant copied from the token),
  `auth.ts` (one shared login for all roles), `access.ts` (RLS-scoped reads).
- `src/http/server.ts` — the endpoints: `POST /v1/auth/login`, `POST /v1/vendors/register`,
  `POST /v1/buyer-users/invite`, `GET /v1/compliance/alerts` (COMPLIANCE-only).

### Tests

- `test/auth-unit.test.ts` — password, JWT, and role-guard (no DB).
- `test/http.test.ts` — the server: VENDOR→403, COMPLIANCE→200, missing token→401 (no DB).
- `test/auth-integration.test.ts` — runs against the live Supabase DB (set `DATABASE_URL`),
  proving all six acceptance criteria, then cleaning up. Skipped if `DATABASE_URL` is unset.

Run the DB-backed tests with the connection string in the env:

```bash
DATABASE_URL="postgresql://…" npm test
```

## Phase 4 — Continuous Monitoring Engine (CME) ✅

The watchman: re-checks vendors on a schedule and alerts only on changes that matter.

- `src/monitoring/materiality.ts` — looks up the rules table (ERD 4.B) and decides
  if a change is material (alert) or log-only. A rule routed to `NONE` (e.g. a
  non-essential address change) is silent.
- `src/monitoring/cme.ts` — `recordChange` (always log the proof, alert only if
  material) and `runMonitoringCycle` (the cron body: re-verify each active vendor,
  detect status changes, log + route alerts, update the passport).
- `src/monitoring/worker.ts` — the entry point a scheduler invokes:
  `DATABASE_URL="…" node src/monitoring/worker.ts`.
- DB: `../pramaan-db/04_phase4_materiality_fix.sql` corrects the non-essential
  address rule to route to `NONE` (silent), per the spec.

`test/monitoring.test.ts` — suspended GST → alert to Finance; non-essential address
change → logged, no alert; materiality lookups. Runs against the live DB.

## Phase 5 — Routing alerts & append-only auditing ✅

The alert desk: pending alerts, routed to the right owner, with a tamper-proof trail.

- `src/alerts/dashboard.ts` — `listPendingAlerts`: COMPLIANCE-only, RLS-scoped list
  of NEW/ASSIGNED alerts for the caller's tenant, most severe first.
- `src/alerts/routing.ts` — `alertsForRole`: surfaces alerts to their internal owner
  (FINANCE / COMPLIANCE / LEGAL / PROCUREMENT).
- `src/alerts/actions.ts` — `actOnAlert`: assign/resolve/mute/reassess updates the
  alert AND appends a non-deletable `audit_log_entries` row in ONE transaction.
- `src/http/server.ts` — `GET /v1/compliance/alerts` (dashboard),
  `POST /v1/alerts/act` (act on an alert).
- DB: `../pramaan-db/05_phase5_alert_grants.sql` grants the dashboard read access
  under RLS.

`test/alerts.test.ts` — bank change routes exclusively to FINANCE; dashboard is
tenant-scoped; acting appends an audit entry that cannot be deleted; cross-tenant
action refused.

## Phase 6 — Oracle Fusion write-back connector (push) ✅

The first outbound pipe: pushes verified changes into the buyer's Oracle supplier master.

- `src/erp/types.ts` — `ErpClient` socket + `VerifiedChange`.
- `src/erp/idempotency.ts` — SHA-256 fingerprint over
  (vendor_id + field_name + verified_value + verified_at); a repeat push is a no-op.
- `src/erp/mapping.ts` — Pramaan fields → Oracle supplier attributes.
- `src/erp/providers/oracle-mock.ts` — practice Oracle client (honors idempotency,
  simulates timeouts). Swap for a real REST adapter later.
- `src/erp/oracle-connector.ts` — `syncChange` (map → key → call, retry with
  exponential backoff, dead-letter on persistent failure) and `runOracleSync`
  (batch + record connection health, set sync_direction OUTBOUND/TWO_WAY).

`test/erp-oracle.test.ts` — Oracle called with mapped attributes; same batch twice
→ no duplicate supplier; retry-then-succeed; dead-letter; DB marks CONNECTED /
DEGRADED. (Uses the existing `erp_connections` table — no new migration.)

## Requirements

- Node.js 22.6+ (uses native TypeScript type-stripping and the built-in test runner).
  Verified on Node 24. No build step, no dependencies.

## Test

```bash
npm test
```
