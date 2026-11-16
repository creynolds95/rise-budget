# D1 audit: migration 0036 (sync log)

Needs the owner's sign-off before deploy.

**Schema.** Two new tables, no change to existing ones: `sync_event`, `balance_observation`. Indexes lead with time (`created_at, user_id`) so the nightly prune is a range delete, plus a partial `(user_id, txn_id)` for one row's history. No foreign keys on run, account or txn, so no delete anywhere gains a scan.

**Writes per sync.** Per account: 1 balance observation (2 rows with its index) plus 1 event per inserted, changed or dropped row (about 3 rows each with indexes) and a summary only when something happened. A quiet 7-account sync adds about 14 written rows. Budgets in `budgets.test.ts` raised accordingly (idle 150 to 170, cron 40 to 60). 60-day retention at 20 syncs a day is on the order of 10k observation rows.

**Reads.** None added to the sync path (events come from data the sync already holds). The `/diagnostics` routes read by time range, capped at 2,000 rows.

**Plans.** `check-plans.ts` on the local planner: 0 statements read a growing table whole. Re-run with `--remote` (CI does) before deploy.

**Failure mode.** Log inserts run after the account's own batch in a try/catch; a failure there is swallowed and the sync result is unchanged.
