-- Merchant memory (the best guess on the review screen) only ever counted categories the user
-- picked one by one in the app, so years of already-categorised history taught it nothing and
-- every new charge defaulted to the catch-all. Count what history already says: for each
-- merchant, how many reviewed single-category transactions went to each category.
--
-- One pass over the reviewed history, run once at deploy (about 25k rows read, a few thousand
-- written). Re-running is harmless: counts only ever go up to what history shows. The catch-all
-- is left out on purpose; "Other" is the absence of a guess, not a prediction.
INSERT INTO merchant_memory (user_id, merchant_normalized, category_id, count, last_used_at)
SELECT /* scan-ok: one-off backfill at deploy */ t.user_id, t.merchant_normalized, s.category_id, COUNT(*), MAX(t.posted_at) || 'T00:00:00.000Z'
FROM txn t
JOIN split s ON s.txn_id = t.id AND s.user_id = t.user_id
JOIN category c ON c.id = s.category_id AND c.user_id = t.user_id
WHERE t.review_state = 'reviewed' AND t.is_transfer = 0 AND t.is_pending = 0
  AND t.merchant_normalized != '' AND c.is_catchall = 0
  AND (SELECT COUNT(*) FROM split x WHERE x.txn_id = t.id) = 1
GROUP BY t.user_id, t.merchant_normalized, s.category_id
ON CONFLICT (user_id, merchant_normalized, category_id) DO UPDATE SET
  count = MAX(merchant_memory.count, excluded.count),
  last_used_at = MAX(COALESCE(merchant_memory.last_used_at, ''), excluded.last_used_at);
