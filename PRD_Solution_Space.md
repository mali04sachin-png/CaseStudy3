---
title: Pramaan — Solution Space (PRD)
---

[← Back to overview](index.html)

# Pramaan — Solution Space

*From the PRD. Pramaan checks a vendor once against real government records, then keeps checking every day, on its own.*

---

## 2. Product Concept

Pramaan checks a vendor one time, using real government records. Then it keeps checking, every day, all by itself. Most tools check a vendor once and stop. Pramaan is different — it never stops watching.

| The Old Way | With Pramaan |
|---|---|
| Checked once, on day one. | Checked every day, automatically. |
| Problems found after they cost money. | Problems found the moment they happen. |
| Tax-audit proof built by hand each year. | Proof is ready automatically, every day. |

> **Insight:** Pramaan wins for one simple reason — it never stops watching, even after a vendor is fully signed up.

---

## 3. Primary User Persona

| Persona | Role | Wants Most | Biggest Problem |
|---|---|---|---|
| **Priya** (main user) | Watches vendors for a mid-size company | One screen that shows what needs help today | Finds out about problems too late |
| **Ravi** (vendor) | Owns a small logistics business | To prove he's honest just once | Sends the same papers to every buyer, again and again |
| **Ananya** (IT lead) | Approves new company tools | Safe, official tech connections | Won't approve unofficial shortcuts |

*Real quote from our survey: a vendor said a surprise compliance check at the last step was their worst moment.*

> **Insight:** Priya's biggest need is never being the last person to find out something changed.

---

## 4. Product Flow

**4.1 Onboarding Flow** — Connects to the company's system the first time, with no forms to fill by hand. Vendors are sorted by risk right away, with problems shown at the top. There is no manual checking — it all happens in the background.

**4.2 Input Layer** — The vendor gives a GST number, PAN, and bank info just once. The company's system shares its vendor list automatically. What the vendor says is a guess; what the government says is fact.

**4.3 Core Action Flow** — Pramaan checks every vendor's records automatically, on a schedule. Big changes, like a new bank account, always get flagged. The system finds problems; a person decides what to do next.

**4.4 Recall or Retrieval Flow** — Search a vendor's name to see instantly when it was last checked. What used to take days now takes seconds.

**4.5 Nudge and Follow-Up Flow** — When a big change happens, an alert goes straight to the right person. The alert has one clear button, like "Hold This Payment."

**4.6 System Data Flow (behind the screen)** — Pramaan repeats the same five steps forever, like a circle, not a straight line:

1. Copies the vendor list from the company's system — like syncing contacts to a new phone.
2. The vendor logs in once and agrees to be checked — like signing a gym waiver.
3. Pramaan checks the vendor against real government records — like a passport scan at the airport — and keeps re-checking quietly, only speaking up for big changes, like a smoke detector.
4. When something changes, the right person gets a one-tap alert.
5. The fix is saved back into the company's system automatically.

> **Insight:** The one hard step left is deciding what to do after an alert — a person still makes the final call.

---

## 5. Workflow Mapping — Before and After

A normal day for Priya:

| Before Pramaan | With Pramaan |
|---|---|
| Opens 3+ tools to guess vendor status. | Opens 1 screen, already sorted. |
| New vendor takes ~12 days to onboard. | New vendor takes ~1 day to onboard. |
| Builds tax-audit proof by hand every March. | Proof logs itself, automatically, all year. |

> **Insight:** The biggest saving is time — onboarding drops from 12 days to about 1.

---

## 6. Platform Architecture

| Building Block | What It Does |
|---|---|
| 1. Vendor Intake | Collects a vendor's ID info and consent. |
| 2. Government Check | Checks GST, MSME, company ID, and PAN. |
| 3. Watch Engine | Re-runs the same checks on a schedule, forever. |
| 4. Alerts & Records | Flags serious changes, keeps a permanent record. |
| 5. Company Connect | Sends verified info into the company's own system. |

By law, Pramaan asks for a vendor's consent right away and keeps a permanent, unchangeable record of every check. It only connects to company systems the official, approved way — never an unofficial shortcut.

> **Insight:** The rule that shapes this the most is the law, not the tech — consent and record-keeping come first.

**How it keeps data safe and accurate:** all vendor info lives in one safe place, but each company only ever sees its own private notes. Big changes (like a new bank account) get flagged; small ones (like an address) usually don't. Each person sees only what their job needs. Before paying to check with the government, Pramaan first confirms the numbers look right. If a government website is down, it waits and tries again — it never guesses.

**Two ways to connect — Push and Pull:**

| Push | Pull |
|---|---|
| Pramaan sends the update the moment it happens — like a courier dropping a package at the door. | The company's system checks in on its own schedule and grabs what's new — like checking your mailbox when ready. |
| Best for companies that want updates instantly and are fine letting Pramaan write into their system. | Best for companies whose security rules don't allow an outside system to write in directly. |

Both ways use the same verified data underneath — only who starts the call is different. A company can even use both at once.

---

## 7. Moonshot

**Big idea:** a vendor builds their trust profile once, and every buyer in the country already trusts it.

**Why not yet:** this only works once lots of vendors and buyers already use Pramaan. We prove the basic version first.

> **Insight:** The moonshot saves an entire industry time, not just one company — but only once enough people already trust the smaller version.

---

## 8. User Stories

| Stage | Story | Done When |
|---|---|---|
| Getting Started | As Priya, I want to see every vendor's status the moment I connect, so I don't hunt across 3 tools. | Every vendor shows a status within minutes. |
| Getting Started | As Ravi, I want to fill out my info once, so I stop resubmitting it to every buyer. | A new buyer sees Ravi's profile with no re-upload. |
| Daily Use | As Priya, I want to be warned before a vendor's 45-day tax deadline, so I never miss it. | A view shows exact days left for every at-risk vendor. |
| Daily Use | As Priya, I want an alert the moment a vendor's info changes, so I can act fast. | A change reaches the right person within one check cycle. |

> **Insight:** The story that matters most is the change alert. If Priya misses it, everything else is just a nicer spreadsheet.

---

## 9. MVP Scope

**In one sentence:** Pramaan imports a company's vendor list, checks each vendor's ID against real government records, and sends an alert the moment anything changes.

| Must-Have Feature | What We're Betting | What Proves It Wrong |
|---|---|---|
| Government-checked vendor ID | Vendor info changes often enough to be worth watching. | Vendor status barely ever changes after signup. |
| Ongoing alerts | Getting an alert early changes what the company does. | Alerts get ignored and never change a decision. |
| 45-day tax filter | The tax deadline is painful enough to make people sign up. | Pilot companies shrug at the filter. |
| Company system connection | Companies won't adopt a tool that doesn't plug in. | Pilot buyers are fine using Pramaan standalone. |

> **Insight:** If the belief that vendor data changes often enough turns out wrong, there's nothing left to watch.

---

## 10. What We Left Out and Why

A focused first version only works if what we skip is as deliberate as what we build.

| Left Out For Now | Why Not Now | When We'd Revisit |
|---|---|---|
| A full ERP or buying platform | Would compete with the systems we plug into. | Never on purpose — we stay a plug-in. |
| General cyber-risk scoring | Big, well-funded players already do this well. | Maybe later, as an extra layer. |
| Vendor performance tracking | A different problem than onboarding. | Once the trust layer is proven. |
| Markets outside India | India's tax rules are our proving ground. | After the India version works well. |

> **Insight:** The biggest risk of leaving features out — buyers might expect more than a focused first version gives them.

---

## 11. Success Metrics

These numbers show whether Pramaan is actually helping Priya, not just looking nice.

| Metric | 30-Day Target | Kill Signal |
|---|---|---|
| Onboarding time (**North Star**) | Cut from ~12 days to under a week. | No change by day 30. |
| Vendor profiles reused | At least 1 reused by a second buyer. | Zero reuse by day 30. |
| Alerts routed correctly | 90%+ reach the right person first try. | Below that, Priya stops trusting alerts. |
| Consent capture rate | 100% of sign-ups capture consent. | Any gap is a legal risk. |

> **Insight:** If we track only one number, it's onboarding time — every other metric explains why that one moved.

---

## 12. Implementation Plan

We build Pramaan in a strict order — each step needs the one before it: foundation, then sign-up and consent, then watching and alerts, then company-system connections, then the sharing network last. **Biggest risks:** one verification provider going down, or India's privacy rules changing before the 2026 deadline.

| Phase | What Gets Built | Needs | Done When |
|---|---|---|---|
| 1. Foundation | Database + company data kept separate. | Nothing | One vendor links to many buyers safely. |
| 2. ID Checks | Connects to GST/PAN/MSME checks + backup. | Phase 1 | A real check returns clean data. |
| 3. Sign-Up | Vendor form + consent, wired to checks. | Phase 2 | Can't submit without consent. |
| 4. Watching | Scheduled re-checks + alert rules. | Phases 1–3 | A test change creates the right alert. |
| 5. Alerts | Dashboard + routing + permanent record. | Phase 4 | Alert reaches the right role only. |
| 6. Oracle Link | Connects verified data to Oracle (push or pull). | Phases 1–5 | No duplicate records on repeat sync. |
| 7. SAP Link | Connects verified data to SAP (push or pull), official way. | Phases 1–5 | Data pull succeeds, no rule breaks. |
| 8. Sharing | One-click profile sharing + trust score. | Phases 6–7 | A vendor shares with no re-upload. |

> **Insight:** The riskiest part is leaning on one verification provider before we've proven a backup works too.

---

## 13. Trade-offs and Limitations

| Category | Detail |
|---|---|
| Won't solve | Vendor performance, contracts, payments, or markets outside India (for now). |
| Trade-off made | Faster start now, in exchange for a slightly less official channel until upgraded. |
| Depends on | Verification providers, SAP/Oracle staying supportive, India's privacy rules landing on time. |
| Open question | Who is liable if a "verified" vendor later commits fraud? Needs real legal review. |

> **Insight:** The trade-off I'm least sure about is asking vendors to build a profile before we've proven it's worth their time.

---

## 14. Sources

1. <https://cleartax.in/enterprise>
2. <https://gsthero.com>
3. <https://tallysolutions.com>
4. <https://cleartaxadvisors.in>
5. <https://www.glocertinternational.com/resources/guides/dpdp-act-and-rules-overview/>
6. <https://www.atlassystems.com/blog/digital-personal-data-protection-act-india>
