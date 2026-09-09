# Eventana — MASTER REQUIREMENTS (official reference)

> Single, cumulative source of truth for every requirement the owner has given.
> **Rule:** requirements are **additive**. A new prompt never cancels an old one
> unless it explicitly says "استبدل المتطلب رقم (…)". Before executing any new
> prompt: add it here with a new ID, check for conflicts, tell the owner if it
> changes/cancels anything, add it to the plan, then update
> [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) + [CHANGELOG.md](CHANGELOG.md).

**Status legend:** `Not Started` · `In Progress` · `Implemented` · `Partially Implemented` · `Blocked` (external) · `Needs Verification` (code exists, not yet proven end-to-end).

**A requirement is NOT "Implemented" just because similar code exists.** It must be wired front→back→DB, work without errors, cover all required screens/roles, save & show correct data, use no mock/placeholder data, be tested on real + edge cases, and not break existing features. Until proven, use `Needs Verification`.

Sources: owner prompts (this + prior sessions), memory files, git history, this session's Work Agenda / Objective Report / Bug Report artifacts. Where a source could not be fully retrieved it is marked; nothing here is claimed "reviewed" that was not.

_Last updated: 2026-09-09. Verification of status codes is in progress via a full code+DB+smoke audit (see IMPLEMENTATION_STATUS.md)._

---

## Fields per requirement
`ID` · Description · Source/date · **Status** · Related files · How to verify · Conflicts / missing info

---

## 1. Data & Finance reconciliation

### R-001 — Review all customers against QuickBooks
Every customer vs their **actual** order; find duplicates & wrong amounts; know each customer's source and their events. **Do not guess — use the real QuickBooks reference.**
- Source: owner, 2026-09-08 (backlog #A); re-emphasised 2026-09-09.
- Status: **In Progress** (read-only recon built: `customerSupplierRecon.ts`).
- Files: `apps/api/src/db/customerSupplierRecon.ts`, `customerAudit.ts`; tables `customers`, `historical_customers`, `finance_receipts`, `historical_orders`.
- Verify: run recon; confirm each live customer maps to their events/orders; receipts attributed by id not name.
- Notes: **Root issue found** — `finance_receipts.customer_id` points at `historical_customers` (QB, bigint id), NOT the live `customers` table (text id). This mismatch is the "money attributed by name" problem. Needs a decision on unification (see R-040).

### R-002 — Review all suppliers against QuickBooks
Each supplier: what we actually bought + total spent; match to QB; collapse near-duplicate spellings.
- Source: owner 2026-09-08 (backlog #B).
- Status: **In Progress** (recon lists spend-per-vendor + near-dup spellings; e.g. "The Kids Collection" vs "Kids Collection" = AED 693 split).
- Files: `customerSupplierRecon.ts`; tables `suppliers`, `expenses`.
- Verify: recon output; owner reviews vendor list + merges.

### R-003 — Merge duplicate customers
Same person, multiple rows (guest + registered + QB) splits points/spend. Show owner first; merge safely; never delete without approval.
- Source: owner 2026-09-08 (backlog #ج). Status: **Not Started** (detection built, merge not).
- Verify: dup groups listed; merge tool with preview + undo.

### R-004 — Link old invoices to the correct customer
Fill `customer_id` on old receipts so money never relies on name.
- Source: owner 2026-09-08 (#د). Status: **Partially Implemented** (orders attributed by id — commit 3ea0a46; historical receipts still name-linked).

### R-005 — Review all refunds (quality vs customer-cancel)
Each refund: quality issue or customer-requested cancel? Report.
- Source: owner (backlog #4). Status: **Partially Implemented** (data exists; review/report not done).

### R-006 — Unpaid orders explained/cleaned (the 63,025 / 19)
These are live unpaid orders (abandoned carts + payment links), not QB invoices.
- Source: owner (#2). Status: **Needs Verification**.

### R-007 — QuickBooks "paid with = cash" correction
QB default receipts import as cash; owner says no cash — needs review/convert.
- Source: owner (#3). Status: **Not Started**.

### R-008 — Delete test accounts
Remove test customer accounts (only those with no events/orders).
- Source: owner 2026-09-08/09. Status: **In Progress** (recon lists 21 test-like accounts + which are safe; deletion pending owner confirm of the safe list).
- Verify: list shown; delete only 0-event/0-order rows, logged.

---

## 2. Payments & external links

### R-010 — Tabby integration (installments at checkout). Source #6. Status: **Blocked/owner** (needs account + API).
### R-011 — Tamara integration. Source #7. Status: **Blocked/owner**.
### R-012 — Eventana store page inside Tabby app. Source #11. Status: **Not Started** (depends on R-010).
### R-013 — Bank integration (every transfer/payment requests an invoice; auto-expense). Source #16. Status: **Not Started** (large; needs bank API).
### R-014 — Salik integration (auto gate tolls → expenses). Source #15. Status: **Not Started**.
### R-015 — Traffic fines integration (auto → expenses/alerts). Source #13. Status: **Not Started**.
### R-016 — Auto salary payout (depends on bank). Source #9. Status: **Not Started**.
### R-017 — Stripe / online payment — is real online payment live? Source: platform. Status: **Needs Verification** (audit to confirm provider is wired & live).

---

## 3. Smart automation

### R-020 — Auto customer-reply bot (Claude answers customer messages in their language; sensitive → owner). Builds on WhatsApp leads. Source: owner. Status: **Not Started**.
### R-021 — System designs the concept + emails it to the customer, takes over Marsha's design tasks. Source #19. Status: **Not Started** (builds on design-approval).
### R-022 — Auto Instagram story. Source #10. Status: **Blocked/owner** (needs IG Graph API).
### R-023 — Auto WhatsApp story. Source #11.5. Status: **Blocked** (WA status API not official).
### R-024 — Marketing calendar + campaign engine (owner approves before send). Source: owner. Status: **Not Started** (planned; build after payment).
### R-025 — Missing-item auto-assign + supplier + auto-order. Source: owner 2026-09-08. Status: **Not Started** (extends missing-items).
### R-026 — Customer birthday: optional in profile only (remove from onboarding); send greeting if set. Source: owner 2026-09-08. Status: **Partially Implemented** (`sweepCustomerBirthdays` exists, dormant; onboarding step removal + profile field to verify).

---

## 4. Notifications

### R-030 — "Who is off today" notification to everyone. Source #2.5. Status: **Implemented (2026-09-08)** — `sweepDayOffRoster` (broadcast) + dashboard brief. Needs Verification (delivery).
### R-031 — Close mobile-notification gaps for staff (at-risk/birthday/leave/missing-items push to phone). Source owner. Status: **Implemented (2026-09-08)** — `WHATSAPP_STAFF_NOTIFY` now ON; `staff_notify` template approved. Needs Verification (real delivery per event type).
### R-032 — Today's 4 tasks IN THE DASHBOARD (not WhatsApp), owner picks priority, marks done; 4/day only (owner wellbeing). Source owner 2026-09-08. Status: **Not Started**.
### R-033 — Inventory/consumables count on a day when nobody is off. Source owner. Status: **Not Started**.
### R-034 — Manually assign a task to Marsha (or any staff) + notification. Source owner. Status: **Implemented (2026-09-08)** — `createManualTask` + push. Needs Verification.
### R-035 — Staff birthday WhatsApp in Eventana style, with name. Source owner 2026-09-08. Status: **Implemented (2026-09-08)** — `staff_birthday_wish` template + `staffBirthdays.ts`. Needs Verification (Meta approved; delivery pending a real birthday).
### R-036 — Day-off wellbeing WhatsApp, personalised. Source owner 2026-09-08. Status: **Implemented (2026-09-08)** — `staff_dayoff_wish`. Needs Verification.

---

## 5. Reviews & marketing

### R-040 — Google review auto-reply (Claude, per language; 4-5★ auto, 1-3★ owner-approve). Source owner. Status: **Implemented but OFF** — built/deployed dark; needs Google OAuth + Business Profile API access + Anthropic key. Blocked/owner (R-081).
### R-041 — Meta ads data link (visitor→register→book→buy funnel). Source #M. Status: **Blocked** — needs 3 Render env vars.

---

## 6. Products & content

### R-050 — Product description for every product (ar/en). Source #20. Status: **Not Started**.
### R-051 — Employee handbook + company policy. Source #21. Status: **Not Started**.
### R-052 — Dashboard user manual for the team (per role). Source owner 2026-09-08. Status: **Not Started**.
### R-053 — Employee training system/schedule. Source owner 2026-09-08. Status: **Not Started**.
### R-054 — Add a note in the event for the team (about something the customer said). Source #22. Status: **Implemented (2026-09-08)** — team note panel. Needs Verification.
### R-055 — Owner uploads event photos after the event. Source #23. Status: **Implemented (2026-09-08)** — event photos panel. Needs Verification (upload saves + displays + opens).
### R-056 — Glam Dolls product (2 dolls white/tan 1500 each, dress colour, delivery by emirate, inventory, 1 girl/doll staffing). Source owner. Status: **Not Started**.
### R-057 — New products: kiosks/booths · perfumes · lipstick. Source owner 2026-09-08. Status: **Not Started**.
### R-058 — Translate catalogue to Arabic (product + theme descriptions). Source owner 2026-09-08. Status: **Not Started**.
### R-059 — Photos for everything without an image. Source owner 2026-09-08. Status: **Not Started**.
### R-060 — Create discount codes from the dashboard (UI). Source owner 2026-09-08. Status: **Not Started** (auto codes exist; manual UI not).

---

## 7. Customer app / website

### R-070 — Customer map renders as blank page on laptop. Source #1. Status: **Blocked/owner** — Google Maps API key restriction (ApiTargetBlockedMapError); fix in Google Cloud, not code.
### R-071 — Clarify cancel/refund UI in the INTERNAL app (orders view). Source #5. Status: **Not Started**.
### R-072 — CEO dashboard full redesign (+ fix it advertising removed charts). Source owner. Status: **Not Started**.
### R-073 — Leads don't work on the website (must fix; basis for R-020). Source owner 2026-09-08. Status: **Partially Implemented / broken** — Needs Verification.
### R-074 — Cart on the website (customer collects items, finishes later). Source owner 2026-09-08. Status: **Not Started** (site has no cart).
### R-075 — Abandoned-cart reminder (after cart is built). Source owner. Status: **Depends on R-074**; email/push recovery exists for unpaid bookings.
### R-076 — 3-step birthday booking (type → date → package/booths/decor). Source owner 2026-09-08. Status: **Not Started**.

---

## 8. Vehicle & budgets

### R-077 — Vehicle licence/insurance renewal reminder. Source #12. Status: **Not Started**.
### R-078 — Suggested fuel budget from real spend. Source #17. Status: **Not Started**.
### R-079 — Suggested consumables budget. Source #18. Status: **Not Started**.
### R-080 — Auto ETA from base→event (Distance Matrix). Source #ETA. Status: **Blocked** — depends on Maps key (R-070).

---

## 9. System architecture / integrity

### R-090 — Unify the two customer tables (`customers` ↔ `historical_customers`) + add FK receipt→event for a real single source of truth. Status: **Not Started** (safe staged plan drafted). High importance for R-001.
### R-091 — Email verification at signup (prevent account takeover). Source: audit. Status: **Not Started**.
### R-092 — Unify the two EV references (internal EV-YYYY-NNNN vs customer EV-<number>). Status: **Partially Implemented**.
### R-093 — A reported task/issue must disappear after it's completed (stays visible now). Source #S4. Status: **Partially Implemented** — Needs Verification.
### R-094 — Changing the emirate re-prices delivery. Source #S5. **Status: RESOLVED — no code change (owner decision 2026-09-09).** At checkout, delivery already prices by emirate automatically. A staff-side emirate edit stays MANUAL (owner: "any change we do manually"). The customer cannot change the emirate after booking (reschedule only moves date/time) and the owner does NOT want to add that — if a customer wants a location change they contact the team, who adjust manually. So no auto re-pricing / pay-extra / refund flow is needed. (Uses the customer `delivery_zones` schedule, not the driver-pay schedule.)
### R-095 — Unique-email constraint + dedup. Source #S6. Status: **Not Started**.
### R-096 — Password reset invalidates old sessions. Source #S7. Status: **Not Started**.
### R-097 — Feedback emails/WhatsApp never sent at night (10:00–20:00 Dubai). Source owner 2026-09-09. Status: **Implemented (2026-09-09)** — civil-hour guard in `notify.ts`. Needs Verification.

---

## 10. Part-timer / driver tracker & payroll

### R-100 — Part-timer & driver tracker (auto), monthly email 1st to owner+Marsha. Clown 200 / face-paint 350; driver deliveries by truck size × emirate. Source owner. Status: **Implemented (2026-09-08)** — StaffPay + `staffPayReport.ts`. Needs Verification.
### R-101 — Driver pay by type: own-car (Ubaid/Majeed) = delivery price by size; van (Ali/Rashid/Rana) = AED 250/day; Shan internal excluded. Source owner. Status: **Implemented (2026-09-08)** — verified in code 2026-09-09.
### R-102 — Monthly payout: one Pay button per person for the whole month → WhatsApp with PDF + summary. Source owner. Status: **Partially Implemented** — mark-paid + summary built; WhatsApp send needs `staff_notify` (approved) + PDF-via-WhatsApp needs a document template (Not Started).
### R-103 — Delivery price schedule (small/big truck × emirate), editable, manual delivery entry (no event). Source owner. Status: **Implemented (2026-09-08)**. Needs Verification.
### R-104 — Team weekly schedule ("The Eventana Week") emailed to team. Source owner 2026-09-08. Status: **Implemented (2026-09-08)** — emailed to all 7. Reference artifact archived.

---

## 11. Owner-action / external (blocked on owner or a third party)

### R-110 — Apple Wallet ticket: enable or remove? (built, flag-off). Owner decision.
### R-111 — QuickBooks → production (Intuit questionnaire + prod keys). Owner + Claude session.
### R-112 — Google OAuth + Business Profile API access for reviews (R-040). Owner starts request (takes days).
### R-113 — iOS native push receiving (Capacitor + owner's phone). Owner session.
### R-114 — Share Google Calendar with the service account. Owner step.
### R-115 — Google Business Profile content (Services/Products/Q&A ready to paste; photos need owner). Owner step.
### R-116 — Rotate QuickBooks secret (was pasted in chat). Owner step.
### R-117 — Brand-name decision ("Eventana Events" vs "Eventana UAE") everywhere. Owner decision.

---

## Owner decisions — 2026-09-09 (approved, to execute in stages)
- **D-1 · Merge the two leave systems** into ONE (annual-leave `leave/*` + days-off `days-off/*`), so an approved leave shows everywhere (roster, "who's off today", staffing). → updates G-017.
- **D-2 · Weekly report email** — instead of wiring the hidden `Reports` UI, **email a weekly report to sheem@eventanauae.com** (the Eventana inbox). New req **R-118**. (Extends the existing monthly `sweepReconReport`.)
- **D-3 · Delete unneeded dead screens:** `Overview.tsx` (not needed), `Financials.tsx` (not wanted). `Calendar.tsx` — not needed for now (leave). `ShopOrders` list — not needed. → resolves part of G-015.
- **D-4 · Merge duplicate customers (R-003)** — approved, but **only when 100% certain it is the same person** (exact phone AND email match). Show the candidate list before any merge; never merge on a fuzzy match.
- **D-5 · Unpaid orders (R-006/NC-3)** — owner doesn't need them; **remove/clean them**. (Destructive → show the exact list before deleting; confirm the abandoned-cart reminder email covers real customers first — it does, `abandonedCart.ts`, gated `CART_REMINDERS`.)
- **D-6 · Loyalty points for a late-rated old event (NC-1)** — **points DO count/merge** for the staff member. Resolved.
- **Test accounts (R-008)** — the agent may NOT create/use login accounts or enter passwords/tokens (hard safety rule). Internal-UI live testing needs an owner-driven logged-in session; customer signed links + DB reads cover the rest.

## Needs Clarification (do NOT guess — awaiting owner)
- **NC-1 (R-024/business):** loyalty points for a past event rated later — should the staff member's points increase? (backlog #24) — need the rule.
- **NC-2:** exact merge policy for duplicate customers — which row wins (live vs QB), and what to do with points/spend on merge.
- **NC-3:** which "unpaid orders" are real vs stale to clean (R-006).
- **NC-4:** Tuesday team working hours (schedule) — not in source data.
- **NC-5:** should Sheem's team email be the personal (shaima-ak@hotmail.com) or business (sheem@eventanauae.com) inbox for team mailings.

## Access honesty
Full verbatim review of all 10 prior conversation transcripts was **not** possible (very large). This list is compiled from memory files, git history, code, and this session's artifacts + prompts. Any requirement not traceable to those is flagged **Needs Clarification** — not assumed done.
