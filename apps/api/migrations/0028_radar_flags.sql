-- Subscription radar (SPEC §7.1): a price that went up, or a charge twice in one cycle.
-- Written by recurring refresh only when they change.
ALTER TABLE recurring_series ADD COLUMN previous_amount_cents INTEGER;
ALTER TABLE recurring_series ADD COLUMN price_changed_on TEXT;
ALTER TABLE recurring_series ADD COLUMN double_charged_on TEXT;
-- Quiet charge flags (SPEC §8.1): duplicate | unusual | first_time, or 'cleared' once the
-- user says it's fine. Set once by refresh, never recomputed.
ALTER TABLE txn ADD COLUMN flag TEXT;
