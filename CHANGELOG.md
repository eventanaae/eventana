# Eventana — CHANGELOG

> What actually changed, newest first. Every deploy/fix is logged here after it
> ships. Sourced from git history (`main`). This file starts at the 2026-09-08/09
> session; earlier history is in `git log`.

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
