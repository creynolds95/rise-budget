-- What SimpleFIN actually sent on each run, without names or amounts: per-account balance
-- date, transaction counts and newest posted date, plus the response's cache headers. Lets a
-- "sync did nothing" report be told apart from a bank feed SimpleFIN hasn't refreshed.
ALTER TABLE sync_run ADD COLUMN source_json TEXT;
