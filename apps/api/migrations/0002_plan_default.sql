-- SPEC §2.9: a category's plan for months that have no allocation row yet.
ALTER TABLE category ADD COLUMN plan_default_cents INTEGER;
ALTER TABLE category ADD COLUMN plan_default_from TEXT;
