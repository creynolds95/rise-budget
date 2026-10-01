-- Live rollover (2026-10-01): months are no longer closed. Each month's carry-in is computed
-- from the month before, starting at 2026-10, so `allocation.carried_in_cents`,
-- `period.returned_surplus_cents` and the recalc flags are no longer read. A forgiven deficit
-- is kept as an adjustment added to that month's computed carry-in.
ALTER TABLE allocation ADD COLUMN carry_adjust_cents INTEGER NOT NULL DEFAULT 0;

UPDATE period SET status = 'open', needs_recalc = 0, recalc_delta_cents = 0;
