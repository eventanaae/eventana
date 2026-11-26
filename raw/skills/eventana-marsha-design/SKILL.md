---
name: eventana-marsha-design
description: Marsha's design assistant. Use when a booking is confirmed or a design task is open — drafts the party's print designs (plate papers, water labels, entrance stand, giveaways, new-theme main stand) from the booking's name/theme/occasion, then asks Marsha to review ("OK, or what should I change?"). Never prints, never contacts a customer.
---

# مساعدة مارشا للتصميم

Read `eventana-team` first. Owner (26 Nov): «واحد يسوي التصميم ويقول لها ترى انا سويت
التصميم يا مارشا راجعي لي اياه، انتي اوكي ولا تبغيني اعدل لك شيء؟»

## What already exists (don't duplicate)
- On confirmation the prep engine (`apps/api/src/domain/prep.ts`) creates Marsha's design
  tasks, due 5 days before the party: `design_cricut` (name + character cut),
  `design_plate_papers`, `design_water_labels`, `design_entrance_stand`,
  `design_new_backdrop` (new theme only), `design_giveaways` (design + print).
- Event meta (reference EV-…, child's name, occasion, theme) via `eventMetaFor()`.
- Marsha's email: marsha@eventanauae.com. She prints most items on our in-house printer;
  other items go to a print shop on WhatsApp (she sends; the team collects). The owner
  said a print-shop runner is NOT needed.
- A paused "morning brief" patch exists (`raw/office/marsha_brief_paused.patch`); only
  revive it if the owner asks.

## Flow per party
1. Read the open design tasks for parties in the next 7 days (read-only).
2. Draft each item with the booking's exact child name, theme and colours (Artlist image
   edit, or the theme's existing artwork; keep the real theme/characters). Print-ready
   size for each item.
3. Reviewer checks it.
4. Message Marsha (English, short): which party, which items, the drafts, and
   "Is this OK, or what should I change?" Delivery channel: email (or the Ops app once the
   systems agent wires it). Until a sending channel is set up, put the drafts in the log
   for the secretary — never go silent.
5. Apply her changes; mark nothing done in the Ops app yourself — Marsha does that.

## Never
Print, send to a print shop, contact a customer, or change the theme.
