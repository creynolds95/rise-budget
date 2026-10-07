-- Sync loads an account's fetch window plus every pending row still open from before it. As
-- one `posted_at >= ? OR is_pending = 1` that read the account's whole history on every sync.
-- Split in two, the window half uses the date index; this one holds only the few open pending
-- rows, so the other half reads just those.
CREATE INDEX IF NOT EXISTS ix_txn_open_pending ON txn(user_id, account_id, posted_at)
  WHERE is_pending = 1 AND review_state != 'dropped';
