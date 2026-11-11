-- Display-only account label set by the owner. Sync never touches it; NULL means "use name".
ALTER TABLE account ADD COLUMN nickname TEXT;
