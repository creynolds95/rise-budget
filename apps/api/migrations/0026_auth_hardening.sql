-- Refresh rotation grace: two tabs (or a lost response) presenting the token that was current a
-- moment ago are the owner, not a thief. The superseded hash and when it was superseded let
-- /auth/refresh accept it for 60 seconds; outside that window a replay still ends the session.
ALTER TABLE session ADD COLUMN prev_refresh_hash TEXT;
ALTER TABLE session ADD COLUMN rotated_at TEXT;

-- TOTP: the last 30-second step accepted, so a code can't be replayed inside its window; and a
-- second setup's secret waits beside the confirmed one instead of replacing it before it works.
ALTER TABLE totp_secret ADD COLUMN last_step INTEGER;
ALTER TABLE totp_secret ADD COLUMN pending_secret_enc TEXT;

-- Fallback-login lockout: a slot is claimed in one conditional UPDATE before the code is
-- checked, so attempts sent all at once can't all read "4 failures so far" and slip past 5.
ALTER TABLE user ADD COLUMN fallback_window_at TEXT;
ALTER TABLE user ADD COLUMN fallback_attempts INTEGER NOT NULL DEFAULT 0;
