-- C19: lookups that were full scans. Splits are read per transaction on every list and
-- sync; fallback-login lockout counts audit rows by action and time.
CREATE INDEX IF NOT EXISTS ix_split_txn ON split(txn_id);
CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_log(user_id, action, created_at);
CREATE INDEX IF NOT EXISTS ix_idempotency_created ON idempotency(created_at);
CREATE INDEX IF NOT EXISTS ix_sync_run_started ON sync_run(user_id, started_at);
