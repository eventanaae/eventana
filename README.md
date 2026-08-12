# Eventana

The Eventana platform: the customer app, the internal operations dashboard, and the
booking + payment engine behind both.

Built from the Claude Design prototypes (`../project/`) and the payment integration
specification (`../project/Tabby Integration Spec.dc.html`).

```
eventana/
├── packages/shared     types, the catalogue, and every pricing rule (one source of truth)
├── apps/api            the engine — Fastify + PostgreSQL
├── apps/customer       the customer app — React (mobile)
└── apps/dashboard      internal operations — React (desktop)
```

## Running it

Needs Node 20+ and PostgreSQL 14+.

```bash
npm install
createdb eventana
cp .env.example .env          # fill in later; it runs without provider keys

npm run build:shared
npm run db:migrate
npm run db:seed               # loads the real Eventana catalogue

npm run dev:api               # http://localhost:4000
npm run dev:customer          # http://localhost:5173
npm run dev:dashboard         # http://localhost:5174
```

```bash
npm test                      # 35 tests, including the spec's 9-case payment plan
```

The dashboard's staff token defaults to `dev-staff-token` (`STAFF_TOKEN`).

## How money works

Two rules the whole design hangs on:

**The server is the only source of truth.** `/api/checkout` takes a *cart*, not a price.
It recomputes the total from the catalogue in the database and charges that. A price sent
by a phone is never read — there is no parameter for it.

**A booking becomes paid only via webhook.** Never on button click, never on the redirect
back from the provider, never from the app. The return screen shows a neutral "confirming
your payment" state and polls Eventana's own order endpoint until the *server* says it is
confirmed.

Everything else follows from those: inventory is held transactionally for 15 minutes,
webhooks are de-duplicated and re-verified against the provider's API before anything is
confirmed, every transition is written to an append-only audit table, and a sweep every
5 minutes chases anything a missed webhook left stuck.

Amounts are integer **fils** (1 AED = 100 fils) everywhere. No floats touch money.

## The business rules

All of these live in `packages/shared/src/rules.ts` as defaults, are stored in the
`settings` table, and are editable from the dashboard — the customer app never hard-codes
a price.

| Rule | Value |
|---|---|
| Build Your Own discount | 15% on eligible services |
| Discount threshold | AED 2,500 of eligible services |
| Custom theme fee | AED 800 — never discounted, never counts toward the threshold |
| Delivery | automatic from the event location — never discounted, never counts toward the threshold |
| Al Gharbia | not serviced — checkout blocked, no substitute fee |
| Event length | 4 hours, must finish by 12:00 AM |
| Additional hour | AED 800, still capped at midnight |
| Kids socks | AED 12 a pair, offered after booking when an inflatable is involved |
| Extra food servings | blocks of 10 at the catalogue rates |
| Activity sessions | per child, minimum 20 children |
| Customized t-shirts | minimum 10 pieces |
| Inventory hold | 15 minutes |

Delivery fees: Dubai 280 · Sharjah 380 · Ajman 380 · Abu Dhabi 420 · Umm Al Quwain 480 ·
Al Ain 530 · Ras Al Khaimah 530 · Fujairah 660.

## Inventory

A single physical asset can never be sold twice. Acquiring a hold locks the asset rows
(`SELECT … FOR UPDATE`, in a deterministic order so concurrent checkouts cannot deadlock),
then counts overlapping live holds. Losing the count rolls the whole checkout back.

Reservation windows cover the **full operational window** — prep, transport, setup, the
event, breakdown, return and cleaning — not just the customer's four hours. Each asset
carries its own buffers.

Bouncy castle colours are separate assets, so two customers can book Lime and Cotton Candy
on the same day but never the same colour.

## Payments

Three providers behind one interface (`apps/api/src/payments/`):

- **Tabby** — `AUTHORIZED` confirms the booking; `CLOSED` + `captures[]` is the finance signal
- **Tamara** — JWT-signed notifications, HS256 verified against the notification token
- **Ziina** — captures on success; HMAC-SHA256 webhook signature

**A provider with no secrets runs in simulated mode.** That is not a fake payment: the
checkout sequence, holds, state machine, signature verification, idempotency,
re-verification and confirmation are all the real code path — only the provider's servers
are stood in for, by a local page at `/simulator/:provider/:paymentId`. It lets the whole
system be exercised before Eventana holds any merchant account, and
`assertProductionReady()` refuses to boot production while any provider is in that mode.

### Going live

1. Open the merchant accounts (Tabby, Tamara, Ziina). Each gives sandbox and live keys.
2. Put the keys in the **server's** environment — not in a chat, not in the repo, not in
   the app.
3. Register the webhook endpoint (`POST /api/webhooks/<provider>`) for each environment.
4. Run the 9-case sandbox plan (`npm test` covers it end to end).
5. Confirm auto-capture behaviour with your Tabby account manager in writing.
6. Set `EVENTANA_PAYMENT_MODE=live`.

Field names and status spellings in the adapters reflect each provider's published model
as of August 2026 and should be checked against the current API reference before go-live.
The architecture, state machine, idempotency rules and failure handling are
provider-independent and do not change when a payload detail does.

## What is honest about its limits

- **Photography** — packages, themes and items render as the prototype's gradients. The
  schema carries `cover_image_url` and `theme_inspiration`; drop in real photos and they
  render.
- **Map pin** — required to book, stored as latitude/longitude, and used for the delivery
  zone. Interactive Google Maps picking and live ETA need `GOOGLE_MAPS_API_KEY`.
- **Notifications** — the confirmation, 3-day and event-day messages are *scheduled* into
  the `notifications` table with the right timing and cancellation rules; connecting an
  email/push provider is the remaining step.
- **Authentication** — the customer is identified by an `x-customer-id` header and staff by
  a shared token. Both are placeholders for real sign-in.
- **Prices marked "pending admin"** — Slush Station, Blue Water Slide, Customized Hat, Face
  Banner, VIP Wristbands and Flower Bouquet had ambiguous price-to-item mapping in the
  catalogue. They are flagged in the UI rather than presented as final.
- **Webhook processing** is queued in-process (`setImmediate`). A production deployment
  should swap in a durable queue; `processDelivery` is already written to be called from
  one.
