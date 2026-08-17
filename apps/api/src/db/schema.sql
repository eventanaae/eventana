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
