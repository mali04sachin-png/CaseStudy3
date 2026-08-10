---
title: Vendor Trust Platform — Solution Blueprint
---

[← Back to overview](index.html)

# Vendor Trust Platform — Solution Blueprint

## The problem, in one line
Companies verify a vendor once at onboarding, then treat that information as permanently true — even though bank accounts change, GST lapses, MSME status shifts, and licences expire, with no single system responsible for noticing.

## Who this is for
**Primary wedge:** the long-tail vendor base of Indian enterprises — the hundreds of small, unglamorous vendors (local logistics, AMC contractors, packaging suppliers) that will never get a proper cyber-risk assessment because they're not worth the cost of one, but whose GST/bank/MSME status still creates real payment, tax, and compliance risk.
**Buyer:** CFO / Controller / Compliance — not CISO/GRC. The urgency is "avoid a 43B(h) penalty and a misdirected payment," not "reduce third-party cyber exposure."

## The solution — five capability clusters
*(Consolidating the nine features validated earlier into groups a prototype can be scoped around)*

**1. Trust Passport & Verification** — one profile per vendor (GST, PAN, CIN, MSME, bank, address), validated against government registries in real time via a licensed API provider (eKYCNow or Protean eGov), not just self-uploaded documents. **Vendor type and MSME classification are captured as core fields against every vendor's name from day one — not optional metadata** — with a dedicated category filter so Finance can instantly isolate every MSME vendor, which is the operational mechanism the 43B(h) compliance wedge actually depends on.

**2. Continuous Monitoring & Alerts** — the trusted baseline is watched on an ongoing basis. When something meaningful changes (bank account, GST status, MSME classification, licence expiry), the system verifies it, determines why it matters, and routes it to the right owner — Procurement, Finance, Compliance, or Legal.

**3. Trust & Audit Layer** — full history of what changed, when it was verified, and what action was taken. Audit-ready, not just internally logged.

**4. Network & Portability** — a vendor verifies once and shares the profile with every buyer, instead of re-submitting the same documents five times. Backed by a standardized outbound API so any buyer's SAP or Oracle Fusion instance can pull the verified data in directly.

**5. India-first regulatory wedge** — 43B(h) monitoring gives the India launch a concrete, real regulatory hook (tied to the MSMED Act 45-day payment rule) rather than a generic pitch.

## How it's different
Four differentiation angles validated against real competitors (Interos, Whistic, BitSight, SecurityScorecard — all of whom already have mature ERP integrations, so that's table stakes, not a moat):

1. **Long-tail coverage** — incumbents are priced for the 10–20% of "critical" vendors; nobody cheaply covers the other 80%.
2. **Statutory data, not risk-score data** — sourced from GSTN/Udyam/MCA directly, not security questionnaires or breach feeds.
3. **Different buyer, different budget** — CFO/Compliance, not CISO/GRC.
4. **Vendor-owned, not buyer-owned** — the vendor actively builds and controls a portable identity, closer to a two-sided network than a point solution sold into one company's GRC stack.

## MVP phasing
| Phase | What ships |
|---|---|
| 1 | Vendor Passport — verify once (GST, PAN, bank, Udyam) |
| 2 | Passport + Monitoring — alert on change |
| 3 | Network — outbound API, "trusted by" reuse across buyers |
| 4 | Reputation layer — tenure, compliance history, usage count |

## Success metrics (from the original product thesis)
- **Average vendor onboarding time:** 12 days → 1 day
- **Profiles reused:** number of buyer companies reusing a single vendor's verified profile (the most important metric — proves the network effect, not just the onboarding-speed effect)
- **Documents not requested:** a running count of duplicate document requests eliminated — becomes a concrete marketing number

---

*Architecture diagram follows below.*
