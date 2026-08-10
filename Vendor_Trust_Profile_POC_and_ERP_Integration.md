# Vendor Trust Profile — POC Feature List & ERP Integration Plan

## Part 1: Consolidated POC Features
*(Pulled together from the scattered feature mentions and competitor-benchmarking notes in the source doc)*

### A. Vendor Trust Passport (identity layer)
A single verified profile per vendor, created once:
- Legal identity (CIN), GST, PAN, MSME status, bank account, registered address, key contacts
- **Vendor type** — a required classification field captured alongside the vendor's name from day one (e.g. Goods supplier, Service provider, Contractor, Consultant, Logistics, Other), not an optional afterthought
- **MSME classification** — Micro / Small / Medium / Not MSME, sourced from the Udyam verification in Feature I rather than self-declared, and displayed as a prominent badge next to the vendor name everywhere the vendor appears (passport card, buyer dashboard, search results) — not buried inside a details panel
- Verification status and "last verified" timestamp shown per field, not just once at onboarding

### B. Automated government/registry verification
Replaces "upload a PDF, hope it's current" with direct validation against:
- GSTN (GST registration status)
- Udyam (MSME registration)
- MCA (company registration/CIN)
- Bank account validation (penny-drop or equivalent)
- PAN validation

### C. Continuous change monitoring (the core differentiator)
Establishes a trusted baseline per vendor at onboarding, then watches for:
- Bank account changes
- GST/tax registration changes
- MSME classification changes
- Legal entity changes
- Licence/certification expiry
- Insurance expiry
- Ownership/control changes
- Duplicate or inconsistent vendor records
- Vendor becoming inactive/deregistered

Critically, the doc is explicit that this must filter **"a change" vs. "a change that matters"** — not every detected change should fire an alert; only ones that affect a real business decision.

### D. Alert & response workflow
When a meaningful change is detected:
1. Independently verify it (don't just trust the raw signal)
2. Determine why it matters
3. Identify which business process/obligation is affected (payment, tax, compliance, contract)
4. Route the alert to the right owner (Procurement, Finance, Compliance, Legal — not a generic inbox)
5. Allow the user to launch a reassessment or raise an issue directly from the alert, without switching tools

### E. Audit trail / evidence layer
- Full history of what changed, when it was verified, and what action was taken
- Audit-ready dashboards — this is explicitly called out as necessary for regulatory/compliance defensibility, not just internal tracking

### F. Shared, portable trust profile (later-phase, network layer)
- Vendor verifies once, shares the profile with multiple buyers instead of re-submitting documents to each
- "Trusted by N companies" as a visible reputation signal
- Directly addresses the doc's own example: a vendor supplying Tata, Infosys, Reliance, Wipro, and HUL currently uploads the same GST/PAN/bank/MSME documents five separate times

### G. India-first compliance wedge
- 43B(h) monitoring — this is a real, active law (Income Tax Act provision tied to the same MSMED Act 45-day payment rule researched earlier in this project), giving the India launch a concrete regulatory hook rather than a generic pitch
- GST, MSME, PAN, and bank validation as the initial monitored attribute set, per the doc's own MVP direction
- **This only works operationally if MSME status is filterable, not just recorded.** A Finance team can't manage the 43B(h) 45-day payment clock unless they can instantly pull "show me every MSME vendor" from the full vendor list — see the category filter requirement under Feature A. Without that filter, 43B(h) monitoring is a compliance claim with no daily workflow behind it.

### H. ERP/SAP data portability — push the trust profile into any buyer's system
This is distinct from the "plugs into existing ERP" point in Part 2 below, and worth stating as its own feature. Part 2 covers **inbound** integration — reading a buyer's own vendor master to build the trusted baseline. This is **outbound**: once a vendor's profile is verified, any buyer's ERP should be able to receive that data directly, without their IT team building a custom integration.

- A standardized outbound API (REST/OData) that any buyer's SAP, Oracle Fusion, or other ERP can connect to and pull the verified trust profile into their own supplier record
- Built once per ERP type, not once per customer — a single SAP connector serves every SAP buyer, a single Oracle Fusion connector serves every Oracle buyer, reusing the same native sockets confirmed in Part 2 (Oracle's `externalDataProviderAndSupplierAttributeMappings`, SAP's OData/BTP gateway)
- This is the technical backbone that makes Feature F (shared, portable profile) real — without this API, "reuse" would just mean a vendor emailing a PDF to a new buyer instead of re-scanning documents, which is a smaller win than the doc's actual vision
- Minimal effort for the buyer: no new vendor master, no data migration, no separate login — the verified fields simply populate inside the ERP screens their Procurement and Finance teams already use

### I. Government-sourced trust factor — verified against source-of-truth registries, not self-declared
This is what makes the trust profile more than a nicely organized folder of uploaded PDFs — it should be labeled and badged as **government-verified**, because that's a categorically different trust signal than "the vendor told us."

- Real-time queries against the official Udyam (MSME status), GSTN (GST registration status), and MCA (company registration/CIN status) registries — not documents the vendor uploaded and self-attested to
- **Technical reality, stated accurately:** the Udyam portal doesn't expose a fully open public API for arbitrary use. The realistic and already-proven path is through licensed verification API providers — Protean eGov Technologies (itself a Government of India-promoted entity) is a notable example — who query the official government database directly and return results in 1–5 seconds. This is standard, established practice across Indian fintech and lending verification products already, not a novel or risky integration.
- Feeds directly into Feature C (continuous change monitoring): the same sources get re-queried on an ongoing basis, so a Udyam cancellation, a GST deregistration, or an MCA strike-off is caught the moment it's recorded by the government — not months later during a manual review
- **Why this is a genuine differentiator, tying back to the earlier competitive analysis:** Interos, BitSight, and SecurityScorecard build their risk signals from security questionnaires, breach feeds, and commercial data aggregators — not from a country's authoritative business registries. A trust factor sourced directly from government data can't be self-declared or faked, and any buyer can independently understand why it's credible. This is differentiation angle #2 from the earlier lateral-thinking discussion, now turned into a concrete feature rather than just a strategic argument.

### Phased rollout (as sequenced in the source doc)
| Phase | What ships |
|---|---|
| 1 | Vendor Passport — verify once (GST, PAN, bank) |
| 2 | Passport + Monitoring — alert on change |
| 3 | Network — "trusted by" reuse across buyers |
| 4 | Reputation layer — tenure, compliance history, usage count (credit-bureau-style) |

---

## Part 2: ERP/SAP Integration — without replacing anything

The doc's own thesis is explicit: *"Existing systems can continue owning sourcing, onboarding, procurement, contracts... Our layer begins after a vendor has been approved."* Good news — both major ERPs already have a built-in socket for exactly this kind of overlay. Neither requires migrating vendor master data or standing up a parallel system.

### Oracle Fusion — the strongest fit found

Oracle Fusion Cloud Procurement has a REST API **purpose-built for this exact scenario**: `externalDataProviderAndSupplierAttributeMappings`. It exists specifically to let an external data provider map its own verified attributes onto Oracle's native supplier record — which is precisely what this product is. Alongside it:

- The **Suppliers REST resources** support real-time create, update, and delete on supplier entities, including batch mode for updating many suppliers at once.
- Dedicated sub-resources already exist for the exact fields this product monitors: **External Bank Accounts and Instrument Assignments** (bank details), **Taxpayer Identifiers/Tax Registrations** (GST/PAN-equivalent), and **business classifications** (MSME-equivalent status).

**What this means practically:** the trust layer doesn't need to build its own vendor database and ask companies to "also check our dashboard." It can register as an external data provider, and when it detects a verified bank-account or tax-registration change, push that change directly into the *same fields* Oracle's own procurement and finance teams already use — no new screen, no new login, no re-keying.

This is a strong match for the onboarding process discussed earlier in this project, which already runs on Oracle Fusion ERP for vendor master creation.

### SAP — same pattern, different plumbing

SAP's path is architecturally similar but routes through a different layer:

- Vendor/Business Partner master data is exposed via **OData services**, SAP's standard integration format for master data.
- **SAP BTP API Management** (part of SAP Integration Suite) is the recommended gateway for external systems to read/write this data securely, without exposing the backend directly.
- SAP Ariba already has a dedicated **Supplier Risk** module that is explicitly built to integrate with third-party risk data sources — meaning the "plug external risk signals into the existing supplier workflow" pattern is already an accepted, proven approach in the SAP ecosystem, not something this product would be pioneering.

**One current caveat worth flagging:** SAP has recently tightened enforcement around undocumented or bulk API access, pushing all integrations toward officially published paths (OData V4, CDS views, SAP Graph). This isn't a blocker, but it means the integration must be built on SAP's supported APIs from day one — a "quick and dirty" scraping or bulk-export approach would likely get flagged or blocked, not just discouraged.

### Recommended integration pattern (applies to both)

1. **Read-only baseline sync first** — pull the existing vendor master record via the ERP's native API to establish the "trusted baseline" the doc describes, rather than asking companies to re-enter data that already exists.
2. **Monitor externally** — all the change-detection logic (government registries, document expiry tracking) runs in the trust-layer product itself, not inside the ERP.
3. **Write back only verified, structured change events** — not raw alerts — into the specific supplier fields the ERP already exposes (bank account, tax registration, classification), so Finance/Procurement see the update inside the tool they already use daily.
4. **No new system of record.** The ERP remains the system of record for sourcing, contracts, and payments, exactly as the doc's own positioning states — this product only ever writes verified facts into fields that already exist.

### Correction: ERP/P2P integration is confirmed — and it's table stakes, not a differentiator

The earlier draft of this doc flagged competitor ERP integration as unconfirmed. That was wrong. It's live and mature:

- **Interos' SAP Ariba Supplier Risk integration is published on the official SAP Store**, with its own API package on SAP's Business Accelerator Hub — a formal, productized partnership, not a one-off custom build.
- **Opstream** is an entire middleware category built specifically to plug TPRM/risk tools into 120+ ERP and P2P platforms — its published integration list already includes Whistic, SecurityScorecard, BitSight, OneTrust, Vanta, and others, connecting into SAP, SAP Ariba, Coupa, NetSuite, Workday, and more.
- ServiceNow and Coupa both run active app marketplaces (ServiceNow Store, Coupa App Marketplace) where third-party risk and procurement vendors get formally certified and listed.

**Conclusion: "we integrate with your existing ERP without disruption" is not a moat.** Every serious player in this category already has it, or can acquire it off-the-shelf via middleware like Opstream within weeks. The Oracle Fusion/SAP integration work in Part 2 above is still necessary — skipping it would be a real gap — but it should be positioned internally as **the cost of entry**, not the pitch.

---

## Part 3: Real Differentiation — Lateral Thinking

Given the integration angle is commoditized, differentiation has to come from *what these tools are built to see*, not *how they connect*. Interos, Whistic, BitSight, and SecurityScorecard are fundamentally **cybersecurity and enterprise-risk platforms**, sold to CISO/GRC buyers, monitoring a curated set of *critical* vendors (the ones with system or data access) for breach, financial, geopolitical, and ESG signals. That's the category's core DNA.

The doc's original vision is structurally different: **statutory business-identity monitoring** (GST, PAN, Udyam/MSME, bank account, CIN) for the **entire** vendor base — including the long tail of small, unglamorous vendors that will never receive a cyber risk assessment because they're not worth the cost of one.

Four concrete angles worth building the wedge on:

**1. Long-tail coverage, not critical-vendor coverage.**
Enterprise TPRM tools are priced and architected for the 10–20% of vendors worth a deep risk assessment. Nobody in this competitor set is built to cheaply cover the other 80% — the local logistics vendor, the AMC contractor, the packaging supplier — where "did their GST lapse" matters more than "did they get breached." This is a volume play the incumbents structurally can't chase without undercutting their own pricing model.

**2. Statutory identity data, not risk-score data.**
None of the four are built around India's GSTN, Udyam, or MCA registries — their risk graphs are security/financial/geopolitical, not compliance-registry-native. Building deep, reliable plumbing into Indian statutory registries isn't their priority; it can be this product's moat.

**3. Different buyer, different budget line.**
These tools sell to CISO/GRC. This sells to CFO/Controller/Compliance. "Avoid a 43B(h) penalty and a misdirected payment" is a different urgency and a different budget conversation than "reduce third-party cyber exposure" — a genuinely different go-to-market motion, not a repositioned feature.

**4. Vendor-owned, not buyer-owned (the sharpest angle).**
Whistic already proved "verify once, reuse everywhere" works — but only for security questionnaires, and the vendor is still passively *responding* to buyer demand. The lateral move: make the vendor the active owner of a portable identity (DigiLocker-style), not a dossier a buyer's tool compiles about them. That's a different business model — closer to a two-sided network than a point solution sold into one company's GRC stack.

**Recommendation:** angles #1 and #4 together form the strongest combination — cover the long tail these players ignore, and flip vendors from subject to owner. #2 and #3 are real but function better as supporting moats than as the primary wedge.

---

## Part 4: Government registry verification — named API provider options

Feature I needs real-time access to Udyam, GSTN, PAN, and MCA data. Since none of these registries expose a fully open public API, the realistic path is through a licensed verification provider that already queries these government databases directly. Several exist today — this isn't a build-from-scratch problem:

| Provider | Registries covered | Notable strength |
|---|---|---|
| **Protean eGov Technologies** | Udyam, broader eGov services | Itself a Government of India-promoted entity (also handles PAN issuance for the Income Tax Department) — the most official-adjacent option available |
| **eKYCNow (Message Central)** | Udyam, PAN, GST, CIN, Aadhaar eKYC | Single dashboard covers all four registries this product needs — one integration instead of four separate vendor contracts |
| **AuthBridge** | Udyam, PAN, Aadhaar, Passport | Bundles multiple identity checks into one platform, useful if KYC needs expand beyond business identity later |
| **Gridlines** | Udyam, plus OCR on certificates | Can extract data from an uploaded Udyam certificate via OCR as a fallback when live API lookup isn't available |
| **Decentro** | Udyam, plus broader financial APIs | No-code integration tooling available, useful for a fast POC build |
| **ZOOP / Deepvue / IDSPay** | Udyam | Standard real-time verification, comparable mid-market alternatives worth quoting against the above |

**Recommendation:** eKYCNow looks like the strongest starting point for a POC specifically because it unifies Udyam, PAN, GST, and CIN under one API — matching all four registries Feature I needs, rather than requiring four separate vendor integrations and four separate contracts. Protean is worth a parallel evaluation given its quasi-official standing, which could be a meaningful trust signal in itself ("verified via a Government of India-promoted verification partner").

**Honest caveat:** the capabilities above are drawn from each provider's own marketing material — response times, accuracy rates, and pricing should be independently confirmed directly with each vendor (and tested against a real batch of vendor records) before committing to one in a pitch deck or build plan.

---

## Sources
1. https://docs.oracle.com/en/cloud/saas/procurement/25d/fapra/api-map-external-data-provider-and-supplier-attributes.html
2. https://docs.oracle.com/en/cloud/saas/procurement/25a/fainp/spm-rest-apis-inbound.html
3. https://www.apideck.com/blog/oracle-fusion-cloud-api-integration
4. https://help.sap.com/docs/SAP_INTEGRATED_BUSINESS_PLANNING/da797ae2bf6246d58abd417f24915d55/a62a8082c01246a3a0eebbd2b347a374.html
5. https://aditheos.com/2025/06/25/connecting-sap-backend-odata-services-to-external-systems-using-sap-btp-api-management/
6. https://leverx.com/solutions/sap-ariba-supplier-risk
7. https://sapexpert.ai/news/2026-05-03-saps-api-policy-crackdown-audit-integrations-now/
8. https://www.interos.ai/blog/sap-ariba-partners-with-interos
9. https://api.sap.com/package/INTEROSARIBA/overview
10. https://www.opstream.ai/integrations/
11. https://www.proteantech.in/articles/fastest-udyam-verification-method/
12. https://www.messagecentral.com/blog/udyam-verification-api-india
13. https://figmentglobal.com/msme-verification/
14. https://authbridge.com/checks/udyam-aadhaar-verification/
15. https://gridlines.io/blogs/verify-udyam-registration-with-msme-api/
16. https://drapcode.com/integration/decentro/udyam-verification-api
17. https://www.zoop.one/blog/udyam-verification
18. https://deepvue.ai/udyam-aadhaar-verification/
