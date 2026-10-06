-- A Surplus schedule's new amount from a date on (a paycheck after a 401k change). Both NULL
-- = no change pending; folded into expected_amount_cents once the schedule reaches the date.
ALTER TABLE recurring_series ADD COLUMN next_amount_cents INTEGER;
ALTER TABLE recurring_series ADD COLUMN amount_changes_on TEXT;
