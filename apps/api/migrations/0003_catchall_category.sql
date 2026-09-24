-- H1: every transaction gets a real category the moment it exists — a best guess when one
-- exists, this catch-all otherwise. There is no such thing as an uncategorised transaction.
ALTER TABLE category ADD COLUMN is_catchall INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_category_one_catchall ON category(user_id) WHERE is_catchall = 1;
