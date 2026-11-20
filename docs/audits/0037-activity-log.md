# D1 audit: migration 0037 (activity and performance log)

Needs the owner's sign-off before deploy. Nothing here is deployed.

**Schema.** Four new tables, no change to existing ones, no foreign keys: `activity_event` (index `ix_activity_time (at, user_id)`), `perf_hour`, `slow_query`, `log_day` (composite primary keys only). `perf_hour`, `slow_query` and the `perf` stream of `log_day` are system-level like `usage_day` (marked `system:usage`).

**What is stored.** Edits: entity, id, route pattern, status, ms, and changed structured fields with before/after. Free text is stored as "changed" plus length. Settings: key names only. No account numbers, names, merchants, notes, request bodies or credentials. Performance: counts and timings per route pattern. Slow queries: SQL text only.

**Writes.**
- Per edit: 1 `activity_event` row plus its index (about 2 rows written) and up to 3 primary-key reads before and 3 after for the entity snapshot (all by primary key, user-scoped).
- Per API request: 1 upsert into `perf_hour` (about 1 to 2 rows written), batched in the same call as the existing usage meter write. A slow statement (150 ms or 20k rows) adds one `slow_query` upsert, at most 3 per request.
- Per cron run: 1 `perf_hour` upsert. Idle cron ticks still write nothing.
- Estimate for one user at about 300 requests and 20 edits a day: roughly 700 extra rows written a day against the 100k free allowance.

**Reads.** None on the sync path. The new `/diagnostics/activity` route runs about 10 statements, all bounded by time (retention-limited tables) or day; nothing scans a growing table whole (`check-plans.ts`: 0 of 405 statements). `activity_event` and `log_day` were added to its growing-table list.

**Retention and roll-up (nightly, in the existing batch).** Before deleting, rows past retention are summed into `log_day` in the same batch so a failure cannot double-count or lose a day. Retention: sync events 60 days (unchanged), edits 180, hourly performance 14, slow queries 30, daily roll-ups 730. Sizes at the estimate above: `activity_event` about 4k rows at steady state, `perf_hour` about 5k, `log_day` about 60 rows a month.

**Queries to review.** All new SQL is in `apps/api/src/db/activity.ts` (user-scoped), `db/usage.ts` (system performance), `db/backup.ts` (`rollupAndPruneStmts`).

**Failure mode.** Edit logging runs after the response in `waitUntil` inside a catch; perf rows ride in the usage flush that already swallows errors. A failure drops a log row and changes nothing else. The one behavioral change on the request path is reading the snapshot before an edit (primary-key reads, fail-safe).

**Rollback.** Drop the four tables and revert the code; nothing else depends on them.
