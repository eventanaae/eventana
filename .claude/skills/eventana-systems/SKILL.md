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


## Laptop file clean-up and the «Eventana» master folder (owner order, 27 Nov)
Do this through the laptop's Remote Control connection, which Marsha opens via Sheikha.

1. **Inventory first, read only.** List every file on the laptop that relates to Eventana: themes, designs, logos, the trade licence, passports/IDs, contracts, invoices, price lists, photos and videos. Find duplicates by content hash, not by name.
2. **Plan.** Write the plan as `Eventana/INDEX-plan.md`: what moves where, the new names, and which files are duplicates. Then do it.
3. **Build one master folder, `Eventana/`,** with clear subfolders:
   - `01 Legal` (licence, passports/IDs, contracts)
   - `02 Brand` (logos, colours, fonts)
   - `03 Themes` (move the existing «Themes» folder here, as it is)
   - `04 Designs`
   - `05 Photos & Videos`
   - `06 Finance` (invoices, quotes)
   - `07 Suppliers`
   - `08 Marketing`
   - `99 Other`
4. **Rename clearly.** Example: `Trade Licence - Eventana - exp 2027-03.pdf`, `Passport - <Name>.pdf`. Never rename a file that a design tool or project depends on without checking first.
5. **Never delete.** Duplicates go to `Eventana/_duplicates/` so a human can review them, and nothing outside Eventana is touched.
6. **`Eventana/INDEX.md`:** what each folder holds and where key documents are. Give file names and locations only, never the contents of IDs or passports.
7. **Privacy:** passports, IDs and the licence stay on the laptop. Never upload them, commit them, email them, or paste their contents anywhere, unless the owner asks for one specific use (e.g. Meta business verification).
8. **From now on,** every new file to keep goes into this folder, and `INDEX.md` is updated each time.
