-- Halo Admin schema (PostgreSQL / Neon). Safe to run more than once.
CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             integer,                       -- dummy index used by the team generator
  uuid            text UNIQUE NOT NULL,
  phone           text NOT NULL,
  name            text NOT NULL DEFAULT '',
  vip             smallint NOT NULL DEFAULT 0 CHECK (vip BETWEEN 0 AND 4),
  active_balance  numeric(14,2) NOT NULL DEFAULT 0,   -- "Active strategy wallet"
  flex_balance    numeric(14,2) NOT NULL DEFAULT 0,   -- "Flexible wallet"
  team_size       integer NOT NULL DEFAULT 0,
  referrer_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  kyc_status      text NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('verified','pending','none')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  joined_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone);

CREATE TABLE IF NOT EXISTS transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id       text UNIQUE NOT NULL,
  type        text NOT NULL CHECK (type IN ('deposit','withdrawal')),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  network     text NOT NULL,
  address     text NOT NULL,
  amount      numeric(14,2) NOT NULL,
  status      text NOT NULL CHECK (status IN ('Pending','Paid','Credited','Rejected')),
  tx_hash     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_type_status_idx ON transactions (type, status);
-- Insertion order is used for list display, matching the prototype's table order.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS seq bigserial;

CREATE TABLE IF NOT EXISTS kyc_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country         text NOT NULL DEFAULT '',
  document_type   text NOT NULL DEFAULT '',
  document_number text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_status_idx ON kyc_requests (status);

CREATE TABLE IF NOT EXISTS banners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('popup','home')),
  title       text NOT NULL,
  subtitle    text NOT NULL DEFAULT '',
  is_live     boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS balance_adjustments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet      text NOT NULL CHECK (wallet IN ('flexible','active')),
  note        text NOT NULL,
  amount      numeric(14,2) NOT NULL,            -- signed: + credit, - debit
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS adjustments_user_idx ON balance_adjustments (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    text UNIQUE NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vip         smallint NOT NULL,
  amount      numeric(18,6) NOT NULL,   -- extra precision: fees are summed, then shown rounded
  total       numeric(18,6) NOT NULL,
  income      numeric(18,6) NOT NULL,
  fee         numeric(18,6) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Single-row platform settings (key = 'global').
CREATE TABLE IF NOT EXISTS settings (
  key                 text PRIMARY KEY,
  fee_percent         numeric(6,2) NOT NULL DEFAULT 30,
  trial_amount        numeric(14,2) NOT NULL DEFAULT 3,
  min_deposit         numeric(14,2) NOT NULL DEFAULT 70,
  min_withdrawal      numeric(14,2) NOT NULL DEFAULT 20,
  maint_enabled       boolean NOT NULL DEFAULT false,
  maint_hours         integer NOT NULL DEFAULT 2,
  maint_started_at    timestamptz,
  tg_official         text NOT NULL DEFAULT 'https://t.me/halo_official',
  tg_support          text NOT NULL DEFAULT 'https://t.me/halo_support',
  tg_community        text NOT NULL DEFAULT '',
  announcement_text   text NOT NULL DEFAULT 'VIP 4 is now live with QS-2 servers. Scheduled maintenance on Nov 10, 02:00 UTC.',
  announcement_live   boolean NOT NULL DEFAULT true
);
INSERT INTO settings (key) VALUES ('global') ON CONFLICT (key) DO NOTHING;
