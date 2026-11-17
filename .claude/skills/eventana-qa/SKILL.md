---
name: eventana-qa
description: >-
  QA, testing, bug-hunting and safe auto-repair for the two Eventana apps
  (customer booking website + Ops dashboard) and the API that joins them. Use
  when asked to audit, test, reproduce a bug, write/run tests, review a change
  before deploy, or produce a QA report. Encodes the architecture, the real test
  commands, the approved business rules, and the non-negotiable safety limits.
---

# Eventana QA

A reusable playbook for finding, reproducing, fixing and preventing defects
across Eventana without breaking anything live.

## The system under test

Monorepo (npm workspaces) at the repo root. Three deployables on Render, one DB.

| Workspace | What it is | Stack | Render service | Build |
|---|---|---|---|---|
| `apps/customer` | Customer booking website (the SPA people book on) | Vite 6 + React 18, TS strict | `eventana-customer` (static) | `tsc -b && vite build && node scripts/prerender.mjs` |
| `apps/dashboard` | Eventana Ops — internal operations dashboard (PWA) | Vite + React, TS strict | `eventana-dashboard` (static) | `tsc -b && vite build` |
| `apps/api` | Booking/payment engine + all server logic | Fastify + TS, Postgres | `eventana-api` (web) | `tsc -b` |
| `packages/shared` | Types + pure helpers shared by all three | TS | — | `tsc -b` |

- DB: Postgres `eventana-db` (Render). The API owns the schema (`apps/api/src/db/schema.sql`, applied on boot).
- Deploy: push to `main` → Render auto-deploys all three. There is **no staging environment**; prod is `https://eventanauae.com` (customer) and `ops.eventanauae.com` (dashboard).
- The customer app prerenders landing pages; the SPA hydrates on top.

### Environments & the no-local-node fact
There is **no Node/npm on the developer machine** this runs on. You cannot run
`npm`, `vitest`, `vite` or Playwright locally. Tests run **only in GitHub
Actions CI**, and the type-check that gates a Render build is the first signal a
change compiles. Treat CI as the verification surface; never claim a test
"passed" from local reasoning alone.

## Test commands (run in CI, not locally)

```bash
# API unit/integration tests (vitest)
npm run test -w @eventana/api            # add --passWithNoTests if the suite is empty

# Type-check (what the Render build gates on — a clean tsc means it will deploy)
npm run build -w @eventana/shared
tsc -b apps/api
tsc -b apps/customer
tsc -b apps/dashboard

# End-to-end (Playwright) — see tests/e2e
npm --prefix tests/e2e ci
npx --prefix tests/e2e playwright test     # BASE_URL env points at the target site
```

E2E lives in `tests/e2e/` with `playwright.config.ts`; `BASE_URL` selects the
target (defaults to prod). The CI workflow is `.github/workflows/qa.yml`.

## QA workflows

Pick the one that matches the request.

### 1. Full audit
Read `MASTER_REQUIREMENTS.md`, `IMPLEMENTATION_STATUS.md`, `BUGS_AND_GAPS.md`
and the memory index first — they hold the approved scope and known gaps. Then
fan out read-only `Explore`/review agents per area (checkout, payments,
staffing, finance, auth) and collect findings as `file:line` + severity. Do not
restate what git history already records.

### 2. Customer website testing
Drive the real journey in the in-app browser (mobile viewport) exactly as a
customer would, and **stop before payment** (see Safety). Cover: date/time,
emirate + map pin (or "pin later"), package → castle colour → theme, add-ons,
the "Add more items" round-trip (package must survive, step + typed details must
be restored), promo code + the available-code hint, the quote total, and the
negative paths (invalid phone, missing map pin, too-soon date, blocked emirate).

### 3. Ops (dashboard) testing
Sign in as owner and as a restricted employee. Verify **permission boundaries**:
a non-manager must not see finance/CEO/admin data or routes. Then exercise each
module (customers, sales/invoices, expenses, events/calendar, staffing, tasks,
prep, inventory, HR/leave/warnings, notifications, reports) for calculation
accuracy and workflow consistency. Role model lives in `apps/dashboard/src/App.tsx`
(ROLE_VIEWS / NAV) and `apps/api/src/routes/admin.ts` (server gates) — the server
gate is the one that matters; a hidden nav item is not access control.

### 4. Cross-application testing
A booking created on the customer site must appear in Ops with matching
customer, date, location, services, price and payment status, and generate the
right receipt/sale. The join is `finance_receipts` ↔ `events` by `EV-<number>`;
booking confirmation is the ONLY place an event id is minted
(`apps/api/src/domain/confirm.ts`). Verify with read-only DB reads via the
env-gated boot-task pattern + `list_logs` (see memory: "Eventana DB access") —
never a destructive write to prod.

### 5. Regression + bug investigation/repair
Reproduce → capture logs/screenshots → root-cause → severity → smallest safe fix
→ re-check. After any fix, run a review agent (standing rule: "verify each
task") to catch forgotten wiring/side-effects. For a frontend fix, the Render
build's `tsc -b` is the compile gate; watch the deploy to `live` and verify the
behaviour in the browser before calling it fixed.

### 6. QA report
Separate three buckets explicitly: **verified** (you reproduced/observed it),
**untested** (not exercised), **assumption** (inferred from code). Never blur
them. Include: totals, pass/fail, bugs found/fixed/open, and per-surface health
(customer / ops / integration).

## Approved business rules (do NOT invent pricing or policy)
Pricing, packages, delivery fees, discount terms and durations are **defined in
code + DB**, not by you. Read them; never fabricate a number in a test or report.
Anchors:
- Catalogue/packages/services: synced from `apps/api/src/domain/catalogue.ts` on boot (code-defined, not QuickBooks).
- Delivery fees: `catalogue.deliveryZones` per emirate; some emirates are blocked.
- Party length: standard 4h; a build with décor/inflatables/machines runs 6h (`effectiveEventHours` in `@eventana/shared`).
- Discounts: `WELCOME10` = 10% first booking, min AED 2,000, online only; win-back = AED 600 off next booking > AED 3,000, single-use. Promo validity is authoritative on the **server** (`api.checkPromo`); the client preview only mirrors it.
- Points redemption ~2%, referral AED 250 both sides (see memory "business rules").
When a rule is unclear, read the source or ask — do not guess.

## NON-NEGOTIABLE SAFETY (applies to every workflow above)
- **Never complete a real payment** and never use a live customer's account. Customer E2E stops at the pay step; no order is created before pay.
- **Never delete or mutate real customer/financial records** to make a test pass. Prod DB access is **read-only** unless the user explicitly approves a specific write.
- Never expose secrets, passwords, card or personal data in a report or commit.
- Never bypass a role/permission check or disable a security check to pass a test.
- Never deploy unapproved changes; never auto-deploy. Pushing to `main` deploys to prod — only push fixes the user has approved, and prefer a branch + PR for anything touching payments, auth, financial records or migrations.
- Never claim a bug is fixed without observing the fix (CI green and/or the behaviour verified in the browser).
- Use obviously-synthetic test data (e.g. name "QA Test", a test email, phone `0501234567`). Keep it out of live outbound sends.

## Handy references
- Known gaps / backlog: `BUGS_AND_GAPS.md`, `IMPLEMENTATION_STATUS.md`, memory bug-comb notes.
- Payment spine: `apps/api/src/domain/confirm.ts`, `apps/api/src/routes/webhooks.ts`, `apps/api/src/payments/*`.
- Checkout flow: `apps/customer/src/screens/Checkout.tsx` (6-step wizard), `Build.tsx`, `BuildIntake.tsx`.
- Deploy/verify loop: push `main` → watch Render deploy to `live` → verify in the in-app browser.
