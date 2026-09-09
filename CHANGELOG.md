# Eventana — CHANGELOG

> What actually changed, newest first. Every deploy/fix is logged here after it
> ships. Sourced from git history (`main`). This file starts at the 2026-09-08/09
> session; earlier history is in `git log`.

## 2026-09-09 (autonomous safe fixes — 4 items)
- **R-026** — removed the birthday field from first-run onboarding (`Onboarding.tsx`); birthday now only in the profile (also fixes the localStorage dead-end G-003). Customer app rebuilt live.
- **G-010** — Stripe now has a simulator branch (`payments/index.ts` + `simulated.ts` VOCAB); a keyless Stripe in sandbox no longer instantiates a real StripeProvider with a null secret. API live.
- **R-093** — the manager alerts feed now filters `cancelled_at IS NULL`, so a cancelled ops alert disappears immediately (`admin.ts`). (Needs live verification against the exact stuck item the owner saw.)
- **cleanup** — removed the dead `sweepMonthlyReport` import + `void` reference in `reconcile.ts`.
- **R-094 NOT done — needs owner decision:** changing an event's emirate updates `events.emirate` but the delivery FEE lives in the order total; re-pricing a PAID order means a top-up/refund (a money/business decision, not to be guessed). Driver-pay side already recomputes from the live emirate. Flagged for owner.
- One build failed first (Stripe VOCAB missing) and was fixed immediately; final state verified live-green on both apps.

## 2026-09-09 (continued — owner-approved safe items)
- **2b5351f** cleanup: deleted dead/unreachable dashboard screens `Overview.tsx`, `Financials.tsx`, `ShopOrders.tsx` (owner: not needed). Reversible via git; backends untouched.
- **2b5351f** NEW: **weekly report email** to the owner (sheem@eventanauae.com) every Monday 08:00–09:59 Dubai — reuses the monthly reconciliation snapshot (`sweepWeeklyReport` in reconReport.ts, wired in reconcile.ts, deduped per ISO week). Resolves owner decision D-2.
- **0791fcb** recorded owner decisions D-1..D-6 in MASTER_REQUIREMENTS.md.
- Pending owner review (not executed — destructive): merge duplicate customers (only exact-match), clean unpaid orders. Leave-system unification (D-1) = larger change, staged next.

## 2026-09-09
- **Audit governance started.** Created `MASTER_REQUIREMENTS.md`, `IMPLEMENTATION_STATUS.md`, `BUGS_AND_GAPS.md`, `CHANGELOG.md`. Began full code + DB + (pending) live audit across all 10 system areas. No feature code changed during the audit (per owner instruction).
- **b5fa667** recon: fix customer-linkage query (finance_receipts.customer_id is QB bigint, not live text id).
- **082290c** recon: add customer↔event/order linkage + test-account attachment detail (safe-delete check).
- **2381510** diag: CUSTOMER_AUDIT — list health (dups, QB, registered, orders, campaigns). Result: 545 customers (497 QB-origin), 29 registered (0 of them QB), 21 test-like, 5 dup-phone groups, all 88 live orders linked by id, 1691 QB history rows / 1453 matched.
- **d972a21** diag: FEEDBACK_AUDIT. Result: 57 feedback rows, 51 emailed + 51 WhatsApp-processed, 4 pending (future events), 2 cancelled; gates on.
- **3ddefa7** feedback: never send at night — email + WhatsApp only 10:00–20:00 Dubai (G-001 fix).
- **55f1d04 / SEND_TEAM_SCHEDULE** emailed "The Eventana Week" schedule to the 7 team members (all SENT).

## 2026-09-08
- **staff WhatsApp fully wired + switched on:** `WHATSAPP_STAFF_NOTIFY=true`. New approved templates `staff_notify`, `staff_birthday_wish`, `staff_dayoff_wish`. Day-off wellbeing personalised; "who's off today" broadcast (`sweepDayOffRoster`).
- **Customer templates reworded + verified:** removed tracking link from booking_confirmation/three_day_reminder/event_day/booking_updated (kept only in feedback); fixed "لا يُنسى" typo; event_day drops "team on the way"; refund copy; `setup_ready` re-wired to "Party Started" phase. Verified live from Meta: 27 templates approved, every variable count matches code.
- **Part-timer/driver payout tracker** (StaffPay): clown 200/face-paint 350; delivery price by truck size × emirate; driver pay by type (own-car = delivery price, van = 250/day); monthly Pay button; part-timer/driver roster + phones seeded.
- Event team-note panel; event photos upload; supplier dropdown in missing-items; manual task assignment + notification; "Where We Buy" standalone page.
- Read-only recon/audit tooling: customer/supplier recon, customer audit, feedback audit.

## Earlier (pre-session, from memory/git)
See `git log` and the memory files for the full build history (CEO dashboard, CRM, finance/QuickBooks migration, marketing automation, prep system, staffing, annual leave, HR, WhatsApp go-live, guest feedback, booking-view/claim, driver system, etc.).
