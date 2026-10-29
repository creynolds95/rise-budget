-- The Monarch import asks, for each imported row, "does this account's bank feed start on or
-- before this day?". Through ix_txn_account_date that walks every earlier row on the account
-- looking for a SimpleFIN one, and history rows have none: a range scan per row, quadratic in
-- the history. 3,000 rows on one account read ~4.5M rows in one request, and Settings → Your
-- data ran it on every visit. With only bank-feed rows in the index, the answer is the first
-- entry of the account's range: one row read.
CREATE INDEX IF NOT EXISTS ix_txn_feed ON txn(user_id, account_id, posted_at)
  WHERE source = 'simplefin' AND review_state != 'dropped';
-- Import dedupe looks up imported rows by source id; without this it read every transaction
-- the user has, twice per 100-row chunk.
CREATE INDEX IF NOT EXISTS ix_txn_csv_source ON txn(user_id, source_id) WHERE source = 'csv';
