-- Migration 0001 — full schema, verbatim from docs/ARCHITECTURE.md §3.
-- Money is INTEGER cents. Every user-data table carries user_id.

CREATE TABLE user (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  timezone          TEXT NOT NULL DEFAULT 'America/Chicago',
  settings_json     TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL
);

-- ── auth ──────────────────────────────────────────────────────────────────
CREATE TABLE credential (            -- WebAuthn passkeys
  id                TEXT PRIMARY KEY,          -- credential ID (base64url)
  user_id           TEXT NOT NULL REFERENCES user(id),
  public_key        BLOB NOT NULL,
  counter           INTEGER NOT NULL DEFAULT 0,
  transports        TEXT,
  device_label      TEXT,
  created_at        TEXT NOT NULL,
  last_used_at      TEXT
);

CREATE TABLE totp_secret (
  user_id           TEXT PRIMARY KEY REFERENCES user(id),
  secret_enc        TEXT NOT NULL,
  confirmed_at      TEXT
);

CREATE TABLE recovery_code (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  code_hash         TEXT NOT NULL,
  used_at           TEXT
);

CREATE TABLE session (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  refresh_hash      TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  revoked_at        TEXT,
  created_at        TEXT NOT NULL
);

-- ── accounts ──────────────────────────────────────────────────────────────
CREATE TABLE account (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES user(id),
  name                  TEXT NOT NULL,
  kind                  TEXT NOT NULL,   -- depository|credit|loan|investment|other
  source                TEXT NOT NULL,   -- simplefin|manual
  source_account_id     TEXT,            -- SimpleFIN account id
  institution_name      TEXT,
  mask                  TEXT,
  currency              TEXT NOT NULL DEFAULT 'USD',
  balance_cents         INTEGER NOT NULL DEFAULT 0,
  include_in_net_worth  INTEGER NOT NULL DEFAULT 1,
  include_in_budget     INTEGER NOT NULL DEFAULT 1,
  expected_payment_cents INTEGER,        -- loans
  payment_day           INTEGER,
  sync_cadence_hours    INTEGER,         -- expected freshness; drives staleness warnings
  last_synced_at        TEXT,
  archived_at           TEXT,
  created_at            TEXT NOT NULL,
  UNIQUE(user_id, source, source_account_id)
);

CREATE TABLE balance_snapshot (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  account_id        TEXT NOT NULL REFERENCES account(id),
  as_of             TEXT NOT NULL,
  balance_cents     INTEGER NOT NULL,
  source            TEXT NOT NULL,       -- manual|sync
  created_at        TEXT NOT NULL,
  UNIQUE(account_id, as_of)
);

-- ── categories ────────────────────────────────────────────────────────────
CREATE TABLE category_group (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL,       -- income|expense
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE category (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  group_id          TEXT NOT NULL REFERENCES category_group(id),
  name              TEXT NOT NULL,
  emoji             TEXT,
  rollover_policy   TEXT NOT NULL DEFAULT 'roll',   -- roll|return_to_pool
  spend_shape       TEXT NOT NULL DEFAULT 'linear', -- linear|fixed
  is_bill           INTEGER NOT NULL DEFAULT 0,
  typical_post_day  INTEGER,
  archived_at       TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0
);

-- ── periods & budget ──────────────────────────────────────────────────────
CREATE TABLE period (
  id                     TEXT PRIMARY KEY,   -- '2026-09'
  user_id                TEXT NOT NULL REFERENCES user(id),
  status                 TEXT NOT NULL DEFAULT 'open',  -- open|closed
  expected_income_cents  INTEGER NOT NULL DEFAULT 0,
  returned_surplus_cents INTEGER NOT NULL DEFAULT 0,
  needs_recalc           INTEGER NOT NULL DEFAULT 0,
  recalc_delta_cents     INTEGER NOT NULL DEFAULT 0,
  closed_at              TEXT,
  UNIQUE(user_id, id)
);

CREATE TABLE allocation (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  period_id         TEXT NOT NULL REFERENCES period(id),
  category_id       TEXT NOT NULL REFERENCES category(id),
  planned_cents     INTEGER NOT NULL DEFAULT 0,
  carried_in_cents  INTEGER NOT NULL DEFAULT 0,   -- FROZEN at close; never recomputed implicitly
  UNIQUE(period_id, category_id)
);

CREATE TABLE reallocation (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  period_id         TEXT NOT NULL REFERENCES period(id),
  from_category_id  TEXT REFERENCES category(id),   -- NULL = pool
  to_category_id    TEXT REFERENCES category(id),   -- NULL = pool
  amount_cents      INTEGER NOT NULL,
  note              TEXT,
  created_at        TEXT NOT NULL
);

-- ── transactions ──────────────────────────────────────────────────────────
CREATE TABLE txn (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES user(id),
  account_id             TEXT NOT NULL REFERENCES account(id),
  posted_at              TEXT NOT NULL,
  amount_cents           INTEGER NOT NULL,   -- expense positive, income negative
  descriptor_raw         TEXT NOT NULL,
  merchant_normalized    TEXT NOT NULL,
  merchant_display       TEXT,
  notes                  TEXT,
  is_pending             INTEGER NOT NULL DEFAULT 0,
  is_transfer            INTEGER NOT NULL DEFAULT 0,
  transfer_pair_id       TEXT REFERENCES txn(id),
  review_state           TEXT NOT NULL DEFAULT 'needs_review', -- needs_review|reviewed|dropped
  suggested_category_id  TEXT REFERENCES category(id),
  suggestion_confidence  REAL NOT NULL DEFAULT 0,
  source                 TEXT NOT NULL,      -- simplefin|ofx|csv|manual
  source_id              TEXT,               -- SimpleFIN txn id / OFX FITID
  dedupe_hash            TEXT,               -- CSV composite hash
  dedupe_ordinal         INTEGER NOT NULL DEFAULT 0,
  import_batch_id        TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_txn_source  ON txn(account_id, source, source_id)
  WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX ux_txn_dedupe  ON txn(account_id, dedupe_hash, dedupe_ordinal)
  WHERE dedupe_hash IS NOT NULL;
CREATE INDEX ix_txn_account_date   ON txn(user_id, account_id, posted_at DESC);
CREATE INDEX ix_txn_review         ON txn(user_id, review_state, posted_at DESC);
CREATE INDEX ix_txn_merchant       ON txn(user_id, merchant_normalized);

CREATE TABLE split (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  txn_id            TEXT NOT NULL REFERENCES txn(id) ON DELETE CASCADE,
  category_id       TEXT NOT NULL REFERENCES category(id),
  amount_cents      INTEGER NOT NULL,
  period_id         TEXT NOT NULL,          -- denormalised from txn.posted_at for fast reports
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_split_period_cat ON split(user_id, period_id, category_id);

-- ── categorisation ────────────────────────────────────────────────────────
CREATE TABLE rule (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  match_field       TEXT NOT NULL,       -- descriptor|merchant
  match_type        TEXT NOT NULL,       -- contains|equals|regex
  match_value       TEXT NOT NULL,
  category_id       TEXT NOT NULL REFERENCES category(id),
  priority          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE TABLE merchant_memory (
  user_id             TEXT NOT NULL REFERENCES user(id),
  merchant_normalized TEXT NOT NULL,
  category_id         TEXT NOT NULL REFERENCES category(id),
  count               INTEGER NOT NULL DEFAULT 0,
  last_used_at        TEXT,
  PRIMARY KEY (user_id, merchant_normalized, category_id)
);

CREATE TABLE merchant_meta (
  user_id             TEXT NOT NULL REFERENCES user(id),
  merchant_normalized TEXT NOT NULL,
  display_name        TEXT,
  suppress_rule_offer INTEGER NOT NULL DEFAULT 0,
  consecutive_same    INTEGER NOT NULL DEFAULT 0,
  consecutive_cat_id  TEXT,
  PRIMARY KEY (user_id, merchant_normalized)
);

CREATE TABLE recurring_series (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES user(id),
  merchant_normalized TEXT NOT NULL,
  category_id         TEXT REFERENCES category(id),
  cadence             TEXT NOT NULL,      -- weekly|biweekly|monthly|annual
  expected_amount_cents INTEGER NOT NULL,
  next_expected_date  TEXT,
  status              TEXT NOT NULL DEFAULT 'active',  -- active|broken|ended
  updated_at          TEXT NOT NULL
);

-- ── operations ────────────────────────────────────────────────────────────
CREATE TABLE sync_run (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  status            TEXT NOT NULL,       -- running|ok|partial|failed
  accounts_touched  INTEGER NOT NULL DEFAULT 0,
  rows_inserted     INTEGER NOT NULL DEFAULT 0,
  rows_updated      INTEGER NOT NULL DEFAULT 0,
  error_json        TEXT
);

CREATE TABLE import_batch (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  account_id        TEXT NOT NULL REFERENCES account(id),
  filename          TEXT NOT NULL,
  format            TEXT NOT NULL,       -- csv|ofx|qfx
  rows_total        INTEGER NOT NULL,
  rows_imported     INTEGER NOT NULL,
  rows_duplicate    INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE audit_log (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  action            TEXT NOT NULL,
  target_type       TEXT,
  target_id         TEXT,
  detail_json       TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE idempotency (
  key               TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  response_json     TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE period_aggregate (        -- precomputed; keeps multi-year reports under 10ms CPU
  user_id           TEXT NOT NULL REFERENCES user(id),
  period_id         TEXT NOT NULL,
  category_id       TEXT NOT NULL,
  spent_cents       INTEGER NOT NULL,
  txn_count         INTEGER NOT NULL,
  PRIMARY KEY (user_id, period_id, category_id)
);
