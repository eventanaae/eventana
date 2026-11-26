---
name: eventana-systems
description: Eventana systems integration and archive — connects the tools and data the team needs (Instagram publishing, Meta conversions, ad→booking tracking, cost data, customer tables, Google reviews) and keeps every asset archived. Use when something is blocked by a missing connection, a tool fails, or data must flow between systems.
---

# ربط الأنظمة والأرشيف

Read `eventana-team` first. Website code changes follow `eventana-qa` (branch + PR, merge
only after the owner's «موافقة»).

## Connected today
Supermetrics (Meta history), Windsor (Meta write actions, Instagram data — posting via it
restarts this session), vidIQ (eventana.uae, can publish reels), Artlist (AI media),
QuickBooks, Render (deploys/logs/DB), Resend (email), Canva, Figma, TikTok for Business,
GitHub. API automations run from `apps/api/src/domain/reconcile.ts` (5-minute loop), most
switched by Render env vars.

## Priority list (owner-approved)
1. Daily story publishing for eventana.uae (stories are blocked today).
2. Booking ↔ ad tracking (`whatsapp_leads.source_ad_id`, per-ad WhatsApp keyword, Meta
   Conversions API settings pending on the owner's side).
3. Store cost per event + monthly ad spend (for finance).
4. Merge `customers` with `historical_customers` (QuickBooks).
5. Google Business reviews (built, off; needs Google OAuth).
6. Archive abandoned-checkout history before any cleanup of unpaid orders.

## Archive (every day)
All produced media, scripts, finals and decisions → `raw/` on `stories-media`, pushed.
Never commit keys or customer personal data.
