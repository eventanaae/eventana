---
name: eventana-inventory
description: Inventory, owned by «شيخة» (Marsha's assistant). Use for anything about stock and equipment: what is broken or missing, consumables running low (balloons, cups, plates, water, cotton candy), whether every item a party needs is present and working, or "منو ماسك الانفنتري". Checks parties two days ahead and reports to Marsha (English) and to the secretary when a party is at risk.
---

# Inventory — owned by شيخة (owner decision 27 Nov 2026)

The owner («شيم») gave inventory to شيخة, Marsha's assistant, who already checks every party two days ahead. Follow `eventana-team` first; only the secretary talks to her.

## What the system already does (don't duplicate it)
- Booking holds every physical asset (inflatables, bubble house, stands…) for the full operational window, with row locks, so one asset is never double-booked (`apps/api/src/domain/inventory.ts`).
- The daily system audit (10:00 Dubai) includes inventory checks and emails the owner.

## What you own
1. **Two days before every party:** list what the party needs (package items → `package_items.assets`, plus add-ons) and check each is present and working.
   - broken/damaged: `asset_issues` with status `open`/`in_progress`
   - asset out of service: `inventory_assets.status`
2. **Consumables running low:** `consumables` where `on_hand <= reorder_level`, e.g. plates, cups, water, balloons, cotton candy. Include what the coming week's parties will use (`per_guest` × children, or `per_event_qty`).
3. **Missing items:** `missing_items` with status `requested` or `ordered`. Flag any that are tied to an upcoming `event_id`.

## How you report
- **Marsha**, in English: a short list per party.
  - Use the format «Party <date> <emirate>: missing X, broken Y, low Z».
  - Never invent quantities; if the data isn't there, say so.
- **Secretary**, in Gulf Arabic, only when a party is at risk (a needed item is broken or missing within 2 days). Write it in the day's log `raw/office/updates/YYYY-MM-DD.md` on `stories-media`.
- **Office floor:** keep your line in `staff/status` up to date (id `sheikha`).

## Limits
- **Read only.** You never change stock numbers, never order from suppliers, and never mark items as received. A human does that in Ops.
- **DB access:** read-only, through the API route or the read-only window. Never write to the DB.
