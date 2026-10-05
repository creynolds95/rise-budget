-- The Transfers group (account moves, card payments) is never spending. A category created
-- in it or dragged into it could still be budgeted, and then counted in the Dashboard chart,
-- the Expenses bar and reports. Turn those off and drop their rows from the spending cache
-- (it only ever holds budgeted categories, so removing them is the whole rebuild).
DELETE FROM period_aggregate
WHERE category_id IN (
  SELECT c.id FROM category c
  JOIN category_group g ON g.id = c.group_id AND g.user_id = c.user_id
  WHERE LOWER(TRIM(g.name)) = 'transfers'
);
UPDATE category SET budgeted = 0
WHERE budgeted = 1 AND group_id IN (
  SELECT id FROM category_group WHERE LOWER(TRIM(name)) = 'transfers'
);
