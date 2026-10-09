-- The Dashboard's "Where it went" list is now its own tile. A saved layout that shows
-- "spending" keeps showing both, the new tile right after it.
UPDATE user
SET settings_json = json_set(settings_json, '$.dashboard', (
  SELECT json_group_array(v) FROM (
    SELECT value AS v, key * 2 AS o FROM json_each(user.settings_json, '$.dashboard')
    UNION ALL
    SELECT 'whereItWent', key * 2 + 1 FROM json_each(user.settings_json, '$.dashboard')
      WHERE value = 'spending'
    ORDER BY o
  )
))
WHERE json_type(settings_json, '$.dashboard') = 'array'
  AND EXISTS (SELECT 1 FROM json_each(user.settings_json, '$.dashboard') WHERE value = 'spending');
