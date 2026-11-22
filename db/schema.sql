-- Halo Admin database schema (PostgreSQL / Neon).
-- Applied by `npm run migrate` (src/migrate.js). Safe to run more than once: tables and indexes are only
-- created if they don't exist yet ("IF NOT EXISTS"), and the settings row is only inserted once.
--
-- Column types used below:
--   uuid          random unique id (gen_random_uuid() creates one automatically)
--   numeric(14,2) exact money amount with 2 decimals (never use floating point for money)
--   timestamptz   date + time with time zone
--   CHECK (...)   the database refuses values outside the listed ones

-- users: one row per app user, with their two wallet balances, VIP level and KYC/account status.
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
-- Indexes make lookups by these columns fast.
CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone);

-- transactions: deposits and withdrawals (column "type"). The admin approves pending withdrawals.
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

-- kyc_requests: identity documents users submitted; the admin approves or rejects them (KYC review page).
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

-- banners: the promotional banners in the user app – "popup" (shown after login) or "home" (home carousel).
-- sort_order is the position on screen (0 = first).
CREATE TABLE IF NOT EXISTS banners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('popup','home')),
  title       text NOT NULL,
  subtitle    text NOT NULL DEFAULT '',
  is_live     boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0
);

-- balance_adjustments: a record of every manual credit/debit an admin made to a user's wallet, with the reason.
CREATE TABLE IF NOT EXISTS balance_adjustments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet      text NOT NULL CHECK (wallet IN ('flexible','active')),
  note        text NOT NULL,
  amount      numeric(14,2) NOT NULL,            -- signed: + credit, - debit
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS adjustments_user_idx ON balance_adjustments (user_id, created_at DESC);

-- orders: demo order records from the prototype; only the sum of "fee" is used (dashboard card).
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

-- settings: platform-wide settings in a single row (key = 'global'): minimums, maintenance mode,
-- Telegram links and the announcement ticker text. The INSERT below creates that row the first time.
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

-- =========================================================================
-- User app accounts, wallets and payments (B-Infinity)
-- =========================================================================

-- Login details for user accounts. Passwords are stored only as scrypt hashes (see src/auth/passwords.js).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_iso text NOT NULL DEFAULT 'us';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fund_password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code text;
-- Raised on logout so that tokens issued before the logout stop working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_country_unique ON users (country_iso, phone);
CREATE UNIQUE INDEX IF NOT EXISTS users_invite_code_unique ON users (invite_code) WHERE invite_code IS NOT NULL;

-- Deposits and withdrawals: fee charged, when a deposit address expires.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expires_at timestamptz;
-- "Expired" is set when a deposit address runs out of time before anyone pays.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('Pending','Paid','Credited','Rejected','Expired'));

-- KYC: the user's details and the two ID photos (stored as data URLs for now).
ALTER TABLE kyc_requests ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '';
ALTER TABLE kyc_requests ADD COLUMN IF NOT EXISTS front_image text;
ALTER TABLE kyc_requests ADD COLUMN IF NOT EXISTS back_image text;
ALTER TABLE kyc_requests ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- Wallet ledger: every change to a user's Flexible or Active balance made by the user app
-- (deposit credits, withdrawal holds and refunds, transfers). Amounts are signed: + in, - out.
CREATE TABLE IF NOT EXISTS wallet_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet      text NOT NULL CHECK (wallet IN ('flexible','active')),
  kind        text NOT NULL CHECK (kind IN ('recharge','withdrawal','withdrawal_refund',
                                             'transfer_in','transfer_out',
                                             'wallet_transfer_in','wallet_transfer_out')),
  amount      numeric(14,2) NOT NULL,
  reference   text NOT NULL DEFAULT '',
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_entries_user_idx ON wallet_entries (user_id, created_at DESC);
