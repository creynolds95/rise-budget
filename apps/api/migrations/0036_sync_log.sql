-- Diagnostics log (append-only, retention-limited, read only through /diagnostics).
-- sync_event: what each sync did to each transaction and why (insert, pending→posted, update,
-- drop, skipped because deleted), plus one summary row per account per run.
-- balance_observation: every balance the bank reported, with its own date and the pending
-- rows that came with it, so balance and rows can be compared over time.
-- Indexes lead with the time so the nightly prune is a range delete.
-- No FK on run/account/txn: a log row must outlive what it describes and never slow a delete.
CREATE TABLE sync_event (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES user(id),
  run_id       TEXT NOT NULL,
  account_id   TEXT NOT NULL,
  txn_id       TEXT,
  kind         TEXT NOT NULL,   -- insert|pending_to_posted|update|drop|skip_deleted|summary
  reason       TEXT,
  source_tail  TEXT,            -- last 6 characters of the bank's row id, enough to tell rows apart
  posted_at    TEXT,
  amount_cents INTEGER,
  was_pending  INTEGER,
  is_pending   INTEGER,
  detail_json  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_sync_event_time ON sync_event(created_at, user_id);
CREATE INDEX ix_sync_event_txn  ON sync_event(user_id, txn_id) WHERE txn_id IS NOT NULL;

CREATE TABLE balance_observation (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES user(id),
  run_id               TEXT NOT NULL,
  account_id           TEXT NOT NULL,
  balance_date         TEXT NOT NULL,
  balance_cents        INTEGER NOT NULL,
  reported_at          TEXT NOT NULL,
  sent_txns            INTEGER NOT NULL,
  sent_pending         INTEGER NOT NULL,
  sent_pending_cents   INTEGER NOT NULL,   -- Rise sign: money out positive
  stored_pending       INTEGER NOT NULL,
  stored_pending_cents INTEGER NOT NULL,
  observed_at          TEXT NOT NULL
);
CREATE INDEX ix_balance_obs_time ON balance_observation(observed_at, user_id);
