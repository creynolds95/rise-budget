-- Caleb: once every category in a group is deleted (archived), the group itself should be
-- removable too. Archived, never erased, same as a category — the row (and its history
-- joins) stays; it just drops out of `listGroups`.
ALTER TABLE category_group ADD COLUMN archived_at TEXT;
