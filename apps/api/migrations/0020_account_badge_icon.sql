-- A symbol (home, car, ...) as an alternative to the letters badge. At most one of badge_icon
-- and badge_text is set; NULL for both = the automatic badge.
ALTER TABLE account ADD COLUMN badge_icon TEXT;
