-- Monthly report cache (SPEC §12.6). One row per user per month: the computed figures
-- (data_json: aggregates only, category names and totals) and the short written narrative
-- around them (narrative_json), produced by a model call once a month or on demand. Only a
-- successful narrative is stored, so an absent row means "not generated yet" and the cron
-- simply tries again. period_id is a month like 2026-10. No change to existing tables.
-- (No comments inside the CREATE: the backup restore compares stored DDL byte for byte.)
CREATE TABLE monthly_report (
  user_id        TEXT NOT NULL REFERENCES user(id),
  period_id      TEXT NOT NULL,
  generated_at   TEXT NOT NULL,
  model          TEXT NOT NULL,
  data_json      TEXT NOT NULL,
  narrative_json TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period_id)
);
