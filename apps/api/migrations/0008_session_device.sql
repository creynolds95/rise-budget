-- C17: name each signed-in device and when it was last active, so Settings can list them
-- and the user can sign one out.
ALTER TABLE session ADD COLUMN device_label TEXT;
ALTER TABLE session ADD COLUMN last_seen_at TEXT;
