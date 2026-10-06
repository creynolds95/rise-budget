-- A badge the user picks for an account whose bank Rise has no logo for: letters and two colors.
-- All three are set together or all NULL (NULL = the automatic initials or kind icon).
ALTER TABLE account ADD COLUMN badge_text TEXT;
ALTER TABLE account ADD COLUMN badge_bg TEXT;
ALTER TABLE account ADD COLUMN badge_fg TEXT;
