-- A Surplus schedule the bank balance already shows, before its transaction reaches Rise,
-- and how many days its transaction usually trails the balance (learned).
ALTER TABLE recurring_series ADD COLUMN balance_seen_due TEXT;
ALTER TABLE recurring_series ADD COLUMN balance_seen_on TEXT;
ALTER TABLE recurring_series ADD COLUMN balance_seen_twice INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recurring_series ADD COLUMN balance_lag_days INTEGER;
