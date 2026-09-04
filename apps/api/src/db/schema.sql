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

-- Date of birth (optional): powers birthday greetings/automation and age-based
-- marketing segments. Collected at registration and editable in the profile.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS date_of_birth DATE;

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

-- Additive: where the ORDER was created from. 'app' (customer self-serve, the
-- default/NULL) or 'manual' (a Manager-created WhatsApp order paid via a link).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT;

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
-- A free-text address / Google Maps link the team can set for the event (esp.
-- converted/manual bookings that never captured a map pin). The exact pin, when
-- known, still lives in map_lat/map_lng.
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_note TEXT;
-- The customer hasn't fixed an event date yet. event_date stays NOT NULL (a
-- placeholder), but while this is true the app/receipt show "TBD" and no
-- date-based customer reminder is sent. Cleared when a real date is set.
ALTER TABLE events ADD COLUMN IF NOT EXISTS date_tbd BOOLEAN NOT NULL DEFAULT FALSE;

-- Drivers roster. Shan is the main driver; for far / multiple same-day events we
-- hire drivers with their own car (kind 'own_car') or a part-timer to drive the
-- company van (kind 'van'). Kept OUT of team_members so freelance drivers don't
-- clutter HR. Their WhatsApp number lets the driver-notification pipeline reach
-- whoever is assigned to an event's driver slot (matched by name to
-- event_staff.part_time_name). Seeded from DRIVERS_SEED (phones out of git).
CREATE TABLE IF NOT EXISTS drivers (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  kind       TEXT NOT NULL DEFAULT 'own_car', -- 'main' | 'own_car' | 'van'
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS drivers_name_key ON drivers (lower(name));

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
-- Customer-facing rows are also delivered over WhatsApp (in parallel to email);
-- this stamps the WhatsApp send independently so each channel retries on its own.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;

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
-- How the expense was paid (cash | card | bank_transfer | cheque | other).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method TEXT;
-- Provenance. 'manual' (owner via Add Expense) counts toward the live profit
-- picture; 'quickbooks' rows are pulled from the QB ledger for their receipt
-- images + itemised history — they are ALREADY inside the imported P&L
-- aggregate (finance_years), so they are EXCLUDED from live sums to avoid
-- double-counting. qb_id is the QuickBooks Purchase id, used to sync
-- idempotently (re-running the sync updates rather than duplicates).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qb_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_qb_id_idx ON expenses (qb_id) WHERE qb_id IS NOT NULL;
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

-- ── Annual Leave (entitlement, accrual, requests & approval) ──────────────────
-- Each member accrues paid annual leave pro-rata from their employment start
-- date (rate = annual entitlement ÷ 12, so ~2.5 days per completed month for a
-- 30-day entitlement). The entitlement and rate live in settings
-- (leave.annualEntitlementDays / leave.accrualPerMonth) so the owner can change
-- them without a deploy. Balance is computed LIVE: accrued − approved − pending,
-- so a request can never be deducted twice and nothing is deducted before
-- approval. An approved request also drops a linked staff_days_off row, which
-- is what makes the person Unavailable on the calendar and in auto-staffing.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS employment_start_date DATE;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS employment_end_date DATE;   -- contract end; caps accrual
-- Leave already taken BEFORE this system existed (e.g. a long-serving member
-- who used their annual leave every year off-system). Counted as "used" so the
-- live balance isn't an inflated cumulative pile. One-off backfill, owner-set.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS leave_opening_used_days NUMERIC NOT NULL DEFAULT 0;
-- Free-text HR note on the member's employment history (breaks, non-renewals,
-- transfers). Documentation only; shown to owner/manager on the Team screen.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS employment_note TEXT;
-- The member's recurring WEEKLY day off (rest day), 0=Sunday … 6=Saturday
-- (matches JS getUTCDay). NULL = none set. The auto-staffing engine keeps them
-- free on this weekday and it shows on their profile.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS weekly_day_off SMALLINT;
-- Salary increment note shown on the member's profile (free text — e.g. the new
-- salary / effective date). NULL = none recorded.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS salary_increment_note TEXT;
ALTER TABLE staff_days_off ADD COLUMN IF NOT EXISTS leave_request_id BIGINT;  -- set when the day-off came from an approved leave

CREATE TABLE IF NOT EXISTS leave_requests (
  id            BIGSERIAL PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  days          INT  NOT NULL CHECK (days > 0),   -- inclusive calendar days requested
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | cancelled
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    TEXT,                             -- name of the owner/manager who decided
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS leave_requests_member_idx ON leave_requests (member_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx ON leave_requests (status);

-- Performance feedback history — every note a manager/owner writes for a member
-- is kept (not just the latest), and shown on the member's profile newest-first.
CREATE TABLE IF NOT EXISTS staff_feedback (
  id         BIGSERIAL PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  ftype      TEXT,                     -- praise | improvement | general
  body       TEXT NOT NULL,
  event_id   TEXT,                     -- optional related event
  created_by TEXT,                     -- who wrote it
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_feedback_member_idx ON staff_feedback (member_id, created_at DESC);

-- Disciplinary warnings (إنذار). A warning wipes that month's competition
-- points (and therefore the points-based bonus) for the member. Tips and
-- commissions are separate and are NOT affected. `ym` is the 'YYYY-MM' the
-- warning applies to.
CREATE TABLE IF NOT EXISTS staff_warnings (
  id             BIGSERIAL PRIMARY KEY,
  member_id      TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  ym             TEXT NOT NULL,                -- 'YYYY-MM' the warning is logged against
  reason         TEXT,
  -- When TRUE the warning wipes that month's competition points. When FALSE it
  -- is recorded on the member's file but does NOT touch their points (an owner
  -- exception — "documented, but don't penalise this month").
  affects_points BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, ym)
);
-- Richer HR fields on a warning: its level/type, the date it was issued, and how
-- long it stays valid on the member's record.
ALTER TABLE staff_warnings ADD COLUMN IF NOT EXISTS wtype       TEXT;  -- documented|first|second|final
ALTER TABLE staff_warnings ADD COLUMN IF NOT EXISTS issued_date DATE;  -- when the warning was issued
ALTER TABLE staff_warnings ADD COLUMN IF NOT EXISTS valid_until DATE;  -- record validity end (NULL = no expiry)
-- Salary deduction that came with the warning (percent of the month's salary).
-- 0 = none. Standard ladder: 1st 0%, 2nd 10%, Final 16%. This is the disciplinary
-- salary penalty and is separate from the competition-points effect.
ALTER TABLE staff_warnings ADD COLUMN IF NOT EXISTS salary_deduction_pct INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS staff_warnings_ym_idx ON staff_warnings (ym);

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
-- Approval workflow: a campaign must be approved (Manager/CEO) before it sends.
-- status also allows: pending_approval | approved | rejected.
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
-- Smart-marketing suggestions (e.g. event anniversary) are stored as normal
-- campaigns; this marks the source and its target so we never suggest twice.
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS source TEXT;         -- manual | anniversary
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS dedupe_key TEXT;     -- unique-ish suggestion key
CREATE UNIQUE INDEX IF NOT EXISTS email_campaigns_dedupe_idx ON email_campaigns (dedupe_key) WHERE dedupe_key IS NOT NULL;

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

-- ── Historical financials from QuickBooks (#3) ───────────────────────────────
-- QuickBooks is the single source of truth for the business's real financial
-- history: every sale to date was taken on WhatsApp and booked in QuickBooks,
-- so the live app (which only knows bookings placed THROUGH the app, 2026+)
-- cannot show true revenue/expenses/profit on its own. We import the
-- QuickBooks Profit & Loss here — one row per period (a whole year, or a single
-- month) — with the income total, cost of sales, total expenses, the derived
-- gross/net, and the full income/expense category breakdowns as JSONB. The CEO
-- dashboard reads THIS for the money picture (revenue, expenses, profit, YoY)
-- and keeps the app's own data for operational metrics only (bookings, emirate,
-- event type, funnel) so nothing is ever double-counted.
--
-- Money is fils (1 AED = 100 fils), consistent with the rest of the schema.
CREATE TABLE IF NOT EXISTS historical_financials (
  period            TEXT PRIMARY KEY,               -- 'YYYY' (annual) or 'YYYY-MM'
  period_kind       TEXT NOT NULL DEFAULT 'year',   -- year | month
  income_fils       BIGINT NOT NULL DEFAULT 0,
  cogs_fils         BIGINT NOT NULL DEFAULT 0,
  expenses_fils     BIGINT NOT NULL DEFAULT 0,
  gross_profit_fils BIGINT NOT NULL DEFAULT 0,
  net_income_fils   BIGINT NOT NULL DEFAULT 0,
  income_breakdown  JSONB,                           -- [{ "label": ..., "fils": ... }]
  expense_breakdown JSONB,                           -- [{ "label": ..., "fils": ... }]
  source            TEXT NOT NULL DEFAULT 'quickbooks',
  note              TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Historical customers (from QuickBooks) ──────────────────────────────────
-- The business's real customer book (≈595 contacts) lived only in QuickBooks —
-- every party was sold on WhatsApp. We migrate it here (name, phone(s), email,
-- emirate) so the CRM and marketing (anniversary/past-customer campaigns) can
-- reach them, WITHOUT polluting the live `customers` table that drives accounts,
-- loyalty and bookings. Deduped by phone where present, else by lower(name).
-- Data is piped straight from the owner's QuickBooks browser into this table via
-- the import endpoint; it never passes through a third party.
CREATE TABLE IF NOT EXISTS historical_customers (
  id           BIGSERIAL PRIMARY KEY,
  full_name    TEXT NOT NULL,
  phone        TEXT,
  phone_alt    TEXT,
  email        TEXT,
  emirate      TEXT,
  bill_address TEXT,
  ship_address TEXT,
  dedupe_key   TEXT NOT NULL,          -- lower(phone digits) or lower(name)
  source       TEXT NOT NULL DEFAULT 'quickbooks',
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS historical_customers_dedupe_idx ON historical_customers (dedupe_key);
CREATE INDEX IF NOT EXISTS historical_customers_emirate_idx ON historical_customers (emirate);

-- ── Historical orders / invoices (from QuickBooks) ───────────────────────────
-- Every invoice the business raised (all WhatsApp sales) lived only in
-- QuickBooks. We migrate them here so the dashboard can show real order history,
-- reconstruct revenue per year, and reconcile discounts against what was charged
-- — kept separate from live `orders` (which drive live payments/production).
-- Amounts are fils. dedupe_key is the QuickBooks document number (or a synthetic
-- key) so re-running the import updates rather than duplicates.
CREATE TABLE IF NOT EXISTS historical_orders (
  id            BIGSERIAL PRIMARY KEY,
  doc_number    TEXT,                    -- QuickBooks invoice/sales-receipt no.
  txn_type      TEXT,                    -- Invoice | Sales Receipt | Payment | ...
  customer_name TEXT,
  txn_date      DATE,
  product       TEXT,                    -- product/service (e.g. package name)
  memo          TEXT,
  subtotal_fils BIGINT NOT NULL DEFAULT 0,
  discount_fils BIGINT NOT NULL DEFAULT 0,
  tax_fils      BIGINT NOT NULL DEFAULT 0,
  total_fils    BIGINT NOT NULL DEFAULT 0,
  status        TEXT,                    -- Paid | Open | Overdue | ...
  dedupe_key    TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'quickbooks',
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS historical_orders_dedupe_idx ON historical_orders (dedupe_key);
CREATE INDEX IF NOT EXISTS historical_orders_date_idx ON historical_orders (txn_date);

-- ── Finance module (a simple QuickBooks-style set inside the dashboard) ──────
-- Two documents drive Sales & Get Paid:
--   * finance_invoices  — billed, not yet paid → Accounts Receivable.
--   * finance_receipts  — a paid sale → Cash on hand.
-- Both carry their line items as JSONB ([{name, qty, priceFils, amountFils}]),
-- a discount and shipping amount, and a derived total. Numbers come from one
-- shared sequence so invoice/receipt numbers never collide (continuing past the
-- imported QuickBooks history). Customers reference the migrated book.
CREATE SEQUENCE IF NOT EXISTS finance_doc_seq START 1700;
-- Separate running numbers for invoices vs sales receipts (QuickBooks keeps two
-- independent sequences). Aligned to the real max on boot (alignFinanceSequences)
-- so a new document never duplicates a migrated QuickBooks number.
CREATE SEQUENCE IF NOT EXISTS finance_invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS finance_receipt_seq START 1;

CREATE TABLE IF NOT EXISTS finance_invoices (
  id            BIGSERIAL PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  customer_id   BIGINT REFERENCES historical_customers(id),
  customer_name TEXT NOT NULL,
  issue_date    DATE NOT NULL DEFAULT current_date,
  due_date      DATE,
  line_items    JSONB NOT NULL DEFAULT '[]',
  subtotal_fils BIGINT NOT NULL DEFAULT 0,
  discount_fils BIGINT NOT NULL DEFAULT 0,
  shipping_fils BIGINT NOT NULL DEFAULT 0,
  total_fils    BIGINT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | viewed | paid | overdue
  message       TEXT,
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_invoices_status_idx ON finance_invoices (status, due_date);
-- Sales commission: who brought this corporate/events invoice (e.g. Marsha).
-- Marsha earns 2% of her tagged docs worth ≥ AED 20,000 (events-based only).
-- Set only on MANUAL invoices/receipts the owner approves — never website orders.
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS commission_rep TEXT;
-- Marks invoices carried over from the QuickBooks migration, so (like receipts)
-- they are not double-counted against the Cash-on-hand opening balance.
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source TEXT;
-- Party details echoed on the invoice (mirrors finance_receipts).
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS event_for TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS theme TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS age TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS event_time TEXT;

CREATE TABLE IF NOT EXISTS finance_receipts (
  id            BIGSERIAL PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  customer_id   BIGINT REFERENCES historical_customers(id),
  customer_name TEXT NOT NULL,
  date          DATE NOT NULL DEFAULT current_date,
  line_items    JSONB NOT NULL DEFAULT '[]',
  subtotal_fils BIGINT NOT NULL DEFAULT 0,
  discount_fils BIGINT NOT NULL DEFAULT 0,
  shipping_fils BIGINT NOT NULL DEFAULT 0,
  total_fils    BIGINT NOT NULL DEFAULT 0,
  paid_with     TEXT NOT NULL DEFAULT 'Cash',
  message       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_receipts_date_idx ON finance_receipts (date DESC);
-- 'quickbooks' rows are the migrated history — already baked into the Cash on
-- hand opening balance, so they populate the list but must NOT move the balance
-- again. 'dashboard' rows are new sales made here and DO move Cash on hand.
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'dashboard';
-- The party details a receipt should echo (QuickBooks never had these): the
-- guest-of-honour / baby name and the chosen theme.
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS event_for TEXT;
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS theme TEXT;
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS age TEXT;
-- The party START TIME the receipt should show (the "date" column already holds
-- the event/sale date). Stored as "HH:MM" 24h text, like events.start_time.
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS event_time TEXT;
-- The customer hasn't chosen an event date yet: show "TBD" instead of the
-- placeholder date, on the receipt and in the app.
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS date_tbd BOOLEAN NOT NULL DEFAULT FALSE;
-- When an upcoming sale is turned into an operational event, we link it here so
-- it is never converted twice.
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS event_id TEXT;
-- Link back to the source order so every paid order (web / app / shop / manual
-- pay-link) auto-appears here as a sale exactly once. Partial-unique so manual
-- dashboard receipts (no order) are unaffected.
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS order_id TEXT;
-- Sales commission on a MANUAL sale the owner approves (e.g. Marsha's corporate deal).
ALTER TABLE finance_receipts ADD COLUMN IF NOT EXISTS commission_rep TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS finance_receipts_order_idx
  ON finance_receipts (order_id) WHERE order_id IS NOT NULL;

-- Manual-order "offers": the team picks the products/package/add-ons only, and
-- the customer opens a unique link, fills in ALL their own details on the normal
-- checkout, and pays. The offer just carries the chosen items + price; a booking
-- is a normal order created by the customer (source 'manual'). One offer yields
-- at most one confirmed booking (status flips to 'used' on payment).
CREATE TABLE IF NOT EXISTS manual_offers (
  token            TEXT PRIMARY KEY,
  celebration_type TEXT NOT NULL,
  package_id       TEXT,
  services         JSONB NOT NULL DEFAULT '[]',   -- [{serviceId, quantity}]
  theme_id         TEXT,
  subtotal_fils    BIGINT NOT NULL DEFAULT 0,      -- items only (delivery added at checkout)
  status           TEXT NOT NULL DEFAULT 'open',   -- open | used
  order_id         TEXT,                           -- the confirmed booking, once paid
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Manual price overrides the team can set on an offer: a discount, a fixed
-- delivery value (overrides the emirate-based calc when set), and a manual
-- custom-theme charge. NULL delivery = use the normal automatic delivery.
ALTER TABLE manual_offers ADD COLUMN IF NOT EXISTS discount_fils     BIGINT NOT NULL DEFAULT 0;
ALTER TABLE manual_offers ADD COLUMN IF NOT EXISTS delivery_fils     BIGINT;
ALTER TABLE manual_offers ADD COLUMN IF NOT EXISTS custom_theme_fils BIGINT NOT NULL DEFAULT 0;
-- Ad-hoc products the team typed in that aren't in the catalogue: [{name, priceFils, qty}].
ALTER TABLE manual_offers ADD COLUMN IF NOT EXISTS custom_items JSONB NOT NULL DEFAULT '[]';
-- Reference images the team attached, carried onto the booking so the design
-- team sees them on the event/task: [url, …].
ALTER TABLE manual_offers ADD COLUMN IF NOT EXISTS ref_images JSONB NOT NULL DEFAULT '[]';

-- Extra fields on the existing expense log to match the QuickBooks expense form.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS ref_no TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax_fils BIGINT NOT NULL DEFAULT 0;

-- Cash on hand opening balance (the QuickBooks figure at migration time). The
-- live balance = this + receipts + collected invoices − expenses.
INSERT INTO settings (key, value) VALUES ('finance.cashOpeningFils', '13690395'::jsonb)
  ON CONFLICT (key) DO NOTHING;

-- Total expenses per year, summed from a QuickBooks expense report on import.
-- Kept apart from the invoice income so the dashboard can compute real profit
-- per year = (revenue from invoices) − (expenses here), for every year we have.
CREATE TABLE IF NOT EXISTS expense_years (
  year          INT PRIMARY KEY,
  expenses_fils BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: FY2026 year-to-date (Jan 1 – Aug 26 2026), taken straight from the
-- owner's QuickBooks "Profit and Loss by Month" report. ON CONFLICT DO NOTHING
-- so a later dashboard edit (or a full-year restate) is never clobbered on boot.
INSERT INTO historical_financials
  (period, period_kind, income_fils, cogs_fils, expenses_fils, gross_profit_fils, net_income_fils, income_breakdown, expense_breakdown, source, note)
VALUES (
  '2026', 'year',
  47562070, 2419132, 21695279, 45142938, 23447659,
  '[{"label":"Service/Fee Income","fils":42168100},{"label":"Services","fils":9953400},{"label":"Shipping & delivery income","fils":1409970},{"label":"Kids events packages","fils":399900},{"label":"Revenue - general","fils":110000},{"label":"Uncategorised income","fils":30000},{"label":"Discounts given","fils":-6509300}]'::jsonb,
  '[{"label":"Purchase (stock/materials)","fils":8992160},{"label":"Supplies","fils":5357808},{"label":"Stationery & printing","fils":2997200},{"label":"Advertising","fils":1764180},{"label":"Other general & admin","fils":906972},{"label":"Meals & entertainment","fils":601009},{"label":"Payroll","fils":504500},{"label":"Repairs & maintenance","fils":150745},{"label":"Dues & subscriptions","fils":129705},{"label":"Equipment rental","fils":105000},{"label":"Office expenses","fils":100000},{"label":"Travel","fils":86000}]'::jsonb,
  'quickbooks',
  'FY2026 year-to-date (Jan 1 – Aug 26 2026), from QuickBooks Profit & Loss.'
) ON CONFLICT (period) DO NOTHING;

-- ── Smart staff assignment ──────────────────────────────────────────────────
-- Which skills each internal staff member holds (see the staffing rules memo).
CREATE TABLE IF NOT EXISTS staff_skills (
  member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  skill     TEXT NOT NULL,   -- face_painting | clown | helper | balloon_artist | balloon_twisting | design | leader
  PRIMARY KEY (member_id, skill)
);

-- One staffing slot per required role on an event. The auto-assign engine fills
-- assignee_id from internal staff first; a slot with no internal fit becomes
-- 'part_time_required' until the manager enters part_time_name.
CREATE TABLE IF NOT EXISTS event_staff (
  id             BIGSERIAL PRIMARY KEY,
  event_id       TEXT NOT NULL,
  role           TEXT NOT NULL,        -- skill/role for this slot
  slot           INT  NOT NULL DEFAULT 1,
  assignee_id    TEXT,                 -- internal team_member id, when assigned
  part_time_name TEXT,                 -- entered by owner/manager for a part-timer
  is_leader      BOOLEAN NOT NULL DEFAULT FALSE,
  status         TEXT NOT NULL DEFAULT 'to_confirm', -- to_confirm | assigned | part_time_required | confirmed
  reason         TEXT,
  source         TEXT,                 -- which service/package created this slot
  needs_design   BOOLEAN NOT NULL DEFAULT FALSE,     -- Marsha design step
  start_min      INT,                  -- optional operational window (minutes from midnight)
  end_min        INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_staff_event_idx ON event_staff (event_id);
CREATE INDEX IF NOT EXISTS event_staff_assignee_idx ON event_staff (assignee_id);

-- Manual staffing requirements the owner/manager adds for an event the engine
-- can't read automatically — e.g. a custom "AED 2,900 Offer" that needs
-- 1 balloon artist + 2 clowns. Read on top of the derived requirements.
CREATE TABLE IF NOT EXISTS event_manual_staff (
  event_id  TEXT NOT NULL,
  role      TEXT NOT NULL,
  count     INT  NOT NULL DEFAULT 1,
  PRIMARY KEY (event_id, role)
);

-- Pre-event preparation tasks (INTERNAL ONLY — never shown to the customer).
-- Auto-generated from a confirmed order's package/services/theme, fair-assigned
-- to qualified staff. Design tasks (Marsha) gate the physical prep that follows.
CREATE TABLE IF NOT EXISTS prep_tasks (
  id            BIGSERIAL PRIMARY KEY,
  event_id      TEXT NOT NULL,
  key           TEXT NOT NULL,             -- template key, unique per event
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'physical', -- design | physical
  skill         TEXT,                      -- prep-skill the assignee must have
  people_needed INT  NOT NULL DEFAULT 1,
  depends_on_key TEXT,                      -- design task this waits on (dependency)
  due_date      DATE,
  status        TEXT NOT NULL DEFAULT 'not_started', -- not_started | in_progress | waiting_design | ready | completed | issue
  notes         TEXT,
  checklist     JSONB,                     -- [{ label, done }]
  photo_url     TEXT,                      -- proof of preparation
  completed_by  TEXT,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, key)
);
CREATE INDEX IF NOT EXISTS prep_tasks_event_idx ON prep_tasks (event_id);
CREATE INDEX IF NOT EXISTS prep_tasks_status_idx ON prep_tasks (status);

-- Who is assigned to each prep task (many, for two-person tasks).
CREATE TABLE IF NOT EXISTS prep_task_staff (
  task_id   BIGINT NOT NULL,
  member_id TEXT NOT NULL,
  PRIMARY KEY (task_id, member_id)
);
CREATE INDEX IF NOT EXISTS prep_task_staff_member_idx ON prep_task_staff (member_id);

-- Shop order fulfilment (printed / digital goods, no party): Marsha designs it,
-- the owner approves, then it's emailed to the customer. INTERNAL until sent.
CREATE TABLE IF NOT EXISTS shop_designs (
  order_id    TEXT PRIMARY KEY,
  image_url   TEXT,
  status      TEXT NOT NULL DEFAULT 'awaiting_design', -- awaiting_design | design_ready | sent
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Activity log for prep-task changes (assignment overrides, completion, issues).
CREATE TABLE IF NOT EXISTS prep_task_log (
  id         BIGSERIAL PRIMARY KEY,
  task_id    BIGINT,
  event_id   TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  actor      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Refunds (tracked, and decoupled from cancellation) ──────────────────────
-- A refund is NOT always a cancellation: a completed event can be partially
-- refunded for a quality issue or a missing item without cancelling anything.
-- Every money-out is logged here with a structured reason so the business can
-- see how many refunds are the customer's choice vs. our own service problems.
CREATE TABLE IF NOT EXISTS refunds (
  id                 BIGSERIAL PRIMARY KEY,
  order_id           TEXT NOT NULL,
  event_id           TEXT,
  customer_id        TEXT,
  amount_fils        BIGINT NOT NULL,
  reason_category    TEXT NOT NULL DEFAULT 'other',  -- customer_cancellation | quality_issue | missing_item | other
  reason_note        TEXT,
  event_cancelled    BOOLEAN NOT NULL DEFAULT FALSE,
  provider_reference TEXT,
  created_by         TEXT,                            -- staff name | 'customer' | 'system'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_order_idx  ON refunds (order_id);
CREATE INDEX IF NOT EXISTS refunds_reason_idx ON refunds (reason_category, created_at);

-- ── Staff rewards (Achievements) ────────────────────────────────────────────
-- A recorded reward a staff member earned — most importantly the "good customer
-- feedback" reward. Recorded (not just computed) so the employee can see each
-- one with its event, date, amount and the feedback that earned it, and so the
-- amount is frozen at the settings value at the time it was earned. The UNIQUE
-- key makes a re-submitted / refreshed feedback idempotent (never paid twice).
CREATE TABLE IF NOT EXISTS staff_rewards (
  id          BIGSERIAL PRIMARY KEY,
  member_id   TEXT NOT NULL,
  event_id    TEXT,
  kind        TEXT NOT NULL,            -- good_feedback | glam_doll | event_incentive
  amount_fils BIGINT NOT NULL DEFAULT 0,
  note        TEXT,                      -- e.g. the feedback text / context
  source_ref  TEXT,                      -- e.g. rating id — the dedupe anchor
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, source_ref, member_id)
);
CREATE INDEX IF NOT EXISTS staff_rewards_member_idx ON staff_rewards (member_id, created_at DESC);

-- ── Staff referral codes ────────────────────────────────────────────────────
-- A personal code a crew member gives to a client they bring in. The customer
-- enters it at checkout (in the promo field). It gives the CUSTOMER no discount
-- — it credits the STAFF member `percent`% of the event value (excluding
-- delivery) once the booking is paid, recorded in staff_rewards (kind
-- 'referral', source_ref = order id, so it can never double-pay). Events only,
-- never standalone shop purchases.
CREATE TABLE IF NOT EXISTS staff_referral_codes (
  code        TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  percent     INT  NOT NULL DEFAULT 5 CHECK (percent >= 0 AND percent <= 100),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_referral_codes_member_idx ON staff_referral_codes (member_id);

-- Events a crew member brought in (their referral code was used at checkout).
-- Drives their VALUE-BASED points: event value excl. delivery × 0.5 (a 4,000
-- AED event = 2,000 points), which count toward the monthly target and, above
-- it, convert to money like any other points. One row per (order, member);
-- recorded when the booking is paid.
CREATE TABLE IF NOT EXISTS staff_referral_events (
  id               BIGSERIAL PRIMARY KEY,
  order_id         TEXT NOT NULL,
  event_id         TEXT,
  member_id        TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  event_value_fils BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, member_id)
);
CREATE INDEX IF NOT EXISTS staff_referral_events_member_idx ON staff_referral_events (member_id, created_at);

-- ── Audit log (critical actions) ────────────────────────────────────────────
-- An append-only trail of sensitive actions (refunds, cancellations, customer
-- edits, config/incentive changes, reconciliation runs) — who did what, when,
-- to which record. The foundation for the security review; logins join it once
-- the email/password system lands.
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,            -- staff name / 'owner' / 'system'
  role       TEXT,
  action     TEXT NOT NULL,            -- refund | cancel_event | customer_update | incentive_rules | reconcile | ...
  target     TEXT,                     -- order/event/customer id
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx  ON audit_log (action, created_at DESC);

-- ── Staff email/password login (additive to the token system) ───────────────
-- Staff sign in with email + password; the personal access_token and the master
-- owner token keep working as a fallback until the owner disables them, so no
-- one is ever locked out during the switch.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS must_set_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
-- Case-insensitive unique email so login is unambiguous (only when set).
CREATE UNIQUE INDEX IF NOT EXISTS team_members_email_idx ON team_members (lower(email)) WHERE email IS NOT NULL AND email <> '';

-- ── Asset issue reports (field → manager/owner) ─────────────────────────────
-- Any staff member can report a durable asset as broken / damaged / needing
-- maintenance from the Inventory list. The report surfaces to the manager and
-- owner (Updates + notification bell) so they can act, then mark it resolved.
CREATE TABLE IF NOT EXISTS asset_issues (
  id          BIGSERIAL PRIMARY KEY,
  asset_code  TEXT NOT NULL,
  asset_name  TEXT,
  kind        TEXT NOT NULL,             -- broken | damaged | maintenance | other
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open',   -- open | in_progress | resolved
  reported_by TEXT,
  resolved_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS asset_issues_status_idx ON asset_issues (status, created_at DESC);

-- ── Staff profile (self-service personal details + manager feedback) ─────────
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS passport_name TEXT;      -- full name as on passport
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS passport_number TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS emirates_id TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS performance_feedback TEXT;   -- latest note from the manager
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS performance_by TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS performance_at TIMESTAMPTZ;

-- Seed canonical job titles (only where not already set, so manager edits win).
UPDATE team_members SET job_title = 'Operations & Sales Coordinator' WHERE lower(name) = 'marsha' AND job_title IS NULL;
UPDATE team_members SET job_title = 'Senior Balloon Artist'          WHERE lower(name) = 'dindo'  AND job_title IS NULL;
UPDATE team_members SET job_title = 'Senior Balloon Artist'          WHERE lower(name) = 'jane'   AND job_title IS NULL;
UPDATE team_members SET job_title = 'Junior Event Coordinator'       WHERE lower(name) = 'gloria' AND job_title IS NULL;
UPDATE team_members SET job_title = 'Junior Event Coordinator'       WHERE lower(name) = 'diana'  AND job_title IS NULL;
UPDATE team_members SET job_title = 'CEO'                            WHERE lower(name) = 'sheem'  AND job_title IS NULL;
UPDATE team_members SET job_title = 'Driver & Event Support'         WHERE lower(name) = 'shan'   AND job_title IS NULL;

-- ── Finance custom products/services (added on the fly from a receipt/invoice) ─
-- Reusable line items the team creates while billing, beyond the catalogue
-- packages/services. Saved so they appear in the item picker next time.
CREATE TABLE IF NOT EXISTS finance_items (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  price_fils BIGINT NOT NULL DEFAULT 0,
  created_by TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE finance_items ADD COLUMN IF NOT EXISTS description TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS finance_items_name_idx ON finance_items (lower(name));

-- QuickBooks Online OAuth connection (single row: id=1). Tokens are stored so
-- the server can call the QuickBooks API on the company's behalf and refresh
-- without re-consent. Only the owner ever triggers connect/disconnect.
CREATE TABLE IF NOT EXISTS quickbooks_connection (
  id            INT PRIMARY KEY DEFAULT 1,
  realm_id      TEXT NOT NULL,            -- the connected company id
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,     -- access-token expiry
  refresh_expires_at TIMESTAMPTZ,         -- refresh-token expiry (~100 days)
  environment   TEXT NOT NULL DEFAULT 'sandbox',
  connected_by  TEXT,
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quickbooks_connection_singleton CHECK (id = 1)
);

-- Suppliers directory: who we buy from, how to reach them, and what they supply.
CREATE TABLE IF NOT EXISTS suppliers (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  contact    TEXT,
  phone      TEXT,
  email      TEXT,
  supplies   TEXT,
  note       TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
