-- Push notifications (SPEC §8.2). The sender's VAPID key pair lives here, never in settings
-- (settings go to the browser); one row per user, made on first use.
CREATE TABLE push_vapid (
  user_id     TEXT PRIMARY KEY REFERENCES user(id),
  public_key  TEXT NOT NULL,
  private_jwk TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
-- One per device that said yes.
CREATE TABLE push_subscription (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id),
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_push_subscription ON push_subscription(user_id, endpoint);
-- What has been told, so nothing is told twice. Pruned after 120 days by housekeeping.
CREATE TABLE push_sent (
  user_id TEXT NOT NULL REFERENCES user(id),
  key     TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
