-- A paycheck's gross-to-net lines (JSON), shown on its Surplus schedule. Informational only.
ALTER TABLE recurring_series ADD COLUMN paycheck_json TEXT;
