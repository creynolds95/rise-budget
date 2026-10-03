-- Every index the queries rely on, again, in case production ever lost or never got one: a
-- missing index doesn't fail a query, it turns a lookup into a scan, and on Oct 3 2026 one
-- scan per transaction id spent the whole 5M-row daily allowance. IF NOT EXISTS makes each
-- line free when the index is already there.
CREATE INDEX IF NOT EXISTS ix_split_txn ON split(txn_id);
CREATE INDEX IF NOT EXISTS ix_split_period_cat ON split(user_id, period_id, category_id);
CREATE INDEX IF NOT EXISTS ix_txn_user_date ON txn(user_id, posted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_txn_review ON txn(user_id, review_state, posted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_txn_account_date ON txn(user_id, account_id, posted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_txn_merchant ON txn(user_id, merchant_normalized);
CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_log(user_id, action, created_at);
CREATE INDEX IF NOT EXISTS ix_idempotency_created ON idempotency(created_at);
CREATE INDEX IF NOT EXISTS ix_sync_run_started ON sync_run(user_id, started_at);
CREATE INDEX IF NOT EXISTS ix_surplus_suggestion_user ON surplus_suggestion(user_id);
