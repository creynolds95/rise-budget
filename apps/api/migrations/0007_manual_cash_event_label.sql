-- Caleb: a cold-start user has no transaction history to tag "Recurring Cash Withdrawal"
-- from, so let him declare a paycheck or bill directly. Reuses `recurring_series` (same
-- shape as the transaction-tagged manual rule) with a synthetic, never-colliding
-- merchant_normalized key and this new `label` for display, since there's no real merchant.
ALTER TABLE recurring_series ADD COLUMN label TEXT;
