---
title: Pramaan — Engineering Requirements & ERD
---

[← Back to overview](index.html)

# Pramaan — Engineering Requirements & ERD

*Vendor Trust Passport System — Engineering Requirements Document.*

---

## 1. Overall Architecture

Pramaan is a service-oriented, event-driven system that decouples document intake and
government-sourced identity verification from downstream transactional ERPs. Five components
operate in a loop, handing work to each other rather than a one-way pipe:

1. **Vendor Passport Intake** — the frontend portal where vendors register, capture DPDP consent, and submit statutory details (GSTIN, PAN, CIN, bank, address).
2. **Government Registry Verification Layer (GRVL)** — an abstraction over third-party aggregator/GSP APIs that validates identity credentials in real time.
3. **Continuous Monitoring Engine (CME)** — a cron-driven queue worker that re-checks the active vendor registry.
4. **Alerting & Audit Service** — applies materiality filters, routes severity-classified alerts to the correct owner, and writes a tamper-proof audit trail.
5. **ERP Integration Layer (EIL)** — pushes verified data outbound to SAP (OData V4 on BTP) and Oracle Fusion (REST), **and** exposes a pull API (bulk + incremental) for buyers whose ERP prefers to poll Pramaan on its own schedule.

The components hand work to each other in a loop: intake feeds verification → the shared database
→ continuous monitoring → alerting → the ERP → and the ERP re-syncs the next baseline.

### Two Integration Patterns: Push vs. Pull

| Pattern | Who Initiates | Endpoints | Best For |
|---|---|---|---|
| **Push (Outbound)** | Pramaan calls the ERP. | Oracle Fusion Write-Back (3.E), SAP BTP OData Write-Back (3.F). | Buyers who want near-real-time updates and whose ERP exposes a write endpoint Pramaan may call. |
| **Pull (Inbound)** | The buyer's ERP calls Pramaan, on its own schedule. | Bulk Vendor Pull (3.G), Incremental Change Feed (3.H). | Buyers who won't let an external system write into their ERP (firewall/security reasons) and prefer their own scheduled pull job. |

`erp_connections.sync_direction` records which pattern is active: `OUTBOUND` (push-only),
`INBOUND` (pull-only), or `TWO_WAY` (both).

### Shared Core vs. Tenant-Scoped Overlay

- **Shared Core** — the verified statutory identity data (verified GST status, verified MSME type). One record per vendor.
- **Tenant-Scoped Overlay** — buyer-specific data (criticality tier, private notes, payment terms). Partition-fenced at the database level, not just filtered in application code.

---

## 2. Data Model, Tables & Relationships

PostgreSQL is the system of record. Multi-tenancy is enforced with Row-Level Security (RLS) plus
application-level policies — never application logic alone.

### `vendors` — shared-core anchor (one row per vendor company)

| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | `gen_random_uuid()` |
| legal_name | VARCHAR(255) NOT NULL | |
| vendor_type | VARCHAR(50) NOT NULL | Proprietary / Partnership / Private Limited |
| created_at | TIMESTAMPTZ NOT NULL | default now |

### `trust_passports` — verified core: statutory identity + per-field verification timestamps

| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| vendor_id | UUID, FK → vendors(id) | ON DELETE CASCADE |
| gst_number | VARCHAR(15), UNIQUE | |
| pan_number | VARCHAR(10), UNIQUE | |
| cin | VARCHAR(21), UNIQUE | MCA Corporate Identity Number |
| bank_account_num_encrypted | BYTEA | AES-256 encrypted |
| bank_ifsc | VARCHAR(11) | |
| registered_address | JSONB NOT NULL | structured address object |
| msme_classification | ENUM msme_tier NOT NULL | MICRO / SMALL / MEDIUM / NOT_APPLICABLE |
| udyam_registration_num | VARCHAR(19), UNIQUE | |
| status | ENUM vendor_status NOT NULL | ACTIVE / SUSPENDED / DEREGISTERED / UNVERIFIED |
| gst/pan/udyam/bank_last_verified_at | TIMESTAMPTZ | per-field verification recency |
| created_at / updated_at | TIMESTAMPTZ NOT NULL | |

### `verification_records` — immutable proof log (every government check ever run)

| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| passport_id | UUID, FK → trust_passports(id) | ON DELETE CASCADE |
| field_name | VARCHAR(50) NOT NULL | gst_number / pan_number / bank_account / udyam |
| source_registry | VARCHAR(50) NOT NULL | GSTN / PROTEAN / UDYAM / MCA |
| source_provider | VARCHAR(50) NOT NULL | eKYCNow / AuthBridge / etc. |
| verified_value | JSONB NOT NULL | raw verified dataset from registry |
| status | VARCHAR(50) NOT NULL | VALID / INVALID / DEGRADED |
| verified_at | TIMESTAMPTZ NOT NULL | default now |

### `buyers` — one row per tenant company

| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| org_name | VARCHAR(255) NOT NULL | |
| erp_type | ENUM erp_provider NOT NULL | SAP_ARIBA / ORACLE_FUSION / NETSUITE / STANDALONE |
| created_at | TIMESTAMPTZ NOT NULL | |

### `users` — one row per login identity (role fixed forever at creation)

| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| email | VARCHAR(255) NOT NULL, UNIQUE | |
| password_hash / sso_subject | VARCHAR(255) | local hash, or federated SSO subject id |
| role | ENUM user_role NOT NULL, **IMMUTABLE** | VENDOR / COMPLIANCE / BUYER_ADMIN — fixed at creation |
| buyer_id | UUID, FK → buyers(id), NULLABLE | set for COMPLIANCE & BUYER_ADMIN; NULL for VENDOR |
| vendor_id | UUID, FK → vendors(id), NULLABLE | set for VENDOR; NULL otherwise |
| invited_by_user_id | UUID, FK → users(id), NULLABLE | set only for COMPLIANCE (who invited them) |
| status | VARCHAR(50) NOT NULL | PENDING_FIRST_LOGIN / ACTIVE / DISABLED |
| created_at / role_assigned_at | TIMESTAMPTZ NOT NULL | role_assigned_at = created_at always |

**Constraint (`role_scope_check`):** `(role = 'VENDOR' AND vendor_id IS NOT NULL AND buyer_id IS NULL)`
OR `(role IN ('COMPLIANCE','BUYER_ADMIN') AND buyer_id IS NOT NULL AND vendor_id IS NULL)`.

### `buyer_vendor_links` — the junction that makes reuse real (one vendor ↔ many buyers)

| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| buyer_id | UUID, FK → buyers(id) | ON DELETE RESTRICT |
| vendor_id | UUID, FK → vendors(id) | ON DELETE RESTRICT |
| tenant_overlay_data | JSONB NOT NULL | buyer-specific metrics/notes, default `{}` |
| internal_criticality | VARCHAR(50) NOT NULL | CRITICAL / SIGNIFICANT / NON_ESSENTIAL, default NON_ESSENTIAL |
| shared_at | TIMESTAMPTZ NOT NULL | |

**Constraint:** `UNIQUE(buyer_id, vendor_id)`.

### `materiality_rules` — decides what counts as an urgent change

| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| field_name | VARCHAR(50) NOT NULL | |
| internal_criticality | VARCHAR(50) NOT NULL | CRITICAL / SIGNIFICANT / NON_ESSENTIAL |
| severity | ENUM alert_severity NOT NULL | LOW / MEDIUM / HIGH / CRITICAL |
| affected_process | VARCHAR(50) NOT NULL | PAYMENT / TAX / CONTRACT / COMPLIANCE |
| routed_to_role | VARCHAR(50) NOT NULL | FINANCE / COMPLIANCE / LEGAL / PROCUREMENT |

**Constraint:** `UNIQUE(field_name, internal_criticality)`.

### `alerts` — a flagged change: what changed, how severe, where routed

| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| vendor_id | UUID, FK → vendors(id) | ON DELETE CASCADE |
| buyer_id | UUID, FK → buyers(id) | ON DELETE CASCADE |
| change_type | VARCHAR(50) NOT NULL | BANK_CHANGE / GST_SUSPENDED / MSME_CLASS_SHIFT |
| severity | ENUM alert_severity NOT NULL | |
| affected_process / routed_to_role | VARCHAR(50) NOT NULL | |
| raw_delta | JSONB NOT NULL | `{"before": ..., "after": ...}` |
| status | ENUM alert_status NOT NULL | NEW / ASSIGNED / REASSESSED / RESOLVED / MUTED, default NEW |
| created_at / updated_at | TIMESTAMPTZ NOT NULL | |

### `consent_records` — the DPDP Act 2023 consent trail (mandatory)

| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| vendor_id | UUID, FK → vendors(id) | ON DELETE CASCADE |
| purpose | TEXT NOT NULL | |
| consent_given_at | TIMESTAMPTZ NOT NULL | |
| consent_manager_ref | VARCHAR(255) NOT NULL | consent manager API key / txn ref |
| is_withdrawn | BOOLEAN NOT NULL | default FALSE |
| withdrawn_at | TIMESTAMPTZ | |

### `erp_connections` — one row per buyer's SAP/Oracle connection

| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| buyer_id | UUID, FK → buyers(id) | ON DELETE CASCADE |
| erp_type | ENUM erp_provider NOT NULL | |
| connection_status | VARCHAR(50) NOT NULL | CONNECTED / DEGRADED / DISCONNECTED |
| last_synced_at | TIMESTAMPTZ | |
| sync_direction | ENUM sync_dir NOT NULL | INBOUND (pull) / OUTBOUND (push) / TWO_WAY |
| last_pull_watermark | TIMESTAMPTZ | the `next_since` cursor the buyer's ERP last used |
| credentials_vault_ref | VARCHAR(255) NOT NULL | vault/KMS reference, never raw credentials |

### `audit_log_entries` — immutable system audit log (append-only at the DB layer)

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL, PK | |
| entity_type | VARCHAR(50) NOT NULL | trust_passports / alerts / consent_records |
| entity_id | UUID NOT NULL | |
| action | VARCHAR(50) NOT NULL | CREATE / UPDATE / VERIFY_FAIL / ALERT_ROUTED |
| actor | VARCHAR(100) NOT NULL | system_cme, or a user's email |
| old_state / new_state | JSONB | |
| timestamp | TIMESTAMPTZ NOT NULL | default now |

### Relationships at a glance

- `vendors` 1—1 `trust_passports`; `trust_passports` 1—many `verification_records`.
- `vendors` many—many `buyers` via `buyer_vendor_links` (the reuse junction).
- `vendors` 1—many `alerts` (scoped to a buyer) and 1—many `consent_records`.
- `buyers` 1—many `erp_connections`; `buyers` 1—many buyer-side `users`.
- `vendors` 1—1 VENDOR `users`; COMPLIANCE users trace back to the BUYER_ADMIN who invited them.

Both `audit_log_entries` and `users.role` are made **immutable by database triggers** (BEFORE
UPDATE/DELETE), for regulatory defensibility (DPDP & Section 43B(h)) and to remove a whole class
of privilege-escalation bugs.

---

## 3. API Contracts

- **A. Outbound Trust Profile** — `GET /v1/vendors/{vendor_id}/trust-profile`. Returns a vendor's consolidated profile for a buyer's ERP; filtering happens in the query, so Buyer A cannot see Buyer B's overlay.
- **B. Vendor Self-Registration** — `POST /v1/vendors/register`. Consent is mandated inside the payload; a request without `consent_given: true` is rejected before verification runs.
- **C. Role-Based Login** — `POST /v1/auth/login`. One endpoint for all three roles; the request never sends a role and the response never offers one to pick — the role is read from the account.
- **D. Buyer-Admin Invites a Compliance User** — `POST /v1/buyer-users/invite` (BUYER_ADMIN-only). `role` fixed to COMPLIANCE at invite; `buyer_id` copied from the admin's own token.
- **E. Oracle Fusion Write-Back** (push) — updates Oracle's supplier master via its native attribute-mapping REST endpoint.
- **F. SAP BTP OData Write-Back** (push) — syncs verified MSME classification into SAP S/4HANA master data.
- **G. Bulk Vendor Pull** (pull) — `GET /v1/buyers/{buyer_id}/vendors`. Paginated, tenant-scoped; `page_size` default 100, hard cap 500.
- **H. Incremental Change Feed** (pull) — `GET /v1/buyers/{buyer_id}/vendors/changes?since=...`. Watermark-cursor delta; returns `resync_required: true` if `since` is older than the retention window.

---

## 4. Core Business Logic

**A. GRVL Circuit Breaker.** The verification layer sits behind a circuit breaker so a flaky
registry never becomes a Pramaan outage. **Closed** → primary healthy. **Open** → 3 consecutive
fails or a >5000ms timeout trips it; calls route to the secondary. **Half-Open** → after a
10-minute cooldown, 5% canary traffic tests the primary; all pass resets to Closed, any fail trips
back to Open.

**B. Continuous Monitoring & Materiality Rules.** Detected changes are classified against a rules
table to avoid alert fatigue:

| Field Changed | Criticality | Severity | Process / Routed To |
|---|---|---|---|
| bank_account_num | Any tier | CRITICAL | Stop payment run; require out-of-band reassessment → Finance |
| gst_number (suspended) | Critical / Significant | HIGH | Hold GST payouts, prevent tax-credit loss → Finance & Compliance |
| gst_number (suspended) | Non-essential | MEDIUM | Internal alert, dashboard flag → Procurement |
| msme_classification | Any tier | HIGH | Reset payment terms; direct 43B(h) trigger → Finance & Compliance |
| registered_address | Critical | MEDIUM | Trigger contract review for delivery risk → Legal |
| registered_address | Non-essential | LOW | Silent update, logged to audit trail → none |

**C. Section 43B(h) MSME Payment Countdown.** Every invoice to a verified Micro or Small
enterprise (Medium is excluded) counts down: `Days Remaining = 45 − (Today − Invoice Date)`. At
≤10 days, a high-priority alert goes to the Compliance Lead and AP system; at ≤0, the invoice is
locked out of the normal payment queue and flagged as breached.

**D. DPDP Consent Lifecycle.** On withdrawal ("Right to Erase"), the consent record is marked
withdrawn, sensitive fields (encrypted bank account, address, contact emails) are zeroed out, and
only anonymized fields (legal name, GST number, immutable log hashes) are retained for tax-audit
structure.

---

## 5. Authentication, Permissions & RLS

There are exactly **three roles**, each fixed forever at account creation:

| Role | Who | How the Account Is Created |
|---|---|---|
| VENDOR | Ravi | Self-registers through the public onboarding portal; consent captured in the same step. One per vendor company. |
| BUYER_ADMIN | Ananya | Auto-provisioned as the single root account when their company is first set up. Not self-service, not invite-based. |
| COMPLIANCE | Priya | Invited by her own company's BUYER_ADMIN; cannot self-register. Her `buyer_id` is copied from the inviting admin. |

**No in-session role switching.** One shared login screen and endpoint serve all three roles; the
JWT's `role` claim (plus `buyer_id`/`vendor_id`) selects the entire screen set. The backend
re-checks the claim on every API call (Open Policy Agent / OpenFGA), so out-of-role data is
unreachable even by hitting the API directly. A mismatch returns **HTTP 403** — never a silently
filtered "fake" smaller view. Needing different access means a second, separate account.

**Tenant isolation** is enforced with PostgreSQL Row-Level Security policies keyed on
`app.current_buyer_id`, on `buyer_vendor_links`, `alerts`, and `erp_connections`.

**What each role can see after login**

| Role | Access | Never Sees |
|---|---|---|
| VENDOR (Ravi) | Write access to their own Trust Passport & Consent records only. | Any other vendor's data; any buyer's dashboard/alerts/overlay. |
| BUYER_ADMIN (Ananya) | Write access to their tenant's ERP settings; can invite/manage COMPLIANCE users; read-only tenant vendor list. | Any other buyer's data; raw vendor credentials (bank details encrypted at rest). |
| COMPLIANCE (Priya) | Write access to Alerts in her tenant; read access to Passports in her tenant. | Any other buyer's data; ERP connection credentials (BUYER_ADMIN-only). |

---

## 6. Validation, Errors & Edge Cases

**Format pre-validation (before any paid API call):** GSTIN, PAN (4th char validates entity
type), and IFSC (checked against the public RBI routing list) are regex-validated locally first.

**ERP write-back:** an idempotency key `sha256(vendor_id + field_name + verified_value +
verified_at)` rides every outbound transaction; timeouts retry up to 3× with exponential backoff;
persistent failures drop to a dead-letter queue and mark the connection DEGRADED.

**Real-world edge cases (selected):**
- A registry is down → the check is queued "Pending Retry," never silently marked unverified.
- A vendor's bank account changes mid-invoice → every active invoice gets an automatic payment hold until Finance clears it.
- A vendor withdraws consent → their shared profile disconnects from every buyer immediately; the withdrawal is logged permanently.
- Unchecked >30 days → status downgrades from "Verified" to "Stale," prompting a manual refresh.
- A tampered JWT claiming a different role → signature validation fails (HTTP 401), logged as a HIGH-severity security alert.

---

## 7. Key Technical Decisions

- **PostgreSQL** — for native Row-Level Security (multi-tenant isolation this product can't work without) plus strong JSONB handling.
- **Event-driven cron queuing over real-time sync** — registry lookups run as async workers, so Pramaan's uptime isn't hostage to a government registry going down.
- **Provider-agnostic abstraction** — the GRVL adapter pattern makes swapping verification providers a config change, not a rewrite.
- **Role is a permanent, immutable account attribute** — enforced at the database layer, removing a whole class of privilege-escalation bugs.
- **Both push AND pull ERP integration, chosen per buyer** — built from day one so a strict-firewall buyer isn't blocked later.

---

## 8. What Is Out of Scope

- **Not** a sourcing or bidding tool (no RFI/RFQ/RFP).
- **Not** a Contract Lifecycle Management tool (only stores contract metadata).
- **Not** a payment processor (never moves money or modifies payment runs directly).
- **Not** a general cyber-risk monitor (strictly statutory identity validation).
