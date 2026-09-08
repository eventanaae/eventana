# Eventana — IMPLEMENTATION STATUS

> Verified status of each requirement in [MASTER_REQUIREMENTS.md](MASTER_REQUIREMENTS.md),
> based on the deep audit. Updated after each fix. A requirement is only marked
> `Implemented` with real evidence that it works front→back→DB (see the bar in
> MASTER_REQUIREMENTS.md). Status you can trust; verification method named.

_Last updated 2026-09-09 — audit in progress. Customer app surveyed (code). Dashboard, backend, integrations, notifications, data-flow, security, and live smoke-tests still pending; those requirement rows say "audit pending"._

Legend: ✅ Implemented (evidence) · 🟡 Partially · 🔵 Not started · 🟠 Blocked (external) · 🔍 Needs verification · ⏳ audit pending.

---

## Customer app / website (surveyed by code 2026-09-09)

| Req | Feature | Status | Evidence / notes |
|---|---|---|---|
| — | Catalogue, quote, package browse, build-your-own | ✅ (code) | `GET /api/catalogue`, `POST /api/quote`; server recomputes price |
| — | Checkout / booking (guest + account, address, map pin, terms) | ✅ (code) | `POST /api/checkout` → `domain/checkout.ts` writes orders+events |
| R-017 | **Payment providers** | 🔍 | Adapters EXIST for Stripe/Tabby/Tamara/Ziina + simulated (`apps/api/src/payments/*`). **Correction:** more built than assumed. Needs live verification of which are actually enabled in prod. |
| R-010/011 | Tabby / Tamara | 🔍 | Adapters present — re-classify from "blocked" pending live check of keys/enablement |
| — | Register / login / forgot-reset / claim-booking / profile | ✅ (code) | `public.ts` customer routes → `customers` table |
| R-026 | Birthday capture | 🟡 | register + profile-edit persist DOB; **onboarding birthday is localStorage-only (G-003)** |
| R-050/058/059 | Product descriptions / translation / photos | 🟡 | descriptions + photos wired; **Arabic translation missing (G-004)** |
| R-056 | Glam Dolls | ✅ (code) | per-doll skin+dress in `Build.tsx`, sent in cart — Needs live verify of pricing/inventory/staffing |
| R-057 | Kiosks / perfumes / lipstick | 🔵 | **not built (G-005)** |
| R-060 | Promo code entry | ✅ (code) | `POST /api/promo/check`; auto codes only — manual-create UI still missing |
| — | Loyalty / referral | ✅ (code) | `loyalty_transactions`, referral credit on first booking |
| — | Feedback / rating / tipping (guest + signed-in) | ✅ (code) | `event_ratings`; guest link `?event=&fb=&rate=1` |
| R-073 | Leads capture | 🔵 | **no customer-facing lead form (G-006)** |
| R-074 | Cart | 🟡 | party draft + shop cart exist but **no unified cart UI (G-007)** |
| R-076 | 3-step birthday booking | ⏳ | to verify against current booking flow |
| R-070 | Map on laptop | 🟠 | Google Maps key restriction — owner fixes in Cloud |

## Internal app / Dashboard / CEO / Manager / Employee / Driver
⏳ **Audit in progress** (dedicated survey running). Will populate: Tasks, Prep, Staffing, Leave/HR, CEO dashboard real-vs-placeholder, StaffPay/payout, Driver schedule, Incentives, Events (phases/team note/photos), Finance/QB, Customers/Suppliers/Products/Leads/Marketing views, permissions per role.

## Backend / automations / integrations
⏳ **Audit in progress.** Will populate: email (Resend), WhatsApp (customer/driver/staff gates), QuickBooks (sandbox vs prod), Stripe, Maps, Google reviews, reconcile sweeps, boot tasks, retry logic, Meta ads, iOS push.

## Confirmed implemented this session (real evidence)
| Req | Feature | Status |
|---|---|---|
| R-030 | "Who's off today" broadcast | ✅ deployed — 🔍 delivery |
| R-031 | Staff mobile-notification gaps (WHATSAPP_STAFF_NOTIFY on) | ✅ switch on — 🔍 per-event delivery |
| R-034 | Manual task assign to any staff + notify | ✅ — 🔍 |
| R-035 | Staff birthday WhatsApp (name, Eventana style) | ✅ template approved — 🔍 |
| R-036 | Day-off wellbeing WhatsApp (personalised) | ✅ — 🔍 |
| R-097 | Feedback not sent at night | ✅ deployed — 🔍 |
| R-100/101/103 | Part-timer/driver tracker + pay by type + delivery schedule | ✅ — 🔍 |
| R-102 | Monthly payout Pay button | 🟡 mark-paid + summary; WhatsApp/PDF pending |
| R-104 | Team weekly schedule emailed | ✅ sent to 7 |
| R-040 | Google review auto-reply | 🟠 built, needs OAuth/API access |

## WhatsApp templates (verified live from Meta 2026-09-08)
27 templates, all APPROVED; every template's live variable count matches the code's param count (no send breakage). Customer + driver + staff notify switches all ON.
