# Pramaan — Backend Integration Spec

Frontend: `Pramaan.dc.html` (single component, in-memory state). Everything below maps its mock data/state to real API calls so a backend can be swapped in without changing layout.

## 1. Data models

**Vendor** (`VENDOR_SEED`)
```
id, name, gst, pan, ifsc, bank,
msme: "Micro Enterprise" | "Small Enterprise" | "Medium Enterprise" | "Not Registered",
criticality: "Non-essential" | "Significant" | "Critical",
state: "awaiting_consent" | "retrying" | "verified",
risk: "low" | "medium" | "high",
days: number|null,        // days left in 45-day 43B(h) window
history: [{ date, description }]
```

**Alert** (`ALERT_SEED`)
```
id, vendorIdx -> vendorId, changeType: "BANK_CHANGE"|"GST_SUSPENDED"|"MSME_CLASS_SHIFT"|"ADDRESS_CHANGE",
process: "PAYMENT"|"TAX"|"COMPLIANCE"|"CONTRACT"|"NONE",
description, severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW",
timestamp, routedTo, status: "open"|"held"|"logged"
```

**User / session**: `{ role: "priya"|"ravi"|"ananya", username, org }`

## 2. Endpoints needed

| Action in UI | Endpoint | Notes |
|---|---|---|
| Sign in | `POST /auth/login` `{username, password}` → `{token, role}` | replaces `doLogin` dummy check |
| Register | `POST /auth/register` `{name, email, org, password, role}` | |
| Forgot password | `POST /auth/forgot` `{email}` | always 200, generic message |
| List vendors (buyer view) | `GET /vendors?buyerOrgId=` | → array of Vendor, feeds `sortedVendors`/`dashVendors` |
| Vendor detail | `GET /vendors/:id` | feeds drawer + `history` |
| Vendor search | `GET /vendors/search?q=` | server-side filter instead of client `filteredVendors` |
| Tax-risk list | `GET /vendors?taxWindow=45` or reuse vendor list + client filter on `days` | |
| Ravi: submit consent | `POST /vendors/:id/consent` `{granted:true}` | writes immutable audit record |
| Ravi: submit KYC | `POST /vendors/:id/kyc` `{gst,pan,bank,ifsc}` | triggers async govt check |
| KYC check status (poll or websocket) | `GET /vendors/:id/kyc-status` → `{stage, provider, log[]}` | drives the `raviCheckLog` sequence (eKYCNow → AuthBridge failover) |
| Withdraw consent | `POST /vendors/:id/withdraw` | erases bank/address, keeps GST/PAN + audit log |
| Alerts list | `GET /alerts?orgId=` | feeds `highAlerts`/`mediumAlerts`/`lowAlerts` |
| Action an alert | `POST /alerts/:id/hold` | sets status → held |
| ERP connections (Ananya) | `GET /integrations`, `POST /integrations/:name/connect` | Oracle/SAP connect buttons |

## 3. Real-time / propagation

Ravi completing consent+KYC must immediately update Priya's dashboard, tax filter, and search — implement via:
- WebSocket/SSE channel `vendor.updated` pushing the changed Vendor row, or
- Poll `GET /vendors?updatedSince=` every N seconds.

The frontend already re-derives all views from a single `vendors` list — point that list at live data and the sort/filter/severity logic in `renderVals()` keeps working unchanged.

## 4. Auth / session rules to preserve

- Role is fixed for the session once logged in (no client-side role switch) — enforce server-side too (JWT claim = role, checked per endpoint).
- Priya only sees vendors linked to her `orgId`; vendor private notes are scoped per buyer org, never shared.

## 5. Business rules to keep server-side (currently hardcoded in JS, must move to backend)

- 45-day 43B(h) countdown, Micro/Small only (exclude Medium).
- 4-tier severity routing table (`SEVERITY_META` / `PROCESS_ACTION`) — who an alert routes to per change type + vendor criticality.
- GST/PAN/IFSC format validation (regexes in `renderVals`) should be duplicated server-side before spending a government-lookup call.
- eKYCNow → AuthBridge failover + circuit breaker behavior.

## 6. Suggested integration order

1. Auth endpoints (unblocks login).
2. `GET /vendors` (unblocks dashboard, tax filter, search — all read from one list).
3. Alerts read + hold action.
4. Ravi's consent/KYC POST + status polling.
5. Real-time propagation (websocket) last — polling is a fine interim step.
