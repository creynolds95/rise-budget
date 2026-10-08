-- Tags: labels that cut across categories (a trip, a project, a side gig). A tag or a category
-- can carry a tax heading, which the year-end tax pack totals. Nothing here moves money.
ALTER TABLE category ADD COLUMN tax_kind TEXT;

CREATE TABLE tag (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id),
  name       TEXT NOT NULL,
  tax_kind   TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tag_name ON tag(user_id, name);

-- The primary key leads with txn_id, so a txn delete's cascade finds its tags by index.
CREATE TABLE txn_tag (
  txn_id  TEXT NOT NULL REFERENCES txn(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id),
  PRIMARY KEY (txn_id, tag_id)
);
CREATE INDEX IF NOT EXISTS ix_txn_tag_tag ON txn_tag(user_id, tag_id, txn_id);
