-- Caleb: a real cash auto-withdrawal (mortgage, a specific student loan) doesn't clear the
-- 3-occurrence bar for auto-detection while sync history is short, and two loans paid on
-- different days can't share one category's "is bill" flag anyway. Let him declare one
-- straight from a transaction instead of waiting on detection. Reuses `recurring_series`
-- rather than a new table — same shape, same Dashboard "hasn't charged since..." banner.
ALTER TABLE recurring_series ADD COLUMN source TEXT NOT NULL DEFAULT 'detected';
ALTER TABLE recurring_series ADD COLUMN anchor_days TEXT; -- JSON [d1,d2], semimonthly only
