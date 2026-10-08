-- The optional, read-only Claude connector (SPEC §12.3). Off until the owner turns it on; one
-- secret per user, kept only as a hash. Turning it off deletes the row.
CREATE TABLE mcp_token (
  user_id    TEXT PRIMARY KEY REFERENCES user(id),
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
