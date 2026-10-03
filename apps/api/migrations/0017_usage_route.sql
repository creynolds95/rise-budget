-- Where the day's reads went: one row per route per UTC day (cron runs count as "cron").
-- Settings lists the heaviest, so a spike can be traced without Cloudflare's dashboard.
CREATE TABLE usage_route (
  day        INTEGER NOT NULL,
  route      TEXT NOT NULL,
  rows_read  INTEGER NOT NULL DEFAULT 0,
  requests   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route)
);
