-- Activity + performance log (extends 0036). Append-only, retention-limited, read only through
-- /diagnostics. Three detail tables and one rollup:
--   activity_event  every change the owner makes in the app (one row per mutating request), with
--                   before/after for the entities that matter. Text fields (notes, names) are
--                   recorded as "changed", never as content.
--   perf_hour       API / cron / client latency as hourly aggregates per route pattern. Not user
--                   data (like usage_day): one row per hour per route for the whole database.
--   slow_query      the slowest statement shapes per UTC day (SQL text only, never bound values).
--   log_day         what the detail tables roll up into before the nightly prune, so old months
--                   stay answerable ("how many edits in October") at a few rows per day.
-- No FKs and indexes lead with time, as in 0036: a log row never slows a delete and the prune is
-- a range delete.
CREATE TABLE activity_event (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES user(id),
  at           TEXT NOT NULL,
  entity       TEXT NOT NULL,   -- txn|category|category_group|account|period|allocation|merchant|settings|...
  entity_id    TEXT,
  action       TEXT NOT NULL,   -- "POST /transactions/:id/splits"
  status       INTEGER NOT NULL,
  ms           INTEGER NOT NULL,
  changes_json TEXT             -- {before,after} for snapshotted entities, else {keys:[...]}
);
CREATE INDEX ix_activity_time ON activity_event(at, user_id);

CREATE TABLE perf_hour (
  hour          TEXT NOT NULL,      -- 2026-11-20T15
  kind          TEXT NOT NULL,      -- api|cron|client
  route         TEXT NOT NULL,
  requests      INTEGER NOT NULL DEFAULT 0,
  errors        INTEGER NOT NULL DEFAULT 0,   -- 5xx, or a failed client call
  slow          INTEGER NOT NULL DEFAULT 0,   -- over the slow threshold
  ms_total      INTEGER NOT NULL DEFAULT 0,
  ms_max        INTEGER NOT NULL DEFAULT 0,
  rows_read     INTEGER NOT NULL DEFAULT 0,
  rows_written  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, kind, route)
);

CREATE TABLE slow_query (
  day       INTEGER NOT NULL,       -- yyyymmdd
  sql       TEXT NOT NULL,
  n         INTEGER NOT NULL DEFAULT 0,
  ms_max    INTEGER NOT NULL DEFAULT 0,
  rows_max  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, sql)
);

CREATE TABLE log_day (
  user_id  TEXT NOT NULL,           -- '' for system streams (perf)
  day      INTEGER NOT NULL,        -- yyyymmdd
  stream   TEXT NOT NULL,           -- sync_event|activity|perf
  key      TEXT NOT NULL,           -- event kind / entity / "kind route"
  n        INTEGER NOT NULL DEFAULT 0,
  sum_a    INTEGER NOT NULL DEFAULT 0,   -- sync: |cents|; activity: ms; perf: ms_total
  sum_b    INTEGER NOT NULL DEFAULT 0,   -- activity: failed; perf: errors
  peak     INTEGER NOT NULL DEFAULT 0,   -- perf: ms_max
  PRIMARY KEY (user_id, day, stream, key)
);
