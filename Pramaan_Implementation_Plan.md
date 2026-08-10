---
title: Pramaan — Implementation Plan
---

[← Back to overview](index.html)

# Pramaan — Implementation Plan

*Step-by-step technical execution sequence, Phases 1–9.*

This plan breaks the build of Pramaan (Vendor Trust Passport) into small, ordered chunks
sequenced by technical dependency — build one chunk at a time, and test each against its
acceptance criteria before moving to the next. Verify every important user flow end-to-end,
including failures and edge cases, not just that the UI works. Give an AI coding assistant the
[ERD](Pramaan_ERD_Engineering_Requirements.html) plus this plan as context, then implement one
chunk at a time.

---

## Phase 1 — Database Schema & Multi-Tenant Row-Level Security

**What gets built:** the core PostgreSQL schema (all 11 tables from the ERD, including `users`);
multi-tenant isolation via Row-Level Security (RLS); the append-only audit-log trigger; and a
role-immutability trigger — once a role (VENDOR / COMPLIANCE / BUYER_ADMIN) is set at creation,
it can never be changed by UPDATE.

**Dependencies:** none — this is the bedrock.

**Acceptance criteria**
- The DB migration runs with no warnings.
- Inserting then trying to UPDATE/DELETE an `audit_log_entries` row throws a database exception.
- Querying `buyer_vendor_links` as Buyer A never returns Buyer B's records, even for a shared vendor.
- Trying to change a `users` row's role throws a database exception.
- The `users` CHECK constraint rejects a VENDOR row with no `vendor_id`, or a COMPLIANCE/BUYER_ADMIN row with no `buyer_id`.

---

## Phase 2 — Verification Provider Abstraction & Core GRVL Adapters

**What gets built:** the `VerificationProvider` abstraction interface; aggregator adapters
(eKYCNow / Deepvue) using the adapter pattern; and circuit-breaker failover logic.

**Dependencies:** Phase 1 database; external sandbox credentials for the aggregator APIs.

**Acceptance criteria**
- `verifyGSTIN("27AAAAA1111A1Z1")` returns normalized data from the primary provider.
- Forcing the primary adapter to return HTTP 500 automatically routes to the secondary provider without a crash.

---

## Phase 3 — Role-Locked Login, Signup & Consent Management

**What gets built:** vendor self-registration (creates a VENDOR account); auto-provisioned
BUYER_ADMIN seed account per new buyer; a Buyer-Admin invite flow that creates COMPLIANCE
accounts; **one shared login screen and endpoint for all three roles** (no "choose your role"
control anywhere); a frontend role route-guard that returns a visible 403 rather than a silent
redirect; DPDP-compliant consent capture; and local GSTIN/PAN regex validation to avoid wasted
API spend.

**Dependencies:** Phase 1's `users` table + role trigger; Phase 2's verification pipeline.

**Acceptance criteria**
- A vendor cannot submit registration unless the DPDP consent box is checked.
- A badly formatted GSTIN returns a local HTTP 400 and never triggers the external API.
- Logging in as Priya (COMPLIANCE) never shows Ravi's (VENDOR) or another buyer's data.
- No button, menu, or API call lets a user change their own role — a new role means a new account.
- A VENDOR JWT calling a COMPLIANCE-only endpoint returns HTTP 403, never an empty list pretending nothing exists.
- A BUYER_ADMIN can only invite COMPLIANCE users into their own tenant.

---

## Phase 4 — Continuous Scheduled Monitoring Engine

**What gets built:** the cron-triggered background worker (CME); the rules-based materiality
filter ("changes that matter"); and the database rules-reference mapping.

**Dependencies:** Phases 1–3 stable.

**Acceptance criteria**
- Simulating a suspended GST status on the mock registry triggers an alert record.
- An address change on a non-essential vendor is logged in `verification_records` but generates **no** active alert.

---

## Phase 5 — Routing Alerts & Append-Only Auditing

**What gets built:** a compliance dashboard for pending alerts; a routing engine directing alerts
to the right internal role (Finance vs. Compliance); and unified transactional logging into the
immutable audit database.

**Dependencies:** Phase 4's alerting database populated.

**Acceptance criteria**
- A bank-detail-change alert routes exclusively to the FINANCE role.
- Acting on an alert appends a non-deletable entry to `audit_log_entries`.

---

## Phase 6 — Oracle Fusion REST Connector (Push)

**What gets built:** a write-back worker using Oracle Fusion's native mapping API (push only —
Pramaan calls Oracle when verified data changes); a sync processor; and idempotency checking.
Sets `erp_connections.sync_direction = 'OUTBOUND'` (or `'TWO_WAY'`).

**Dependencies:** Phases 1–5 stable; Oracle Fusion credentials in a vault.

**Acceptance criteria**
- Pramaan calls Oracle's API with mapped parameters on verified status changes.
- Submitting the same sync batch twice does **not** create duplicate supplier entries.

---

## Phase 7 — ERP-Agnostic Pull API (Bulk + Incremental)

**What gets built:** the pull-side counterpart to the push connectors — built once, reusable by
**any** ERP. `GET /v1/buyers/{buyer_id}/vendors` (bulk, paginated) and
`GET /v1/buyers/{buyer_id}/vendors/changes` (watermark-cursor delta feed). Server-side page-size
cap (default 100, hard cap 500), `resync_required` handling for stale cursors, and
`last_pull_watermark` tracking.

**Dependencies:** Phase 1's tenant scoping. Phase 6 is **not** a prerequisite — this ships
independently of the Oracle push connector.

**Acceptance criteria**
- Even with `page_size` set huge, a request never returns more than 500 rows or another buyer's vendors.
- A `since` older than the retention window returns `resync_required: true`, never a truncated-but-labeled-complete delta.
- A fresh `since` returns only vendors changed after it, plus a `next_since` cursor.

---

## Phase 8 — SAP OData BTP Connector (Push)

**What gets built:** a SAP master-data sync client using officially supported OData V4 paths
(push only); error logging for SAP's API auditing constraints. Sets `sync_direction` as in Phase 6.

**Dependencies:** SAP sandbox / BTP gateway access.

**Acceptance criteria**
- Pramaan completes a read-only baseline sync pulling the initial supplier master from SAP.
- All writes comply with official OData specs, avoiding gateway rejections.

---

## Phase 9 — Profile Sharing, Reuse & Reputation Layer

**What gets built:** a portability engine so a vendor can grant profile access to a second buyer
in one click; and a reputation calculator based on tenure and validation history.

**Dependencies:** Phases 6–8 (the full push + pull ERP layer) integrated and stable.

**Acceptance criteria**
- A registered vendor shares their passport with Buyer B in a single click, no re-upload of tax/bank details.
- The reputation score scales correctly with tenure and successful validation history.
