-- A synced transaction the user deleted must stay deleted: the next sync re-reads the
-- overlap window, so without this it would come straight back. One row per bank id removed.
CREATE TABLE deleted_txn (
  user_id    TEXT NOT NULL REFERENCES user(id),
  account_id TEXT NOT NULL REFERENCES account(id),
  source     TEXT NOT NULL,
  source_id  TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (account_id, source, source_id)
);
