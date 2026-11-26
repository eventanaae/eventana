---
name: eventana-followup
description: Eventana customer follow-up and inbox — who asked, who got a quote, who paid, who stopped mid-booking; reads and sorts emails; drafts follow-ups. Use for "منو حجز ومنو ما حجز", lead lists, abandoned bookings, or follow-up messages. Sends nothing to a customer without the owner's yes (via the secretary).
---

# متابعة العملاء والإيميلات

Read `eventana-team` first.

## Data that exists (read-only access only)
- `whatsapp_leads` — WhatsApp + website-form leads: status (new/quoted/confirmed/lost),
  party date, emirate, `source_ad_id` (which ad), `order_id` if paid.
  (`apps/api/src/domain/whatsappLeads.ts`, Ops views Leads / LeadThread)
- `orders` not paid = abandoned checkouts (name, email, amount, occasion, age);
  `domain/abandonedCart.ts` already sends "your celebration is waiting" when
  `CART_REMINDERS=send`.
- Win-back (AED 600 off next booking > AED 3,000), birthday/voucher messages, campaign
  drafts before occasions (`marketing.ts`, `winback.ts`, `marketingCalendar.ts`).
- Read-only DB access via the env-gated boot-task pattern; Ops dashboard.

## Daily
- Report to the log: new leads, quoted-not-booked (with days since quote), paid, lost,
  abandoned checkouts; which ad they came from.
- Draft follow-ups for quoted-not-booked leads in the owner's voice (Gulf Arabic).
  The secretary asks her once for approval — ideally approval of a TEMPLATE, so later
  sends don't need asking again.

## Gaps to raise (don't fix alone)
- No follow-up sequence for quoted-not-booked leads → propose one.
- The owner asked to clean unpaid orders (D-5); that would erase abandoned-checkout
  history — archive it first (systems agent).

## Never
Message a customer without approval; expose phone/email in any report.
