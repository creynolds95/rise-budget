-- A refund linked to the purchase it reverses. Same FK caveat as 0016: D1 enforces foreign
-- keys, so without an index every txn delete would scan the table for rows pointing at it.
ALTER TABLE txn ADD COLUMN refund_of_id TEXT REFERENCES txn(id);
CREATE INDEX IF NOT EXISTS ix_txn_refund_of ON txn(refund_of_id) WHERE refund_of_id IS NOT NULL;
