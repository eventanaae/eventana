# Eventana: systems inventory for the AI team design

Compiled 2026-11-26 by reading the repos only. Nothing was built, run, or changed.
All paths are relative to `/home/user/eventana` unless they start with `/`.

Notes on sources:
- The governance docs (`MASTER_REQUIREMENTS.md`, `IMPLEMENTATION_STATUS.md`, `BUGS_AND_GAPS.md`) were last updated 2026-09-09. Code changed a lot after that (Oct to Nov 2026), so some of their "gaps" are now closed. Where the code contradicts a doc, this file says so.
- `CHANGELOG.md` is only 38 lines (it stops at 2026-09-09). The local git clone has 101 commits (2026-11-11 to 2026-11-19); I read those instead of "the latest 150 entries".
- "Built" means the code exists. Whether it runs in production usually depends on env vars or switches (listed per item). I could not check which switches are on in Render.

---

## 1. Systems map

| System | Where | What it does for the business |
|---|---|---|
| Customer site / app | `apps/customer` (Vite + React SPA, prerendered landing pages). Live at `https://eventanauae.com`, Render static service `eventana-customer` | Customers browse packages and themes, build a party (Build Your Own), get a server-computed quote, pay (Stripe / Tabby / Tamara / Ziina), manage their booking ("My Event"), reschedule (>72h out), rate the event, tip, and buy from the shop. It also hosts 20 SEO landing pages, a lead form, an AI Event Designer, a rule-based assistant, and the owner's voice-recording page `public/rec.html`. |
| Ops dashboard ("Eventana Ops") | `apps/dashboard` (Vite + React PWA). Live at `https://ops.eventanauae.com`, Render static `eventana-dashboard` | Internal operations by role (owner, manager, staff, driver): events, prep tasks, staffing, inventory, finance (sales, invoices, expenses, bank inbox), CRM, leads with a WhatsApp reply box, marketing campaigns, AI Studio, Story Studio, CEO dashboard, KPIs, HR (leave, team, staff pay), Google reviews, settings. |
| API ("the engine") | `apps/api` (Fastify + TypeScript). Render web service `eventana-api` (Frankfurt), `https://eventana-api.onrender.com` | The only source of truth for prices and money. Handles checkout, payment webhooks, booking confirmation (the only place an Event ID is created, `domain/confirm.ts`), notifications, all automations (one 5-minute reconcile loop, `domain/reconcile.ts`), integrations, and the admin API (`routes/admin.ts`, about 7,800 lines). |
| Shared rules | `packages/shared/src` (`catalogue.ts`, `pricing.ts`, `rules.ts`, `refund.ts`, `shop.ts`, `money.ts`) | Types, the catalogue, and every pricing rule. Money is integer fils everywhere. |
| Database | Postgres 16, Render `eventana-db`. Schema in `apps/api/src/db/schema.sql` (2,025 lines, applied on boot) | About 100 tables (see section 3). |
| Deploy | `render.yaml` (blueprint). Pushing to `main` auto-deploys all three services. There is no staging. CI is in `.github/workflows/qa.yml` (API tests + Playwright e2e) plus two iOS TestFlight workflows (`ios-customer-testflight.yml`, `ios-dashboard-testflight.yml`). | Secrets live only in Render env vars. `eventana-qa` says there is no local Node on the owner's machine, so CI and Render builds are the only places code is verified. |
| One-off scripts | `apps/api/src/db/*.ts` (about 200 env-gated boot tasks: audits, fixes, backfills, sends) | This is how past sessions ran read-only DB checks and one-off sends. Examples: `customerAudit.ts`, `feedbackAudit.ts`, `winbackRollout.ts`, `sendCorpPreviews.ts`, `receiptOcr.ts`. |
| Support DB windows | `routes/opsReadOnly.ts` (one read-only SQL statement, key-guarded), `routes/opsWrite.ts` (full write access with dry run, row copies and an audit trail; owner-approved 17 Nov 2026) | Lets an assistant inspect or fix data without a redeploy. This is high-risk and needs to be fenced in any agent design. |
| Read-only marketing report | `GET /api/marketing/report` (`routes/marketingReport.ts`, key in the `x-report-key` header) | Aggregates only, no personal data: bookings and revenue by month, day, celebration and theme; line-item names; refunds by month; WhatsApp leads by month, day and **source ad id**. This is what `eventana-ads` already reads. |

Other API route files:
- `routes/public.ts`: customer routes (catalogue, quote, checkout, `/api/track`, `/api/lead`, feedback, register/login).
- `routes/events.ts`: "My Event" routes.
- `routes/webhooks.ts`: provider webhooks plus a payment simulator.
- `routes/igComment.ts`: Instagram comment offer.
- `routes/voiceRec.ts`: voice-over uploads to Cloudinary.
- `routes/staffAuth.ts`: staff login.

---

## 2. Integrations and automations that already exist

### 2.1 External integrations (`apps/api/src/integrations/`, `payments/`, `domain/`)

| Integration | File | What it does | Gate / status |
|---|---|---|---|
| Resend email | `integrations/email.ts` | Sends every email. Supports CC/BCC and a global monitor BCC (`EMAIL_MONITOR_BCC`). | No-op without `RESEND_API_KEY` |
| WhatsApp Cloud API | `integrations/whatsapp.ts` | Inbound and outbound on the business number. Template sends for customers, drivers and staff. | `WHATSAPP_CUSTOMER_NOTIFY`, `WHATSAPP_DRIVER_NOTIFY`, `WHATSAPP_STAFF_NOTIFY` (all ON per IMPLEMENTATION_STATUS, 2026-09-08). Auto-reply agent `WHATSAPP_AGENT_MODE` defaults to `off` (`config.ts:352`). |
| Meta Conversions API | `integrations/metaCapi.ts`, `domain/attribution.ts` | Sends Purchase (on a provider-confirmed payment) and CompleteRegistration to Meta, server-side | Needs `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`. MASTER_REQUIREMENTS R-041 says it is blocked on 3 Render env vars (as of September). |
| Meta Marketing API (read) | `integrations/metaAds.ts` | Reads spend and messaging conversations per ad and campaign | Needs `META_ADS_READ_TOKEN` and `META_AD_ACCOUNT_ID` |
| Payments | `apps/api/src/payments/*` | Stripe (cards, Apple Pay, Google Pay), Tabby, Tamara, Ziina, plus a simulated provider | `EVENTANA_PAYMENT_MODE`. Commit 2026-11-19: discount codes only apply with full payment, not with Tabby or Tamara. |
| QuickBooks Online | `domain/quickbooks.ts`, `domain/importData.ts`, `importTicket.ts` | OAuth with token refresh; a one-time history migration into `historical_*` and `finance_receipts` | R-111 says the move to QuickBooks production is still pending (Intuit questionnaire and production keys). R-116 says the QuickBooks secret must be rotated. |
| Zoho Books (bank feed) | `domain/syncZohoBank.ts` | Puts RAKBANK and Wio debits into the Bank Inbox as PENDING rows | `ZOHO_*` env vars |
| Wafeq (Wio feed) | `domain/wafeqPoll.ts` | Puts Wio ledger transactions into the approval queue | Configured via Wafeq |
| Bank mailbox (IMAP) | `domain/bankImapPoll.ts` → `domain/bankInbox.ts` | Reads RAKBANK alert emails at bank@eventanauae.com, creates PENDING `bank_transactions`, and notifies the owner and Marsha | Hand-rolled IMAP client |
| Stripe fees | `domain/syncStripeFees.ts` | Monthly Stripe fee becomes a pending bank row for approval | Every 12 hours |
| Google Calendar | `integrations/googleCalendar.ts` | Copies each confirmed booking to a shared team calendar | Service account. R-114 says the owner still has to share the calendar. |
| Google Business Profile | `domain/googleReviews.ts`, `views/GoogleReviews.tsx` | 4–5★ reviews get an auto-reply in the review's language (Claude). 1–3★ reviews get a draft and the owner is emailed to approve it. | `GOOGLE_REVIEWS=poll` plus OAuth. Built but OFF (R-040 and R-112 need Google OAuth/API access). |
| Google Places | `domain/corporateOutreach.ts` | Collects B2B leads (see 2.3) | `CORP_COLLECT=on` plus a Google key |
| Google Maps | key `GOOGLE_MAPS_API_KEY` (map pin only) | Customer map pin and delivery zone | R-070 blocked by a key restriction. No server-side distance or ETA (G-011, R-080). |
| Anthropic (Claude) | `integrations/anthropic.ts` (REST, no SDK) | Used by AI Studio, review replies, and the daily-audit AI summary | No-op without `ANTHROPIC_API_KEY` |
| Cloudinary | `integrations/cloudinary.ts` | Signed direct uploads: event photos, story images, voice takes | `CLOUDINARY_*` |
| Push | `integrations/push.ts` (FCM), `integrations/webpush.ts` (VAPID web push to staff PWA) | Phone notifications to staff and owner; customer app push | Keys required |
| Apple Wallet | `integrations/wallet.ts` | .pkpass ticket | Turned off (R-110: enable or remove is an owner decision) |
| ManyChat (Instagram) | `routes/igComment.ts` | Someone comments «حفلة» on a reel; ManyChat calls this route; the route issues a personal code (AED 300 off + free delivery, minimum AED 3,000) that ManyChat sends by DM | Added 2026-11-17 |

### 2.2 Customer emails, WhatsApp and push: what is sent and to whom

Transactional lifecycle (`domain/lifecycle.ts`, delivered by `domain/notify.ts` `deliverPendingNotifications`). Each goes to the **customer** by email and by an approved WhatsApp template:
- `booking_confirmation`: sent immediately.
- `three_day_reminder`: 3 days before the event.
- `event_day`: 4 hours before the event.
- `feedback_request`: 1 day after the event. Only sent 10:00–20:00 Dubai (G-001 fix).
- Phase-driven: `team_on_the_way`, `setup_ready` (this is the "Party Started" phase), `team_arrived` (G-002: no button triggers it, so it never fires), `booking_updated`, `event_cancelled`, `cancellation_refund`, `refund_processed`, `refund_apology`.
- Driver templates (to drivers): `driver_new_order`, `driver_order_updated`, `driver_order_cancelled`.
- Staff templates: `staff_alert`, `staff_notify`, `staff_birthday_wish`, `staff_dayoff_wish` (template names come from `db/seedWhatsAppTemplates.ts`, `db/whatsappGoLive.ts` and IMPLEMENTATION_STATUS). IMPLEMENTATION_STATUS says 27 templates were approved by Meta on 2026-09-08.
- Other customer emails rendered in `notify.ts`:
  - shop order emails (`renderShopEmail`)
  - add-on emails (`renderAddonEmail`)
  - finance documents (receipts and invoices, `renderFinanceDocEmail`, `finance.ts emailDoc`)
  - daily invoice balance reminders (`sendInvoiceBalanceReminders`, opt-in per invoice)
  - the "code fixed" one-off (`db/resendCodeFixed.ts`)

Follow-up and marketing automations (all in the reconcile loop, `domain/reconcile.ts:240-440`):

| Automation | File | Recipient | Gate |
|---|---|---|---|
| Abandoned cart: "your celebration is waiting" email + push. One per customer, every 3 days, up to 5 nudges, carts 3h–45d old. Test/staff accounts and pay-links are excluded. | `domain/abandonedCart.ts` | Registered or checkout customers with an email who started an order but never paid | `CART_REMINDERS=list\|send` |
| Feedback reminders: every 3 days for 2 weeks, stop on rating | `domain/feedbackReminders.ts` | Customers whose event finished | `FEEDBACK_REMINDERS=send` |
| Win-back: AED 600 off the next booking over AED 3,000. Single-use, 3 months. Sent about 3 days after the event, as a one-off campaign to past customers, and as reminders every ~2 weeks. Email + WhatsApp. | `domain/winback.ts`, `marketing.ts` (`sweepPostEventWinback`, `sweepWinbackCampaignAuto`, `sweepWinbackReminders`), rollout scripts `db/winback*.ts` | Past customers | `WINBACK_POSTEVENT`, `WINBACK_AUTO`, `WINBACK_REMINDERS` = `send` |
| Voucher reminder: unused 20%-off reward, about every 6 months | `marketing.ts sweepVoucherReminders` | Customers holding a reward | Always on |
| Customer birthday greeting | `marketing.ts sweepCustomerBirthdays` | Customers with a stored birthday (dormant until birthdays are collected) | Always on |
| Email campaigns with an approval queue. Audiences: `all`, `past_customers`, `no_recent_booking` (no paid order in 90 days), `anniversary` (event 11–12 months ago). Sent only 16:00–22:30 Dubai, with unsubscribe tokens. | `domain/marketing.ts`, `views/Marketing.tsx` | Opted-in customers | Owner/manager approves each campaign |
| Marketing calendar: auto-drafts a campaign a few weeks before each UAE/international occasion and alerts the owner and Marsha. Never auto-sends. | `domain/marketingCalendar.ts` (1,125 lines) | Owner and Marsha review | Always on (drafts only) |
| Website lead alert: a lead submitted on the site goes to the owner's and managers' WhatsApp with a one-tap chat link (commit 2026-11-13) and is offered `WELCOME10` | `whatsappLeads.ts captureWebsiteLead`, `screens/LeadForm.tsx` | Owner and managers | — |
| Story reminder: "today's story is ready", sent at 10:00 | `domain/storyReminder.ts` | Owner and Marsha (bell + push) | — |
| Welcome pop-up `WELCOME10` (10% off the first booking, min AED 2,000, online only) | `screens/Home.tsx`, `discounts.ts` | Site visitors | — |

### 2.3 Lead generation and corporate (B2B)
- **WhatsApp leads** (`domain/whatsappLeads.ts`, table `whatsapp_leads`, views `Leads.tsx` and `LeadThread.tsx`):
  - One row per phone number, with status `new → quoted → confirmed → booked | lost`.
  - The party date and emirate are parsed from Arabic or English messages.
  - Stores `ctwa_clid`, `source_ad_id` and `source_headline` (the Meta click-to-WhatsApp ad).
  - `order_id` is filled when that phone number pays (`linkOrderToLead`).
  - `leadFunnel()` gives leads → quoted → confirmed → booked, by emirate.
  - `importLeads` backfilled years of labels from the WhatsApp Business app.
  - The team replies from the dashboard, because a Cloud API number can't be opened in the phone app.
- **WhatsApp agent** (`domain/whatsappAgent.ts`): greets, answers catalogue questions with the rule-based assistant, and asks for the date. It never quotes made-up prices, agrees discounts or accepts bookings. Off by default.
- **Website lead form** (`screens/LeadForm.tsx` → `POST /api/lead` → the same `whatsapp_leads` table). This closes G-006 / R-073 in code, although the docs still list them as open.
- **Corporate outreach** (`domain/corporateOutreach.ts`, table `corporate_leads`, UI inside `views/Marketing.tsx`, admin routes `routes/admin.ts:7058-7188`):
  - Weekly Google Places collection per category (school, nursery, university, hospital, clinic, bank, government, company, new_shop) for 7 emirates.
  - Pulls the published email from each business's website.
  - Auto first-touch email per category (`buildFirstTouchBody`, paced, inside a send window).
  - One follow-up after 14 days with no reply.
  - Reply processing (`processCorporateReply`) and a suggested reply.
  - Status `new|contacted|interested|booked|not_interested`.
  - Gated by `CORP_COLLECT`.
  - Collateral: `design/Eventana-Corporate-Profile.pdf`, `design/corporate-profile.md`, `design/eventana-corporate-profile.html`, `apps/customer/public/company-profile.html`.
  - Landing page slug `corporate-events` in `apps/customer/src/seo.json`.
- **SEO landing pages**: 20 slugs in `apps/customer/src/seo.json`, prerendered by `apps/customer/scripts/prerender.mjs`, routed by `src/landing.ts`. They cover kids-birthday, balloon-decoration, baby-shower, graduation, bride-to-be, corporate-events, rentals, adult-birthday, party-organizer for 5 emirates and 5 Dubai areas, kids-party-cost-dubai, compare-packages and party-themes-dubai. There are also festival pages `public/hatta-festival.html` and `public/hatta.html`.

### 2.4 Promotions, discounts, referrals, loyalty
- **Promo codes**: `domain/discounts.ts`, tables `promo_codes` and `promo_redemptions`, UI `views/Discounts.tsx`. A promo-code bug that rejected valid codes and charged full price silently was fixed on 2026-11-17. Abandoned checkouts release their code reservation (`reconcile.ts`).
- **Loyalty**: 100 points = AED 2 (about 2% back), tables `loyalty_transactions` and `customers.loyalty_points/tier`.
- **Customer referral**: AED 250 credit to both sides on the first confirmed booking (`discounts.ts`, `customers.referral_*`).
- **Staff referral codes**: `<NAME>SALE` codes credit the staff member 5% of event value (`domain/staffReferral.ts`, `staff_referral_*`).
- **Instagram comment code**: AED 300 off + free delivery (`routes/igComment.ts`).
- **Standing offers** named in the `eventana-ads` skill: Bow theme 20% off.
- **Manual offers / pay-links**: the team builds an order and the customer pays through a unique link (`domain/offers.ts`, `views/NewOrder.tsx`, `screens/PayLink.tsx`).

### 2.5 Operations engines
- **Inventory holds**: `domain/inventory.ts`. Each asset is reserved for its full operational window, with row locks so nothing is double-booked. Holds last 15 minutes. UI `views/Inventory.tsx`.
- **Prep engine**: `domain/prep.ts` (1,171 lines).
  - On confirmation it generates per-order prep tasks.
  - It fair-assigns them by skill, workload and day off.
  - Design tasks (Marsha) gate the physical tasks.
  - `sweepPrepAtRisk` flags events within 3 days whose prep is unfinished.
  - UI `views/Tasks.tsx`.
- **Staffing engine**: `domain/staffing.ts` (1,022 lines). It turns package and services into role requirements, then does auto/manual assignment, leader choice and part-timer slots. UI `views/Events.tsx` and `Team.tsx`.
- **Shopping / missing items**: `domain/shoppingReminder.ts` handles the Wednesday shopping run, the driver's list and day-off messages. `DriverEvents.tsx` has a shopping tab. Table `missing_items`.
- **HR**:
  - leave: `domain/leave.ts`, `dayOff.ts`, `views/Leave.tsx`
  - staff birthdays: `staffBirthdays.ts`
  - incentives and rewards: `incentives.ts`, `views/Performance.tsx`
  - part-timer and driver pay: `staffPayReport.ts`, `views/StaffPay.tsx`, emailed on the 1st
  - weekly rhythm: `views/TheWeek.tsx`
- **Customer self-service**: reschedule (`reschedule.ts`), refund on self-cancel (`refund.ts`), feedback with tips (`event_ratings`, `tips`).

### 2.6 Finance automations and reports

| Item | File | Recipient / cadence |
|---|---|---|
| Sale posted from each paid order to `finance_receipts`, with auto-heal for missing sales | `finance.ts recordSaleFromOrder`, `backfillMissingSales` | Each loop |
| Finance module: customers, items, invoices, receipts, accounting summary | `domain/finance.ts`, `views/FinanceHub.tsx` (Sales / Expenses / Accounting tabs) | — |
| Bank Inbox approval queue (bank → expense; only the owner can Ignore) | `bankInbox.ts`, `views/BankInbox.tsx` | Owner and Marsha |
| Recurring expenses (van loan AED 3,889 on the 24th) | `recurringExpenses.ts` | Monthly |
| Monthly reconciliation email: cash, A/R, unpaid orders, payment-method coverage, phone health, duplicates | `reconReport.ts sweepReconReport` | Owner (sheem@eventanauae.com) and Marsha, monthly |
| Weekly report (same snapshot) | `reconReport.ts sweepWeeklyReport` | Owner, Mondays 08:00–09:59 |
| **Daily System Audit**: about 45 read-only checks across money, bookings, events, inventory, staff, notifications, expenses, bank and system, with an optional Claude summary, stored in `daily_audit_runs` | `domain/dailyAudit.ts` | Owner email + push, 10:00 Dubai daily |
| Owner reconciliation diagnostics, refund reasons, audit log, clean-up tools | `domain/audit.ts`, `views/Reports.tsx` (now in the nav: `apps/dashboard/src/App.tsx:88`, "Reports & Audit") | Owner only. G-015 said it was unreachable; **stale**, it is now wired. |
| Monthly finance report (retired, replaced by the recon report) | `financeReport.ts` | — |
| CEO dashboard: KPIs, P&L, cash, pipeline, WhatsApp funnel, website funnel (visitors → registered → booked), top emirates, packages and themes | `views/Ceo.tsx`, `GET /api/admin/ceo` (`admin.ts:4205`) | Owner |
| KPIs | `views/Kpis.tsx` | Owner and manager |
| Theme backfill sheet | `views/ThemeBackfill.tsx` | Team |

### 2.7 AI and assistants already in the product
- **AI Studio** (`domain/aiStudio.ts`, `views/AiStudio.tsx`, routes `/api/admin/ai/*`). Claude drafts and a human approves:
  1. Sales Agent: a WhatsApp reply or follow-up draft for quiet leads, with a quote built from the live catalogue (`salesDraft`, `salesFollowups`).
  2. Event Designer: a theme concept priced from the live catalogue (`designParty`). It is also customer-facing in `screens/Designer.tsx`.
  3. Marketing: reel and ad ideas per occasion (`marketingIdeas`, `upcomingOccasions`), ad results lead → paid order (`adResults`), and an AI verdict (`adVerdict`).
- **Customer assistant** (`domain/assistant.ts`, `screens/Assistant.tsx`): rule-based over the live catalogue, with no LLM. It escalates refunds, complaints and discounts to a human.
- **Google review replies** (Claude) and the **daily-audit AI summary** (Claude).
- **Story Studio** (`views/StoryStudio.tsx`, table `marketing_stories`): a library of story images and captions (EN/AR) with a schedule. The owner posts by hand (download and copy). Auto-posting to Instagram waits on IG Graph API access (R-022).
- **Voice recording page** (`apps/customer/public/rec.html` + `routes/voiceRec.ts` → Cloudinary, table `ad_voice_takes`). The owner records ad voice-overs here. Commits from 2026-11-15 to 11-17 hold dozens of Gulf-Arabic ad scripts: theme series, pillar scripts, the owner's o1–o9 series, mermaid, g20 and others.

---

## 3. Data that exists and could feed agents

| Domain | Tables (schema.sql) | What it answers | Caveats |
|---|---|---|---|
| Bookings / orders | `orders` (status, kind booking/shop, cart JSON, `attribution` JSONB with fbc/fbp/utm/gclid), `payments`, `payment_events`, `events`, `event_services`, `event_team`, `event_staff`, `cancellations`, `refunds`, `tips`, `event_ratings`, `event_photos` | Who booked what, when, where, for how much, and how it went (rating and comment) | Two event reference formats (R-092). The 2026-09-09 customer audit counted 88 live orders. |
| **People who did not book** | `orders` with status not paid (abandoned carts; `abandonedCart.ts findAbandonedCarts`); `whatsapp_leads` with status `new/quoted/confirmed/lost`; website form leads (same table); `site_visits` (hashed visitor per day, counts only) | **Yes, this data exists.** Abandoned checkouts include name, email, amount, occasion and age. WhatsApp and website leads include phone, name, date, emirate, status and source ad. | Owner decision D-5 says unpaid orders should be cleaned, which could delete abandoned-cart history. Customer site visits are anonymous counts with no per-visitor funnel. There is no unified cart (G-007). |
| Customers | `customers` (name, phone, backup phone, email, `email_opt_out`, DOB/birthday, loyalty, referral, `origin`), `historical_customers` (QuickBooks), `historical_orders`, `loyalty_transactions`, `promo_redemptions` | Lifetime value, repeat behaviour, win-back targeting, birthdays | Two customer tables are not unified (R-090). Old receipts are linked by name (R-001, R-004). 5 duplicate phone groups and 21 test accounts (September audit). Of 545 customers, 497 come from QuickBooks. |
| Corporate | `corporate_leads` | B2B pipeline status by category and emirate | Depends on `CORP_COLLECT` being on |
| Marketing | `email_campaigns`, `email_send_log`, `email_suppression`, `occasion_settings`, `marketing_stories`, `ad_voice_takes`, `promo_codes`, `whatsapp_messages`, `messages` | Campaign history, deliverability, story queue, recorded voice takes | — |
| Finance | `finance_receipts` (line_items, booked_on, source, paid_with), `finance_invoices`, `invoice_payments`, `finance_items`, `expenses`, `expense_years`, `bank_transactions`, `receipt_ocr`, `receipt_addon_money`, `historical_financials`, `finance_reports`, `recon_reports`, `daily_audit_runs`, `quickbooks_connection` | Revenue, expenses, P&L, cash, A/R, refunds, vendor spend | QuickBooks receipts default to "cash" (R-007). Per-event cost and ad spend are not captured, so per-package margin and ROAS are hidden on the CEO dashboard (G-018). |
| Inventory | `inventory_assets`, `inventory_holds`, `asset_issues`, `consumables`, `consumable_usage`, `missing_items`, `package_items`, `packages`, `services`, `service_categories`, `themes`, `theme_inspiration`, `package_inspiration`, `sale_themes`, `delivery_zones` | Availability, utilisation, what sells, theme popularity | — |
| Suppliers | `suppliers`, `supplier_items`; spreadsheets `Eventana-Suppliers-*.xlsx`, `suppliers-review.html` | Where each item is bought | Near-duplicate vendor names (R-002) |
| Staff | `team_members`, `staff_skills`, `staff_days_off`, `leave_requests`, `day_off_change_requests`, `part_timers`, `drivers`, `deliveries`, `staff_payments`, `staff_pay_reports`, `staff_rewards`, `staff_feedback`, `staff_warnings`, `staff_referral_*`, `prep_tasks`, `prep_task_staff`, `prep_task_log`, `event_tasks`, `focus_tasks` | Workload, performance, pay, availability | Two overlapping leave systems (G-017; D-1 says merge them) |
| Notifications / ops | `notifications` (queue with channel, template, scheduled_for, sent_at), `push_subscriptions`, `device_tokens`, `audit_log`, `webhook_deliveries`, `ops_sql_audit`, `app_kv`, `settings` | What was sent to whom and when; every edit made through opsWrite | — |
| Reviews | `google_reviews`, `google_oauth_connection` | Review text, star rating, reply status | Empty until GBP is connected |
| External marketing data (outside the repo) | Supermetrics `FA` account `act_638060898452533` (full Meta history), Windsor (`facebook` write actions, 30-day trial window), vidIQ (connected to eventana.uae), Instagram account `eventana.uae` id 17841403036617481 (from the `kafu-wa-nus` skill) | Ad spend, retention curves, chats, IG insights | Per-ad bookings are not tracked except through `whatsapp_leads.source_ad_id` |
| Business reference files | `eventana-themes-2026.csv`, `design/*` (Main/Details/Story `.dc.html`, corporate profile), `docs/claude-history/*.md` (10 past session transcripts), `APP-STORE-READINESS.md`, `MOBILE.md` | Brand style, themes, history of decisions | — |

---

## 4. Existing skills

### 4.1 `eventana-ads` (`/home/user/eventana/.claude/skills/eventana-ads/SKILL.md`, 75 lines; no other files)
- **Covers**: Meta/Instagram performance ads manager. The owner delegated ad decisions to it on 17 Nov 2026. It does full-history audits, retention-curve diagnosis, keep/improve/pause decisions, and the content method for ads, reels and stories.
- **Data**:
  - Supermetrics `FA` `act_638060898452533` (history and retention curve)
  - `/api/marketing/report` (bookings)
  - Windsor `execute_action` on `facebook` (writes)
- **Rules**:
  - Instagram placements only. One campaign (`120254723629840422`) and one ad set (`120254723630330422`), CBO about 60–64 AED a day.
  - **Hard cap of 2,000 AED a month across all Meta campaigns.**
  - Professional naming pattern.
  - Gulf Arabic addressed to mums, with hooks built on their pain.
  - No cakes. Never stand counts.
  - Real prices only. Bow 20% off. No Al Gharbia ("all Emirates" is forbidden).
  - The clown never talks.
  - Tell the owner before raising budget. Pausing a losing ad is the skill's own call.
  - Targets: ≤ 10 AED per chat, ≤ 100 AED per booking.
  - Content research comes first (vidIQ outliers); every ad tests a different strategy; per-ad WhatsApp keyword for tracking.
  - Includes a baseline table of 14 ads.
- **Gaps / issues**:
  - It references `eventana-ads/reels/*` (an HTML+JS frame renderer). **Not found** in the repo.
  - Per-ad booking tracking is incomplete. `whatsapp_leads.source_ad_id` exists but the skill says per-ad bookings are "NOT tracked yet".
  - Nothing on organic posting schedule, Story Studio, or the IG comment/ManyChat offer.
  - No Google Ads (click IDs are captured but never reported, G-012).

### 4.2 `eventana-qa` (`/home/user/eventana/.claude/skills/eventana-qa/SKILL.md`, 132 lines)
- **Covers**: QA, testing, bug hunting and safe repair for the customer site, the Ops dashboard and the API. Six workflows: full audit, customer site test, Ops role and permission test, cross-app booking-to-Ops check, regression/bug repair, QA report (verified / untested / assumption).
- **Rules**:
  - Never complete a real payment or use a live customer account.
  - Prod DB is read-only unless a specific write is approved.
  - No secrets in reports.
  - Never bypass permission checks.
  - No auto-deploy; prefer a branch + PR for payments, auth, finance and migrations.
  - Never claim a fix without observing it.
  - Synthetic test data only.
  - Business rules must be read from code, never invented.
- **Gaps / issues**:
  - It says catalogue sync comes from `apps/api/src/domain/catalogue.ts`. **That file is not found** in `domain/`; the catalogue is in `packages/shared/src/catalogue.ts` plus `db/syncCatalogue.ts`.
  - It does not mention the Daily System Audit (`dailyAudit.ts`), which is already the system's automated quality check.
  - It does not mention the `opsReadOnly` / `opsWrite` DB windows, and so has no rule fencing them.
  - No customer-experience quality checks (event ratings, refunds by reason, R-005).

### 4.3 `kafu` (`/root/.claude/skills/synced/<id>/kafu/SKILL.md`, 275 lines)
- Files next to it:
  - `engine/`: `hero.html`, `engine.js`, `base.css`, `characters.js`, `hero_build.py`, `hero_voice.py`, `myvoice.py`, `voice.py`, `render.py`, `final.py`, `sheet.py`, `castpdf.py`
  - `rnn/sh.rnnn` (denoise model)
  - `reel/CODE_REEL.md`, `reel/scripts/1_clean_audio.sh`, `reel/scripts/make_test_audio.py`
- **Covers**: a brand-agnostic creative director and producer.
  - Ad and reel concepts.
  - Hooks, captions, characters.
  - A voice-studio cleaning chain (ffmpeg + noisereduce).
  - AI video pipeline on Artlist: key image → image-to-video → lipsync → HTML motion layer → assembly. About 4,000 credits per hero ad.
  - A library of 20 editing styles; it must rotate to a new main style each video.
  - A Remotion code-reel pipeline.
  - Review → upgrade of existing ads with per-second scoring.
- **Rules**:
  - Wake word «كفو» → «نعم، أمري 🫡».
  - Gulf Arabic only. Deliver finished files, not drafts.
  - Give the cost before big spends.
  - Never alter the owner's voice except to clean it. Captions are her exact spoken words.
  - AI characters must be adults.
  - She hates still photos of characters, cartoon humans, and robotic TTS.
  - Keep `approved.md` per project.
- **Gaps for Eventana**:
  - It is not Eventana-specific and contains no Eventana brand rules. Those live in `eventana-ads`: no cakes, no stand counts, the clown never talks, real prices.
  - Its paths point to a Windows machine (`C:/Users/97156/...`).
  - Its love of AI characters partly conflicts with Eventana ads, which use real party footage and the owner's recorded voice (`rec.html`, ads skill).

### 4.4 `kafu-wa-nus` (`/root/.claude/skills/synced/<id>/kafu-wa-nus/SKILL.md`, 105 lines)
- Files next to it:
  - `references/`: `scores.md`, `autopilot.md`, `scripts.md`, `viral-score.md`, `meta.md`, `learnings.md`, `skills-to-learn.md`, `profile.md`, `plan.md`, `seo.md`, `analysis.md`
  - `scripts/viral_score.py`
- **Covers**: growth and performance manager for **مذاكرتي (mthakarti.com), not Eventana**. It handles the daily posting of 2 reels, Windsor IG publishing and insights, the Supabase funnel, UTM rules, a viral score of at least 70, analyse-before-make, append-only learnings, SEO, a weekly Meta review with kill/keep/scale thresholds, and autopilot.
- **Rules**:
  - Publish only to @mthakarti (17841464872577341). **It explicitly forbids passing the eventana.uae id.**
  - 500 AED a month Meta cap.
  - Gulf Arabic.
  - Never touch kafu's files.
- **Reuse for Eventana**: the operating model, not the content. That means the daily/weekly routine, analysis-first, the learnings log, UTM discipline, viral score, and the brief-to-kafu handoff.

### 4.5 Overlaps and conflicts between skills
- **Ads ownership.** `eventana-ads` (Eventana, 2,000 AED cap, Supermetrics + Windsor) and `kafu-wa-nus` (mthakarti, 500 AED cap, Windsor) both run Meta reviews with different thresholds. They are safe only because their accounts are separated. An Eventana growth agent must take its rules from `eventana-ads`, not `kafu-wa-nus`.
- **Creative.** `eventana-ads` has its own content method (research first, a different strategy per ad, soft music, the owner's voice). `kafu` has the production pipeline. Neither says which one wins for Eventana. Wording rules exist only in `eventana-ads`.
- **Shared Windsor login.** `kafu-wa-nus` warns that the same Windsor login holds both IG accounts. Any Eventana publishing agent needs the mirror rule: confirm the account is `eventana.uae`.
- **vidIQ** is connected to eventana only (per `kafu-wa-nus`). That fits the `eventana-ads` research step.
- **QA vs Daily Audit.** `eventana-qa` (human-triggered) and `dailyAudit.ts` (automated) overlap on data integrity, and neither refers to the other.
- **AI Studio vs skills.** AI Studio's marketing ideas and `adVerdict` in the dashboard overlap with `eventana-ads`. Its Sales Agent overlaps with any future "customer follow-up" agent.

---

## 5. Open gaps relevant to the planned functions

Sources: `BUGS_AND_GAPS.md` (G-), `MASTER_REQUIREMENTS.md` (R-, D-, NC-), `IMPLEMENTATION_STATUS.md`. **Stale** marks items where newer code suggests the gap is closed; these need re-verification.

**Website development**
- G-004 / R-058: catalogue not translated to Arabic.
- R-050: product descriptions (ar/en).
- R-059: missing photos.
- G-005 / R-057: kiosks, perfumes and lipstick not built.
- G-007 / R-074: no unified cart. R-075 (abandoned cart on that cart) depends on it.
- R-076: 3-step birthday booking, not started.
- G-008: mascot and doll lists hardcoded.
- R-070: map blank on laptop (Maps key).
- L-2: the `.onrender.com` URL is CORS-blocked.
- L-4: US date format; greeting timezone.
- R-091: email verification. R-095: unique email. R-096: password reset must invalidate sessions.
- R-056: Glam Dolls. IMPLEMENTATION_STATUS says the code is there and needs live verification; MASTER_REQUIREMENTS says not started.
- G-009: push register has no web caller.
- R-012: Tabby store page.

**Lead gen and corporate**
- G-006 / R-073: no lead form. **Stale**: `LeadForm.tsx` + `/api/lead` + a WhatsApp alert to managers exist (2026-11-13). Needs a live check.
- R-020: auto customer-reply bot not started. `whatsappAgent.ts` exists, but `WHATSAPP_AGENT_MODE` defaults to off.
- Corporate outreach depends on `CORP_COLLECT=on` and the Google Places key. Whether it is on in production is unknown.
- Not found: corporate contract or proposal templates, a quote/estimate generator for B2B, corporate pricing tiers, or a B2B CRM pipeline beyond `corporate_leads.status`.
- G-012: Google Ads click IDs are captured but never reported.

**Customer email / follow-up**
- R-075: abandoned-cart reminder for a real cart depends on R-074. The unpaid-order reminder exists (`CART_REMINDERS`).
- D-5: owner wants unpaid orders cleaned. This conflicts with keeping abandoned-cart and lead history for follow-up.
- R-026 / G-003: birthday capture. Onboarding no longer asks (fixed 09-09), so `sweepCustomerBirthdays` stays mostly dormant.
- G-002: `team_arrived` template is orphaned.
- R-021: system-designed concept emailed to the customer, not started. The Event Designer exists but does not email.
- NC-5: which owner inbox to use for team mail.
- Missing: no lead nurture sequence for WhatsApp or website leads who did not book (beyond AI Studio drafts a human must send), no post-quote follow-up automation, and no segmentation by occasion or emirate beyond the four audiences.

**Finance analysis**
- R-001, R-002, R-004: customers and suppliers vs QuickBooks; receipts linked by name.
- R-003 / D-4 / NC-2: duplicate merge.
- R-005: refund review by reason.
- R-006 / NC-3: unpaid orders.
- R-007: QuickBooks "cash" default.
- R-090: unify customer tables.
- G-018 / R-072: per-event cost and ad spend not captured, so there is no margin or ROAS. CEO dashboard redesign pending.
- R-078, R-079: fuel and consumables budgets.
- R-013: bank integration. Now **largely built** via IMAP, Zoho, Wafeq and Stripe fees; the docs are stale.
- R-014, R-015: Salik and traffic fines.
- R-016: auto salary.
- R-102: payout over WhatsApp with PDF.
- R-111, R-116: QuickBooks production and secret rotation.
- G-015: `Reports.tsx` reconciliation UI was unreachable. **Stale**: it is now in the nav (`App.tsx:88`). The weekly email from D-2 is also built.

**Systems integration**
- R-041: Meta CAPI env vars.
- R-040 / R-112: Google OAuth for reviews.
- R-022: IG auto-story needs the Graph API. R-023: WhatsApp story not possible.
- R-114: Calendar share.
- R-113: iOS push.
- R-110: Apple Wallet decision.
- G-011 / R-080: no Maps distance or auto-ETA.
- G-016: driver schedule hardcoded.
- G-017 / D-1: two leave systems.
- G-014: duplicate WhatsApp template-status tools.
- G-013: dead automations.
- README: the webhook queue is in-process (`setImmediate`), not durable.
- `opsWrite` (full DB write window) is an integration risk that needs a policy.
- R-025: missing-item auto-order.
- R-117: brand name decision ("Eventana Events" vs "Eventana UAE").

**Quality**
- IMPLEMENTATION_STATUS dashboard, backend and integration audits are marked "⏳ audit in progress" and were never completed.
- L-3: dashboard internals were never tested live because there was no test login (agents may not enter passwords).
- Link-destination testing, per-role live testing, payment live test and the security deep pass are all pending.
- R-008: delete test accounts.
- R-093: alert disappears after done (needs verification).
- Many items are "Implemented, Needs Verification" (R-030 to R-036, R-054, R-055, R-097, R-100, R-103).
- R-051, R-052, R-053: employee handbook, dashboard user manual and training are all missing. `db/sendUserManual.ts` suggests a manual was emailed once; content not checked.
- Customer-quality data exists (`event_ratings`, `Feedback.tsx`, refunds) but there is no regular quality review.

---

## 6. Per function: what we can reuse vs what is missing

### 6.1 Meta ads
- **Reuse**:
  - the `eventana-ads` skill (rules, cap, baseline, diagnosis method)
  - Supermetrics `FA` history and Windsor `facebook` write actions
  - `/api/marketing/report` (bookings, leads by `source_ad_id`)
  - `whatsapp_leads` (`ctwa_clid`, `source_ad_id`, `order_id`)
  - `integrations/metaAds.ts` (spend read), `metaCapi.ts` + `attribution.ts` (Purchase and Registration)
  - AI Studio `adResults` / `adVerdict`
  - `igComment.ts` offer
  - landing pages for traffic ads
- **Missing**:
  - reliable per-ad booking attribution (a per-ad WhatsApp keyword is planned, not done)
  - CAPI live status unknown (R-041)
  - ad spend not stored in the DB, so no ROAS on the CEO dashboard (G-018)
  - the `eventana-ads/reels/*` renderer the skill references (not found)
  - Google Ads reporting (G-012)
  - TikTok and Snapchat ads (not found)

### 6.2 Content writing (captions, scripts, emails, site copy)
- **Reuse**:
  - `rec.html` script library (dozens of approved Gulf-Arabic scripts in the 2026-11-15 to 11-17 commits)
  - `eventana-ads` wording rules
  - `kafu` copy method (brief → concepts → hook)
  - `marketingCalendar.ts` (occasion drafts in Arabic and English)
  - `email_campaigns` approval flow
  - `corporateOutreach.ts buildFirstTouchBody` per category
  - `seo.json` landing copy
  - `design/corporate-profile.md` (brand style)
  - AI Studio `marketingIdeas`
  - Story Studio captions (EN/AR)
  - the Anthropic `ig-caption` / `ig-reel` / `ig-plan` skills available in this environment
- **Missing**:
  - an Eventana brand/voice bible as one file. Rules are scattered across `eventana-ads`, `kafu` and the design docs.
  - Arabic product descriptions (R-050, R-058)
  - blog or SEO article content (not found)
  - a log of which captions performed

### 6.3 Production (reels + stories)
- **Reuse**:
  - `kafu` production pipeline (voice cleaning, Artlist AI video, motion layer, Remotion code reels, 20 editing styles, QA contact sheet)
  - `rec.html` + `voiceRec.ts` + `ad_voice_takes` (the owner's recorded voice on Cloudinary)
  - Story Studio + `marketing_stories` + `storyReminder.ts` (daily story queue)
  - `event_photos` / `event_setup_photos` (real party footage and photos)
  - `kafu-wa-nus` viral-score script and routine as a model
  - available skills: hyperframes, media-use, remotion, Canva / Artlist MCPs
- **Missing**:
  - Eventana-specific production rules merged with kafu (no talking clown, real footage preferred, soft music only, no cakes or stand counts)
  - Instagram auto-publish for eventana.uae (R-022 blocked; Windsor publishing is set up only for mthakarti)
  - an organic posting plan or schedule for Eventana (not found)
  - a shared asset library index of approved footage (not found)

### 6.4 Website development
- **Reuse**:
  - `apps/customer` (SPA, `seo.json` + prerender, `Landing.tsx`, `LeadForm.tsx`, `Designer.tsx`, `Checkout.tsx`)
  - `eventana-qa` (CI, Playwright e2e in `tests/e2e`, safety rules)
  - `render.yaml` auto-deploy
  - design references `design/*.dc.html`
  - available skills: impeccable, ui-ux-pro-max, mobile-native
- **Missing**:
  - G-004/R-058 Arabic catalogue, R-059 photos, R-074 cart, R-076 3-step booking, R-057 new products, R-091/R-095/R-096 auth hardening
  - no staging environment; push to `main` goes straight to prod
  - no per-visitor funnel analytics (only hashed daily visits plus a CEO website funnel)
  - Google Search Console not connected (not found)

### 6.5 Lead generation and corporate contracts
- **Reuse**:
  - `corporateOutreach.ts` (Places collection, email enrichment, first touch, follow-up, reply processing) plus the Marketing UI and admin routes
  - `corporate_leads`
  - corporate profile PDF/HTML
  - `corporate-events` landing page
  - `whatsapp_leads` + `Leads.tsx` / `LeadThread.tsx` + `leadFunnel()`
  - website `LeadForm`
  - AI Studio Sales Agent (drafts)
  - `offers.ts` manual pay-links for custom B2B quotes
  - `finance_invoices` (invoices with due dates and balance reminders)
  - the Apify scraper skill for prospecting
- **Missing**:
  - contract or proposal templates, a B2B quote/estimate generator, corporate price list or terms (not found)
  - a B2B pipeline beyond 5 statuses (no deal value or next-step fields in `corporate_leads`)
  - LinkedIn outreach (not found)
  - unknown whether `CORP_COLLECT` is on in production
  - R-020 auto-reply bot not live

### 6.6 Email / customer follow-up
- **Reuse**:
  - `lifecycle.ts` + `notify.ts` (full transactional email and WhatsApp lifecycle with night guard)
  - `abandonedCart.ts`, `feedbackReminders.ts`, win-back (`winback.ts`, `marketing.ts`), voucher reminders, birthday sweep
  - `marketing.ts` campaigns and audiences with unsubscribe
  - `marketingCalendar.ts` drafts
  - AI Studio quiet-lead follow-up drafts
  - Resend (plus the Resend MCP available here)
  - `email_send_log` / `email_suppression`
- **Missing**:
  - a nurture sequence for leads who never booked (WhatsApp or website)
  - follow-up after a quote is sent (status `quoted` has no automation)
  - occasion- or theme-based segments
  - rebooking reminders before a child's next birthday. `anniversary` exists only as a campaign audience; the anniversary sweep was retired.
  - a reporting loop on email open/click (Resend metrics are not stored, not found)
  - conflict with D-5 (deleting unpaid orders)

### 6.7 Service innovation
- **Reuse**:
  - `marketing/report` (top themes, celebrations, line items)
  - `ThemeBackfill.tsx` / `sale_themes`, `eventana-themes-2026.csv`
  - `event_ratings` comments
  - `whatsapp_messages` (what customers ask for)
  - AI Studio Event Designer
  - `packages`, `services`, `inventory_assets` (utilisation)
  - backlog of requested products (R-056 Glam Dolls, R-057 kiosks/perfume/lipstick)
  - `Shop.tsx` (printed and digital goods)
- **Missing**:
  - no product-margin data (per-event cost not captured, G-018), so new offers can't be judged on profit
  - no competitor or market tracking (not found)
  - no structured "customer asked for X we don't sell" log (only raw WhatsApp messages)

### 6.8 Finance analysis
- **Reuse**:
  - `finance.ts` + `FinanceHub.tsx` (sales, invoices, expenses, accounting)
  - Bank Inbox (IMAP + Zoho + Wafeq + Stripe fees)
  - `recurringExpenses.ts`
  - `reconReport.ts` (monthly + weekly emails)
  - `dailyAudit.ts` (about 20 money checks)
  - `audit.ts` diagnostics
  - `Ceo.tsx` / `Kpis.tsx`
  - `staffPayReport.ts`
  - `historical_*` (QuickBooks history)
  - the QuickBooks MCP available in this environment
  - `/api/marketing/report`
- **Missing**:
  - per-event cost, ad spend in DB, ROAS and margin (G-018)
  - customer↔QuickBooks unification (R-090, R-001, R-004)
  - refund-reason review (R-005)
  - fuel and consumables budgets (R-078, R-079)
  - QuickBooks production (R-111)
  - Salik and fines (R-014, R-015)
  - cash-flow forecast (not found)
  - VAT reporting (not found)

### 6.9 Systems integration
- **Reuse**:
  - all adapters in `integrations/` (no-SDK pattern; graceful no-op without keys)
  - the reconcile loop as the single scheduler
  - `app_kv` dedupe markers
  - env-gated `list|send` switches as a preview-then-send pattern
  - `db/*.ts` boot-task pattern for one-offs
  - `opsReadOnly` (read window)
  - Render MCP / Supabase MCP / GitHub MCP available here
- **Missing**:
  - the open owner steps: R-041, R-112, R-113, R-114, R-022, R-070/R-080, R-111
  - durable webhook queue
  - unified leave (D-1), data-driven driver schedule (G-016)
  - no central "which switches are on" status page (not found; G-014 has two overlapping WhatsApp status tools)
  - no written policy for the `opsWrite` full-access window

### 6.10 Quality
- **Reuse**:
  - `eventana-qa` skill (workflows and safety rules)
  - `dailyAudit.ts` (about 45 daily checks plus an AI summary)
  - CI `qa.yml` + `tests/e2e`
  - the 9-case payment test plan (README)
  - `event_ratings`, `Feedback.tsx`, `Performance.tsx`, `incentives.ts`
  - Google review flow (when connected)
  - `staff_warnings`
  - governance docs (`MASTER_REQUIREMENTS.md` etc.)
- **Missing**:
  - completed dashboard, backend and integration audits (still "⏳" since 09-09)
  - live per-role testing (needs an owner-driven session)
  - link-destination tests
  - security deep pass
  - updated governance docs (stale since 2026-09-09; CHANGELOG has not been maintained since)
  - service-quality SOPs, handbook and training (R-051, R-052, R-053)
  - a regular customer-satisfaction review (rating trend, refund reasons, complaints)

---

## 7. The two other repos

**`/home/user/laqta`: Laqta (لقطة).** A native iOS app written in SwiftUI (PhotoKit, Vision OCR, SwiftData; iOS 17+). It is a screenshot organiser. It reads only screenshots from the photo library, extracts Arabic and English text on-device, classifies each screenshot into 12 categories with tags, and makes them searchable. Nothing is uploaded.
- Layout: `Laqta/` (App, Models, Services, Views, Utilities, Resources, Assets), `LaqtaTests/`, `project.yml` (XcodeGen), `generate.command`, `codemagic.yaml`, `.github/` (a CI workflow builds on a cloud Mac and uploads to TestFlight), `STORE.md`.
- The README says it was written but never built or run locally (no Mac).
- It has no connection to Eventana's business; it is a separate product of the owner.

**`/home/user/OUR-APP-`: "One BIZ".** A generic all-in-one business operations platform: jobs and tasks, inventory, finance, customers and sales, HR, marketing, and an executive dashboard with role-based access and an offline-capable PWA.
- It is clearly derived from the Eventana codebase: same layout (`packages/shared`, `apps/api` on Fastify + Postgres, `apps/dashboard` on React/Vite) and the same `render.yaml` approach.
- It runs as a public demo: visitors sign into "Demo Co." as owner, get a welcome email through Resend, leave feedback, and the data resets nightly (`routes/demo.ts`).
- WhatsApp, payment and customer email keys are deliberately left unset.
- The README credits it as a student project (developed by Shaima Ibrahim with a student ID; commits mention "five classmates").
- For Eventana it is a sibling or fork, not a live dependency. It could be a sandbox for testing agent ideas without touching production.
