-- Sync hours become sync times (minutes after midnight): each chosen hour keeps its :00.
UPDATE user
SET settings_json = json_remove(
  json_set(settings_json, '$.syncTimes', (
    SELECT json_group_array(value * 60) FROM json_each(user.settings_json, '$.syncHours')
  )),
  '$.syncHours')
WHERE json_type(settings_json, '$.syncHours') = 'array';
