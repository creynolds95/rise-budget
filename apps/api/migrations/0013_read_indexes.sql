-- D1 bills rows scanned, and the free tier allows 5M a day. Transaction lists sort newest
-- first and stop at a page, so each needs an index that already holds that order; without
-- one SQLite read the whole history and sorted it on every Dashboard load.
CREATE INDEX IF NOT EXISTS ix_txn_user_date ON txn(user_id, posted_at DESC, id DESC);

DROP INDEX IF EXISTS ix_txn_review;
CREATE INDEX ix_txn_review ON txn(user_id, review_state, posted_at DESC, id DESC);

DROP INDEX IF EXISTS ix_txn_account_date;
CREATE INDEX ix_txn_account_date ON txn(user_id, account_id, posted_at DESC, id DESC);
