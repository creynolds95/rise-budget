-- Surplus projects only schedules the user confirmed. Sync detects candidates in the cash
-- accounts and saves them here for review, so the Surplus page never re-scans history.
-- Rebuilt whole on each refresh; one row per merchant.
CREATE TABLE surplus_suggestion (
  id                    TEXT PRIMARY KEY,   -- user_id|merchant_normalized
  user_id               TEXT NOT NULL REFERENCES user(id),
  merchant_normalized   TEXT NOT NULL,
  account_id            TEXT NOT NULL,
  cadence               TEXT NOT NULL,
  expected_amount_cents INTEGER NOT NULL,   -- SPEC §1.1 sign: negative = income
  next_expected_date    TEXT NOT NULL,
  anchor_days           TEXT,               -- JSON [d1,d2], semimonthly only
  updated_at            TEXT NOT NULL
);
CREATE INDEX ix_surplus_suggestion_user ON surplus_suggestion(user_id);
