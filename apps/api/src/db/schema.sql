-- Eventana engine schema.
--
-- Design notes that matter:
--   * Money is BIGINT fils everywhere (1 AED = 100 fils). No floats.
--   * booking status and payment status are SEPARATE columns on separate
--     tables. Production work keys off the order/event status, which only
--     advances when a provider webhook says the payment succeeded.
--   * payment_events is append-only. It is the audit trail the finance
--     and dispute processes read; nothing updates or deletes from it.
--   * inventory_holds carries both the temporary hold and the firm
--     reservation, so converting one into the other is a status change
--     inside the confirming transaction rather than a delete + insert.

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS delivery_zones (
  id                  SERIAL PRIMARY KEY,
  zone_name           TEXT NOT NULL,
  emirate             TEXT NOT NULL UNIQUE,
  areas               TEXT[],
  fee_fils            BIGINT,
  available           BOOLEAN NOT NULL DEFAULT TRUE,
  special_conditions  TEXT,
  effective_date      DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS service_categories (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  note               TEXT NOT NULL DEFAULT '',
  celebration_types  TEXT[] NOT NULL,
  sort_order         INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  category_id         TEXT NOT NULL REFERENCES service_categories(id),
  price_fils          BIGINT NOT NULL,
  short_description   TEXT NOT NULL DEFAULT '',
  detail              TEXT,
  pricing             JSONB NOT NULL,
  requires_assets     TEXT[] NOT NULL DEFAULT '{}',
  is_inflatable       BOOLEAN NOT NULL DEFAULT FALSE,
  is_food_station     BOOLEAN NOT NULL DEFAULT FALSE,
  extra_serving_fils  BIGINT,
  needs_admin_review  BOOLEAN NOT NULL DEFAULT FALSE,
  celebration_types   TEXT[] NOT NULL,
  badge               TEXT,
  gradient            TEXT NOT NULL DEFAULT '',
  active              BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS packages (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  price_fils        BIGINT NOT NULL,
  capacity          TEXT NOT NULL,
  duration_hours    INT NOT NULL DEFAULT 4,
  tag               TEXT,
  gradient          TEXT NOT NULL DEFAULT '',
  has_castle_choice BOOLEAN NOT NULL DEFAULT FALSE,
  active            BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS package_items (
  id          SERIAL PRIMARY KEY,
  package_id  TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  assets      TEXT[] NOT NULL DEFAULT '{}',
  sort_order  INT NOT NULL DEFAULT 0
);

-- Additive: a hero cover image + an inspiration gallery for each package.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

CREATE TABLE IF NOT EXISTS package_inspiration (
  id          SERIAL PRIMARY KEY,
  package_id  TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS themes (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  colors            TEXT[] NOT NULL DEFAULT '{}',
  gradient          TEXT NOT NULL DEFAULT '',
  cover_image_url   TEXT,
  popular           BOOLEAN NOT NULL DEFAULT FALSE,
  featured          BOOLEAN NOT NULL DEFAULT FALSE,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  celebration_type  TEXT NOT NULL,
  sort_order        INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS theme_inspiration (
  id        SERIAL PRIMARY KEY,
  theme_id  TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_assets (
  code                    TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  variant                 TEXT,
  units                   INT NOT NULL DEFAULT 1,
  buffer_before_minutes   INT NOT NULL DEFAULT 60,
  buffer_after_minutes    INT NOT NULL DEFAULT 90,
  status                  TEXT NOT NULL DEFAULT 'available',
  notes                   TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL,
  email          TEXT,
  loyalty_points INT NOT NULL DEFAULT 0,
  loyalty_tier   TEXT NOT NULL DEFAULT 'SILVER',
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Additive: self-service account password (salt:hash). Customers created
-- before self-registration simply have NULL here.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- A mandatory backup contact number, captured at checkout (guest or account).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS backup_phone TEXT;

-- Referral programme + store credit.
--  referral_code: this customer's own shareable code.
--  referred_by: the code they signed up with (credits its owner on first booking).
--  referral_credit_fils: spendable store credit (welcome credit + referral rewards).
--  referral_rewarded: guards the one-time referrer reward on the referee's 1st booking.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_credit_fils INT NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS customers_referral_code_idx ON customers (referral_code);

-- Marketing promo codes the dashboard can create.
CREATE TABLE IF NOT EXISTS promo_codes (
  code           TEXT PRIMARY KEY,          -- stored uppercased
  kind           TEXT NOT NULL,             -- 'percent' | 'fixed'
  value          INT NOT NULL,              -- percent (1-100) or fils
  min_spend_fils INT NOT NULL DEFAULT 0,
  max_uses       INT,                       -- NULL = unlimited
  uses           INT NOT NULL DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Personal vouchers (e.g. the 20%-off "next booking" reward) reuse this table.
--  customer_id: NULL = a public marketing code; set = usable only by that customer.
--  auto_reminder: this is a personal reward we nudge the customer about every 6 months.
--  last_reminded_at: when the last reminder email went out (NULL = never).
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS customer_id TEXT;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS auto_reminder BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS promo_codes_customer_idx ON promo_codes (customer_id);

-- One redemption per customer per code (also the audit trail).
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  order_id    TEXT NOT NULL,
  amount_fils INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, customer_id)
);

-- Launch promo codes (owner can add/disable more from the dashboard).
INSERT INTO promo_codes (code, kind, value, min_spend_fils) VALUES
  ('WELCOME10', 'percent', 10, 0),
  ('EVENTANA50', 'fixed', 5000, 100000)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL DEFAULT 'booking',   -- booking | addon
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  event_id         TEXT,                              -- set for addon orders
  status           TEXT NOT NULL DEFAULT 'awaiting_payment',
  currency         TEXT NOT NULL DEFAULT 'AED',
  total_fils       BIGINT NOT NULL,
  -- The cart exactly as submitted, and the quote the SERVER computed from
  -- it. Keeping both makes an amount dispute answerable months later.
  cart             JSONB NOT NULL,
  quote            JSONB NOT NULL,
  idempotency_key  TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, updated_at);
CREATE INDEX IF NOT EXISTS orders_event_idx ON orders (event_id);

-- Additive: where this order came from. Captured by the app on the landing
-- click (fbclid / utm_* / the Meta browser cookies) and carried through to
-- checkout, so a paid booking can be posted back to Meta against the exact
-- ad that produced it. NULL for every order taken before this existed, and
-- for anyone who arrives without campaign parameters.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS attribution JSONB;

CREATE TABLE IF NOT EXISTS payments (
  id                   TEXT PRIMARY KEY,
  order_id             TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL,
  provider_payment_id  TEXT,
  status               TEXT NOT NULL DEFAULT 'created',
  amount_fils          BIGINT NOT NULL,
  captured_fils        BIGINT NOT NULL DEFAULT 0,
  refunded_fils        BIGINT NOT NULL DEFAULT 0,
  checkout_url         TEXT,
  last_provider_status TEXT,
  raw                  JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One provider payment maps to exactly one Eventana payment row. This
-- unique index is what makes duplicate webhook delivery a no-op rather
-- than a second booking.
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_idx
  ON payments (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- Append-only audit log. Never UPDATE, never DELETE.
CREATE TABLE IF NOT EXISTS payment_events (
  id           BIGSERIAL PRIMARY KEY,
  payment_id   TEXT,
  order_id     TEXT,
  provider     TEXT NOT NULL,
  old_status   TEXT,
  new_status   TEXT NOT NULL,
  source       TEXT NOT NULL,        -- webhook | poll | api | admin | system
  provider_status TEXT,
  amount_fils  BIGINT,
  payload      JSONB,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_events_order_idx ON payment_events (order_id, created_at);

-- Webhook receipts. The unique key makes replayed deliveries idempotent
-- even before the payment row is looked at.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id                   BIGSERIAL PRIMARY KEY,
  provider             TEXT NOT NULL,
  provider_payment_id  TEXT NOT NULL,
  provider_status      TEXT NOT NULL,
  signature_ok         BOOLEAN NOT NULL,
  payload              JSONB NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at         TIMESTAMPTZ,
  outcome              TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_dedupe_idx
  ON webhook_deliveries (provider, provider_payment_id, provider_status);

CREATE TABLE IF NOT EXISTS events (
  id                TEXT PRIMARY KEY,               -- EV-2026-0187
  order_id          TEXT NOT NULL REFERENCES orders(id),
  customer_id       TEXT NOT NULL REFERENCES customers(id),
  celebration_type  TEXT NOT NULL,
  package_id        TEXT REFERENCES packages(id),
  theme_id          TEXT,
  custom_theme      BOOLEAN NOT NULL DEFAULT FALSE,
  custom_theme_brief JSONB,
  event_date        DATE NOT NULL,
  start_time        TEXT NOT NULL,
  base_end_time     TEXT NOT NULL,
  extra_hours       INT NOT NULL DEFAULT 0,
  children_count    INT NOT NULL DEFAULT 0,
  emirate           TEXT NOT NULL,
  address           JSONB NOT NULL,
  map_lat           DOUBLE PRECISION NOT NULL,
  map_lng           DOUBLE PRECISION NOT NULL,
  castle_variant    TEXT,
  phase             TEXT NOT NULL DEFAULT 'Booking Confirmed',
  eta               TEXT,
  chat_open         BOOLEAN NOT NULL DEFAULT TRUE,
  -- 'Cancelled' is a terminal phase, not a stage: it suppresses live
  -- tracking and closes every self-service purchase and change.
  cancelled_at        TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Additive migration for databases created before cancellation existed.
ALTER TABLE events ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Google Calendar sync: id of the mirrored event in the shared team calendar.
ALTER TABLE events ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;

-- Movie Night: the film the customer picked (previously dropped at checkout).
ALTER TABLE events ADD COLUMN IF NOT EXISTS movie_id TEXT;
-- Custom-theme brief carried from the booking (older DBs may lack the column).
ALTER TABLE events ADD COLUMN IF NOT EXISTS custom_theme_brief JSONB;

CREATE TABLE IF NOT EXISTS event_services (
  id          SERIAL PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  service_id  TEXT REFERENCES services(id),
  label       TEXT NOT NULL,
  quantity    INT NOT NULL DEFAULT 1,
  amount_fils BIGINT NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'booking',   -- booking | addon
  order_id    TEXT REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS event_setup_photos (
  id          SERIAL PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  photo_url   TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A hold is temporary (expires_at) and becomes a firm reservation on
-- payment. Both live here so the transition is a status update.
CREATE TABLE IF NOT EXISTS inventory_holds (
  id          BIGSERIAL PRIMARY KEY,
  asset_code  TEXT NOT NULL REFERENCES inventory_assets(code),
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_id    TEXT,
  starts_at   TIMESTAMPTZ NOT NULL,   -- event start MINUS prep buffer
  ends_at     TIMESTAMPTZ NOT NULL,   -- event end PLUS breakdown buffer
  expires_at  TIMESTAMPTZ,            -- NULL once reserved
  status      TEXT NOT NULL DEFAULT 'held',  -- held | reserved | released
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_holds_asset_idx
  ON inventory_holds (asset_code, status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS team_members (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  role    TEXT NOT NULL,
  color   TEXT NOT NULL DEFAULT '#F06CA8',
  active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- Additive: dashboard access level (owner | manager | employee) and a
-- personal login token, so staff sign in as themselves with the right scope.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'employee';
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS access_token TEXT;

CREATE TABLE IF NOT EXISTS event_team (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES team_members(id),
  PRIMARY KEY (event_id, member_id)
);

CREATE TABLE IF NOT EXISTS event_tasks (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  department  TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',   -- open | done | blocked
  blocked_reason TEXT,
  due_at      TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_tasks_event_idx ON event_tasks (event_id, department);

CREATE TABLE IF NOT EXISTS messages (
  id         BIGSERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,          -- customer | team
  author     TEXT,                   -- staff display name; never a phone number
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS designs (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  image_url   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | changes_requested
  customer_note TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS designs_event_version_idx ON designs (event_id, version);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id          BIGSERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  event_id    TEXT,
  order_id    TEXT,
  points      INT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT,
  channel     TEXT NOT NULL,       -- email | push | ops_alert
  template    TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ,
  sent_at     TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_pending_idx
  ON notifications (scheduled_for) WHERE sent_at IS NULL AND cancelled_at IS NULL;

-- ── Cancellations & refunds ──────────────────────────────────────────────
-- One row per cancelled order. The refund amount is computed on the server
-- from the approved policy (see packages/shared/src/refund.ts) at cancellation
-- time and frozen here, so the customer, the team and the eventual money-out
-- all agree on one number. refund_status: pending → processing → processed /
-- failed. The actual money-out is still the staff-only refund route.
CREATE TABLE IF NOT EXISTS cancellations (
  order_id            TEXT PRIMARY KEY REFERENCES orders(id),
  event_id            TEXT,
  cancelled_by        TEXT NOT NULL DEFAULT 'customer',   -- customer | staff
  reason              TEXT,
  total_paid_fils     INTEGER NOT NULL,
  delivery_fils       INTEGER NOT NULL DEFAULT 0,
  non_refundable_fils INTEGER NOT NULL DEFAULT 0,
  party_value_fils    INTEGER NOT NULL DEFAULT 0,
  refund_percent      INTEGER NOT NULL DEFAULT 0,
  refund_amount_fils  INTEGER NOT NULL DEFAULT 0,
  refund_status       TEXT NOT NULL DEFAULT 'pending',    -- pending|processing|processed|failed|none
  refund_reference    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ
);

-- Sequences for the human-facing identifiers.
CREATE SEQUENCE IF NOT EXISTS order_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS event_ref_seq START 187;

-- ── Consumables inventory ────────────────────────────────────────────────
-- Durable assets (machines, inflatables) live in inventory_assets and are
-- double-booking-protected via inventory_holds. Consumables are single-use
-- counted stock (plates, cups, cutlery, water) drawn down per event.
CREATE TABLE IF NOT EXISTS consumables (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'general',   -- plates | cups | cutlery | water | ...
  unit           TEXT NOT NULL DEFAULT 'pcs',
  on_hand        INT NOT NULL DEFAULT 0,
  reorder_level  INT NOT NULL DEFAULT 0,
  per_guest      BOOLEAN NOT NULL DEFAULT FALSE,     -- auto-deduct children_count per booking
  per_event_qty  INT NOT NULL DEFAULT 0,             -- flat auto-deduction per booking
  supplier       TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every draw-down (auto on booking, or manual) — the audit behind on_hand.
CREATE TABLE IF NOT EXISTS consumable_usage (
  id             BIGSERIAL PRIMARY KEY,
  consumable_id  TEXT NOT NULL REFERENCES consumables(id),
  event_id       TEXT,
  order_id       TEXT,
  quantity       INT NOT NULL,                       -- negative = restock
  reason         TEXT NOT NULL DEFAULT 'event',      -- event | manual | restock
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consumable_usage_event_idx ON consumable_usage (event_id);

-- Field team reports of missing / to-order items (#29).
CREATE TABLE IF NOT EXISTS missing_items (
  id           BIGSERIAL PRIMARY KEY,
  item         TEXT NOT NULL,
  quantity     INT NOT NULL DEFAULT 1,
  event_id     TEXT,
  supplier     TEXT,
  status       TEXT NOT NULL DEFAULT 'requested',    -- requested | ordered | received | cancelled
  reported_by  TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS missing_items_status_idx ON missing_items (status, created_at);

-- ── Ratings & tips (#30) ─────────────────────────────────────────────────
-- After an event, the customer rates it (1–5 + feedback) and can leave a tip
-- for the whole crew or a specific member. A tip is a real Ziina payment: it
-- rides the normal order→payment→webhook rail as a 'tip'-kind order, and is
-- marked paid only on a provider-confirmed webhook — never optimistically.
CREATE TABLE IF NOT EXISTS event_ratings (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  customer_id TEXT REFERENCES customers(id),
  stars       INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  feedback    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One rating per event; a re-submit updates it (handled with ON CONFLICT).
CREATE UNIQUE INDEX IF NOT EXISTS event_ratings_event_idx ON event_ratings (event_id);

CREATE TABLE IF NOT EXISTS tips (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  order_id    TEXT REFERENCES orders(id),          -- the tip's own payment order
  member_id   TEXT REFERENCES team_members(id),    -- NULL = whole team
  amount_fils BIGINT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',      -- pending | paid | failed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tips_event_idx  ON tips (event_id);
CREATE INDEX IF NOT EXISTS tips_member_idx ON tips (member_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS tips_order_idx ON tips (order_id) WHERE order_id IS NOT NULL;

-- ── Expenses & finance (#31) ─────────────────────────────────────────────
-- QuickBooks-style expense log. Owner/CEO dashboards read revenue from paid
-- orders (bookings + add-ons; tips are pass-through to staff, never revenue)
-- and subtract these to show net profit. receipt_url is filled once image
-- storage is wired; the amount and category work without it.
CREATE TABLE IF NOT EXISTS expenses (
  id           BIGSERIAL PRIMARY KEY,
  category     TEXT NOT NULL DEFAULT 'general',  -- inventory | salaries | rent | fuel | marketing | maintenance | supplies | utilities | other
  description  TEXT NOT NULL,
  amount_fils  BIGINT NOT NULL CHECK (amount_fils >= 0),
  vendor       TEXT,
  event_id     TEXT REFERENCES events(id) ON DELETE SET NULL,  -- optional: cost tied to a job
  spent_on     DATE NOT NULL DEFAULT current_date,
  receipt_url  TEXT,
  recorded_by  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_spent_idx ON expenses (spent_on);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses (category, spent_on);

-- ── Staff scheduling: days off & birthdays (#28) ─────────────────────────
-- Birthdays live on the member; the team sees whose is coming up. Days off
-- are date ranges the calendar layers on top of events so nobody is rostered
-- while away. Managers approve; the crew can request.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS birthday DATE;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE TABLE IF NOT EXISTS staff_days_off (
  id         BIGSERIAL PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  reason     TEXT,
  status     TEXT NOT NULL DEFAULT 'approved',  -- requested | approved | denied
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS days_off_member_idx ON staff_days_off (member_id, start_date);
CREATE INDEX IF NOT EXISTS days_off_range_idx ON staff_days_off (start_date, end_date);

-- ── Email marketing (#26) ────────────────────────────────────────────────
-- Customers opt out here; campaigns send only to opted-in addresses. A
-- campaign can be sent now or scheduled (a boot sweep sends due ones).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS email_campaigns (
  id            BIGSERIAL PRIMARY KEY,
  subject       TEXT NOT NULL,
  body_html     TEXT NOT NULL,
  audience      TEXT NOT NULL DEFAULT 'all',   -- all | past_customers | no_recent_booking
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | sending | sent | failed
  scheduled_for TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  recipient_count INT NOT NULL DEFAULT 0,
  sent_count    INT NOT NULL DEFAULT 0,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_campaigns_status_idx ON email_campaigns (status, scheduled_for);

-- ── Push notifications (#20) ─────────────────────────────────────────────
-- Device tokens for FCM. owner_type is 'staff' or 'customer'; a token is
-- unique (re-registration upserts). Sends go through Firebase HTTP v1.
CREATE TABLE IF NOT EXISTS device_tokens (
  id          BIGSERIAL PRIMARY KEY,
  owner_type  TEXT NOT NULL,                 -- staff | customer
  owner_id    TEXT NOT NULL,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'ios',   -- ios | android | web
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_token_idx ON device_tokens (token);
CREATE INDEX IF NOT EXISTS device_tokens_owner_idx ON device_tokens (owner_type, owner_id);

-- ── Monthly finance report (#31) ─────────────────────────────────────────
-- Managers can receive a monthly finance summary by email. Staff emails let
-- owner/manager members receive it; finance_reports dedupes the auto-send so
-- the sweep mails each month exactly once.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS email TEXT;

CREATE TABLE IF NOT EXISTS finance_reports (
  month      TEXT PRIMARY KEY,            -- YYYY-MM
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  recipients INT NOT NULL DEFAULT 0
);

-- ── WhatsApp leads (#32) ─────────────────────────────────────────────────
-- Every enquiry that arrives on WhatsApp, keyed by the customer's number.
--
-- This is the record Eventana has never had: the ads buy conversations, but
-- until now nothing wrote down who asked, for WHICH DATE, and whether it
-- turned into a booking. `ctwa_clid` is the click id Meta attaches to a
-- click-to-WhatsApp message, so a lead here can be traced to the exact ad —
-- and joined to `orders` once the same number pays.
--
-- One row per phone number: a customer who asks again about a second party
-- updates their row rather than creating a duplicate lead.
CREATE TABLE IF NOT EXISTS whatsapp_leads (
  id               BIGSERIAL PRIMARY KEY,
  phone            TEXT NOT NULL UNIQUE,     -- digits only, with country code
  name             TEXT,                     -- WhatsApp profile name
  event_date       DATE,                     -- the party date, once known
  emirate          TEXT,
  -- new: just messaged · quoted: given a price · confirmed: said yes on
  -- WhatsApp · booked: an order was paid · lost: went quiet or declined
  status           TEXT NOT NULL DEFAULT 'new',
  ctwa_clid        TEXT,                     -- Meta click-to-WhatsApp click id
  source_ad_id     TEXT,                     -- the ad that produced the click
  source_headline  TEXT,
  notes            TEXT,
  message_count    INT NOT NULL DEFAULT 0,
  first_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at     TIMESTAMPTZ,
  -- Set when this number later completes a paid order, which is what turns
  -- "cost per conversation" into "cost per booking".
  order_id         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_leads_status_idx ON whatsapp_leads (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_leads_event_date_idx ON whatsapp_leads (event_date);
CREATE INDEX IF NOT EXISTS whatsapp_leads_ad_idx ON whatsapp_leads (source_ad_id);

-- Every inbound/outbound WhatsApp message, so a lead's history survives even
-- though the chat itself lives in Meta's app. Append-only.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id           BIGSERIAL PRIMARY KEY,
  phone        TEXT NOT NULL,
  wa_message_id TEXT UNIQUE,              -- Meta's id; makes replays a no-op
  direction    TEXT NOT NULL,             -- in | out
  body         TEXT,
  -- 'agent' when this app sent it automatically, 'staff' when a human did.
  sent_by      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_phone_idx ON whatsapp_messages (phone, created_at);
