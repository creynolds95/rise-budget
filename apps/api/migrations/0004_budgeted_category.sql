-- Caleb's decision (pre-deploy-todo.md A4/A5): whether money counts as spending is a
-- property of the category, not of `txn.is_transfer`. Transfer is just a category like any
-- other; `is_transfer`/`transfer_pair_id` remain purely a pairing/UI relationship.
ALTER TABLE category ADD COLUMN budgeted INTEGER NOT NULL DEFAULT 1;
