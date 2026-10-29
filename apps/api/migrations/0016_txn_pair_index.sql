-- txn.transfer_pair_id references txn(id), and D1 enforces foreign keys, so deleting any
-- transaction first looks for rows pointing at it. With no index on the column that look is a
-- scan of every transaction: 7k rows read per row deleted. Undoing a 6k-row Monarch import
-- would read ~44M rows, nine days of the free allowance, and fail at the cap mid-way.
-- Partial: only linked transfers carry a pair id, so the index costs ~nothing to keep.
CREATE INDEX IF NOT EXISTS ix_txn_pair ON txn(transfer_pair_id) WHERE transfer_pair_id IS NOT NULL;
