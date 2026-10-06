-- Rows read/written per UTC day, counted by the Worker itself (D1 can't be asked). Cloudflare's
-- free tier caps both per UTC day, so Settings shows how close each day got. `day` is yyyymmdd
-- as an integer: the INTEGER PRIMARY KEY is the rowid, so one upsert costs one row written.
CREATE TABLE usage_day (
  day           INTEGER PRIMARY KEY,
  rows_read     INTEGER NOT NULL DEFAULT 0,
  rows_written  INTEGER NOT NULL DEFAULT 0,
  requests      INTEGER NOT NULL DEFAULT 0
);
