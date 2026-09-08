# Eventana — BUGS & GAPS

> Every defect, missing link, and "exists but doesn't work" found during the deep
> audit. Each has a stable ID. **No random fixes** — audit first, then fix on
> approval, then mark fixed + tested here. Severity: `Critical` / `High` / `Medium` / `Low`.
>
> Evidence type per item: `code` (found by reading code), `db` (found by a real DB
> read), `live` (reproduced in a running app). Anything only `code`-verified that
> asserts runtime behaviour is also tagged **Needs Live Verification**.

_Audit started 2026-09-09. In progress — customer app surveyed; dashboard, backend, notifications/links, data-flow, security, and live smoke-tests pending._

---

## Confirmed this session (real evidence)

### G-001 — Feedback emails/WhatsApp could fire in the middle of the night — FIXED
- App/area: Backend · notifications · customer. Severity: High. Evidence: owner-observed (live) + code.
- Was: `feedback_request` scheduled at event-start-time + 1 day (any hour); reminders queued `now()` with no civil-hour guard → a feedback email went out ~12 midnight.
- Correct: only 10:00–20:00 Dubai; night-due messages held to the next civil hour.
- Root cause: no time-of-day guard in `deliverPendingNotifications`.
- Files: `apps/api/src/domain/notify.ts` (email + WhatsApp sweeps), `lifecycle.ts`, `feedbackReminders.ts`.
- Fix: civil-hour guard added (commit 3ddefa7, live). **Test to prove:** queue a feedback row dated for 02:00 Dubai; confirm it is not sent until 10:00.
- Outcome: **Fixed** — Needs Live Verification (observe next night window).

### G-002 — `team_arrived` template approved but has no trigger (orphaned)
- Area: Dashboard/customer. Severity: Medium. Evidence: code.
- The dashboard phase buttons are only `Booking Confirmed · On The Way · Party Started · Event Completed` (`Events.tsx` `PHASES`). Backend still maps an `Arrived` phase to `team_arrived`, but no button sets it → the message never fires. `setup_ready` was likewise orphaned until re-wired to `Party Started` (commit 963a673).
- Fix options: re-add an Arrived step, or map to an existing phase, or retire the template. **Owner decision.**

### G-003 — Onboarding birthday is a dead-end (never saved server-side)
- App: Customer app. Severity: Medium. Evidence: code.
- First-run onboarding (`Onboarding.tsx:56-77`) collects the birthday and writes it only to `localStorage` (`profile.ts`), promising "we'll wish you". The DB `customers.date_of_birth` is set only by register/profile-edit. A first-run onboarder who never registers gets no birthday greeting.
- Correct: persist the onboarding birthday (or drop the promise). Aligns with R-026 (birthday optional in profile only).
- Files: `apps/customer/src/screens/Onboarding.tsx`, `profile.ts`, `public.ts` register. **Test:** onboard-only user → check `customers.date_of_birth`.

### G-004 — Product text is not translated to Arabic
- App: Customer app. Severity: Medium. Evidence: code.
- Catalogue returns single-language (English) strings; only UI chrome + a few hardcoded package blurbs are Arabic (`i18n.ts:315`). Service/theme names + DB descriptions show English to Arabic users. (= R-058.)
- Fix: add `nameAr`/`descAr` to catalogue + admin editing. **Test:** switch app to Arabic → product names Arabic.

### G-005 — Perfumes & lipstick products do not exist; "kiosks" only a colour attribute
- App: Customer app. Severity: Low (feature-not-built, = R-057). Evidence: code (0 hits for perfume/lipstick). Kiosks exist only as a station colour, not a sellable product.

### G-006 — No customer-facing leads capture form
- App: Customer app/website. Severity: High (= R-073 "leads don't work"). Evidence: code.
- Landing pages funnel straight into the app (a "Start" button) with **no name/phone lead form**. "Leads" exist only as inbound WhatsApp enquiries on the admin side (`whatsapp_leads`). A website visitor who isn't ready to book leaves no trace beyond anonymous visit tracking. This blocks R-020 (auto-reply bot).
- Files: `apps/customer/src/screens/Landing.tsx`; admin `whatsappLeads.ts`. **Test:** as a visitor, try to leave contact details → none possible.

### G-007 — No unified cart UI (party draft + shop cart are separate)
- App: Customer app. Severity: Medium (= R-074). Evidence: code.
- Two disconnected carts: party `Draft` (localStorage) and `shopCart` (in-memory). No `Cart.tsx`, no cart icon. A shopper can't combine party services + shop goods; the shop is a separate checkout. Abandoned-cart recovery (R-075) depends on fixing this.

### G-008 — Mascot / Glam-doll option lists are hardcoded in the client
- App: Customer app. Severity: Low. Evidence: code (`Build.tsx:18,22`). Adding a character/skin tone needs a code change, not a catalogue update. Fragile for content updates.

### G-009 — `POST /api/devices/register` (push) has no web caller
- App: Customer app. Severity: Low. Evidence: code. Only relevant under the Capacitor native wrapper (= R-113 iOS push). Dead for the web app.

---

## Backend / integrations (surveyed by code 2026-09-09)

### G-010 — Stripe has no simulator branch (keyless Stripe in sandbox breaks)
- Area: Backend · payments. Severity: High. Evidence: code.
- `payments/index.ts build()` builds a `SimulatedProvider` for tabby/tamara/ziina but NOT Stripe; a Stripe provider in `simulated` mode (sandbox declared, no keys) falls through to `new StripeProvider(cfg)` with a null `secretKey` → any Stripe API call fails.
- Correct: give Stripe a simulator branch, or refuse to select Stripe without keys. **Test:** sandbox mode, no Stripe keys, start a Stripe checkout → observe failure.

### G-011 — No server-side Maps / distance / travel-time / auto-ETA (all manual)
- Area: Backend · maps · operations. Severity: High (owner explicitly wants distance→departure→ETA auto-calc). Evidence: code.
- There is NO server-side geocoding/places/directions/distance-matrix. `events.eta` is a **manual free-text field** set by staff; driver "directions" is just a `maps/dir` URL. `EVENTANA_BASE_LOCATION` is defined for auto-ETA but consumed nowhere. So: auto travel-time from base→event, required departure time, and auto-ETA are **NOT built**; changing location/time does NOT recompute any of them.
- = answers owner's audit Qs: distance auto? **No.** departure/ETA auto? **No.** Progress % exists (prep `progressPct`) but is not journey/phase-driven.
- **Test:** change an event's location → confirm nothing recomputes.

### G-012 — Google Ads click-ids captured but never reported (unfinished)
- Area: Backend · attribution. Severity: Low. Evidence: code (`public.ts:53`). Google click-ids stored, no Google Ads CAPI import. (Meta CAPI IS wired, pending env vars.)

### G-013 — Dead automations still in the codebase
- Severity: Low (cleanup). `sweepAnniversarySuggestions` (retired, uncalled) and `sweepMonthlyReport` (`void`-parked, superseded by `sweepReconReport`).

### G-014 — Duplicate WhatsApp template-status tooling
- Severity: Low. `whatsappGoLive.ts` (`[wa-status]`) and `db/waTemplateStatus.ts` (`WA_STATUS`) overlap.

## Dashboard / internal apps (surveyed by code 2026-09-09)

### G-015 — Fully-built screens are DEAD / unreachable
- Area: Dashboard. Severity: Medium ("exists but doesn't work"). Evidence: code.
- `views/Overview.tsx` (the "money-free manager overview" — **does not actually exist in the running app**, never imported), `views/Financials.tsx` (manual QB P&L entry, unreachable), `views/Reports.tsx` (**the ONLY reconciliation/diagnostics UI — unreachable**), `views/Calendar.tsx` (unreachable), the `ShopOrders` list view (orphaned; only the drawer is reachable), `Ceo.tsx` `RevenueChart`+`Breakdown` (dead components), `api.reconcile` (orphaned endpoint). Their backends exist but no nav/route reaches them.
- Fix: wire the ones that should exist (Reports/reconcile especially), delete the rest. **Owner decision on which.**

### G-016 — Driver schedule is hardcoded static (no backend) → can go stale
- Area: Dashboard · driver. Severity: Medium. Evidence: code.
- `DriverSchedule.tsx` renders a hardcoded `DAYS` array — no API call. It cannot reflect actual assignments/day-offs, so it can silently drift from reality. (This is the same content as the "Eventana Week" schedule — should be data-driven.)

### G-017 — Two overlapping leave/day-off systems (approval in one invisible to the other)
- Area: Dashboard · Backend · HR. Severity: High (data consistency). Evidence: code.
- Annual-leave (`leave/*`, decisions approved/rejected — used by Leave.tsx/Profile.tsx) AND a separate "days off" system (`days-off/*`, decisions approved/denied — used by Team.tsx/Alerts/Today). Both wired, overlapping; a leave approved in one is not seen by the other. Risk: double-booking / wrong "who's off" data (feeds R-030 day-off roster + staffing).
- Fix: unify into one leave model. **Test:** approve leave in Leave.tsx → check it shows in Team.tsx day-off + staffing availability.

### G-018 — CEO dashboard: real where shown, "not enough data yet" where cost/ad-spend missing
- Area: Dashboard · CEO. Severity: Medium (= R-072 revamp). Evidence: code.
- Numbers shown (cash, P&L, alerts, birthdays) are REAL SQL/QuickBooks. Per-package profit/margin, ad-spend/ROAS, YoY are intentionally hidden as "not enough data yet" because per-event cost + ad-spend aren't captured. Not a bug, but the requested revamp should either capture that data or make the gaps clearer.

## Live smoke-test (browser, 2026-09-09)

### L-1 — Customer production site works end-to-end ✅
- `https://eventanauae.com` loads clean: onboarding → Home (Explore Packages / Build Your Own / Custom Shop / "What are you celebrating") renders **live catalogue** from the API. **No console errors.** Confirms customer app is genuinely wired front→API→DB (live evidence, not just code).

### L-2 — The `.onrender.com` customer URL is CORS-blocked (info)
- `https://eventana-customer.onrender.com` → every API call (track/social-proof/catalogue) fails CORS ("No Access-Control-Allow-Origin"). The API allowlists the brand domain only. Expected, but if anyone shares the raw `.onrender.com` link it is broken. Severity: Low/info. Fix: either add the onrender URL to the allowlist or always use eventanauae.com.

### L-3 — Dashboard login renders; internal views not live-tested
- `https://ops.eventanauae.com` login page renders clean (Email/Password/Use access token), no console errors. Internal dashboard views could NOT be live-tested — no login credentials, and passwords must not be entered by the agent. All dashboard internals remain **Needs Live Verification** (code-verified only). Owner to provide a test login (or drive a shared session) to complete live testing.

### L-4 — Minor UX/localization (Low)
- Onboarding birthday input is `mm/dd/yyyy` (US format) on a UAE app; expect `dd/mm/yyyy`.
- Greeting showed "Good morning" at 00:34 — verify greeting/timezone logic uses Dubai time.

## Still pending (needs owner or a live session)
- **Link destination testing** (every email/WA link actually opens the right page/event, not Loading/404/other-person's-data) — needs per-role login + real event ids. Owner to provide a test event + login.
- **Full per-role live testing** of dashboard/employee/driver flows — needs credentials.
- **Payment live test** — cannot be done by the agent (prohibited + no test cards); owner/dev to run in Stripe/Tabby/Tamara test mode.
- **Security deep pass** (race conditions, exposed data beyond permissions map, timezone correctness across all sends) — partial.
- **Test-account deletion** (R-008): recon lists the safe (0-event/0-order) test accounts; awaiting owner go-ahead to delete the confirmed-safe set.

## Open questions (Needs Clarification — see MASTER_REQUIREMENTS.md)
NC-1 loyalty for late-rated event · NC-2 dup-merge policy · NC-3 which unpaid orders are stale · NC-4 Tuesday hours · NC-5 owner mail inbox.
