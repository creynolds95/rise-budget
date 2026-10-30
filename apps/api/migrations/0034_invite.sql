-- Share links: a single-use, 12-hour invite to register one more passkey on this account.
-- Only a hash of the secret is stored; the link itself is shown once, when it is made.
CREATE TABLE invite (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES user(id),
  secret_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  revoked_at  TEXT
);
CREATE INDEX ix_invite_user ON invite(user_id, expires_at);

-- Roles: the owner's passkeys manage the account; a profile added by share link is a member and
-- can use Rise but not add, rename or remove profiles. Every existing row stays owner. A session
-- carries its role and the passkey it came from, so removing a profile also ends its sessions.
ALTER TABLE credential ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE session ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE session ADD COLUMN credential_id TEXT;
