# Case Study 3 — Vendor Trust Platform

**Author:** Sachin Mali

> **In short:** Companies verify a vendor once at signup, then trust that information forever —
> even after bank accounts, GST status, and MSME classification quietly go stale. **Pramaan** is a
> Vendor Trust Platform that verifies each vendor against real government records, keeps watching
> for changes, and lets a vendor prove themselves once and reuse that trust across many buyers.
> The prize: onboarding drops from ~12 days to ~1, and a nasty surprise (a changed bank account,
> a lapsed registration) is caught the moment it happens instead of after it costs money.

This is a full product case study — from user research and problem framing, through the product
concept, to the engineering data model and a phased build plan. Everything below is drawn from the
research and working documents in this repository.

**The story in three layers:**

1. **The problem** — vendor data goes stale, and no single system is responsible for noticing.
2. **The solution** — verify once against government records, then monitor forever, and make trust portable.
3. **The build** — a multi-tenant data model, push *and* pull ERP integration, and a strict 9-phase delivery plan.

### 📖 Read the case study

**Product & strategy**
- **[PRD — Solution Space](PRD_Solution_Space.html)** ⭐ — the product itself (Pramaan): concept, personas, flows, MVP, metrics.
- **[Solution Blueprint](Vendor_Trust_Solution_Blueprint.html)** — the whole idea on one page.
- **[POC Feature List & ERP Integration Plan](Vendor_Trust_Profile_POC_and_ERP_Integration.html)** — the detailed feature version.

**Engineering**
- **[Engineering Requirements & ERD](Pramaan_ERD_Engineering_Requirements.html)** — data model, API contracts, business logic, and security.
- **[Implementation Plan](Pramaan_Implementation_Plan.html)** — the 9-phase, dependency-ordered build sequence.

*(The PRD's Problem Space is still being finalized and will be added here when it's ready.)*

## The problem in one line

Companies check a vendor once when they first sign them up, then treat that information as
true forever — even though bank accounts change, GST registration lapses, MSME status
shifts, and licences expire. No single system is responsible for noticing when the facts
go stale, and that gap creates real payment, tax, and compliance risk.

## The idea

A **Vendor Trust Platform** that:

- Builds one verified profile per vendor (GST, PAN, CIN, MSME, bank, address), checked
  against government registries in real time — not just self-uploaded documents.
- Keeps watching that profile and raises an alert when something important changes.
- Keeps a full audit history of what changed, when it was verified, and who acted on it.
- Lets a vendor verify once and reuse that profile with many buyers, instead of resubmitting
  the same documents over and over.
- Uses India's 43B(h) MSME payment rule as a concrete regulatory hook for launch.

**Who it's for:** the long tail of small vendors that never get a proper risk review, and the
CFO / Compliance teams who carry the payment and tax risk when a vendor's details go bad.

## What's in this folder

| File | What it is |
|---|---|
| `Instructions to Claude.txt` | The task brief and writing rules for filling in the PRD |
| `PRD Template [E2E]v8.docx` | The PRD template being filled in (the main deliverable) |
| `Problem Statement & Solution POC.docx` | Problem statement and proof-of-concept summary |
| `Vendor_Trust_Solution_Blueprint.md` | The solution, boiled down to five capability clusters |
| `Vendor_Trust_Profile_POC_and_ERP_Integration.md` | Proof-of-concept and ERP integration notes |
| `Vendor_Onboarding_Key_Challenges.docx` | The main pain points in vendor onboarding |
| `A Vendor Management System.docx` | Background write-up on vendor management |
| `Case Study3-Vendor Management.odt` | Long-form case study document |
| `Research.xlsx` | Primary and secondary research, competitor analysis, references |
| `Week 4 - G6 - CS3.xlsx` | Working research workbook |
| `Phone-interview.docx` | Interview transcript (primary research) |
| `Vendor Onboarding Feedback Survey (Responses).xlsx` | Survey responses |
| `Vendor Onboarding Feedback Survey - Google Forms.pdf` | The survey form |
| `Pramaan_ERD_Engineering_Requirements.docx` | Engineering requirements |
| `Pramaan_Implementation_Plan.docx` | Implementation plan |
| `My Bro or Pravin Pethkar ...txt` | Interview / conversation notes |

## How it's built out (MVP phases)

1. **Vendor Passport** — verify once (GST, PAN, bank, Udyam).
2. **Passport + Monitoring** — alert when something changes.
3. **Network** — outbound API so one vendor's verified profile is reused across buyers.
4. **Reputation layer** — tenure, compliance history, and usage count.

## Success it aims for

- Vendor onboarding time: **12 days → 1 day**
- Number of buyers reusing a single vendor's verified profile (proves the network effect)
- Count of duplicate document requests removed
