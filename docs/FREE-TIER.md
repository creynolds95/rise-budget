# Staying on the free tier — audit, projection, plan

Written 2026-10-02. Goal: Rise runs free and fully working for years, with no AI tool needed to rescue it.

## 1. Limits (verified against Cloudflare docs, 2026-10-02)

| Resource | Free limit | Rise today |
|---|---|---|
| D1 rows read | 5M / day (counts rows *scanned*, not returned) | ~5% on a busy day after #109 |
| D1 rows written | **100k / day** (each index entry counts) | ~200/day normally; a bulk import is ~11 per txn |
| D1 size | 500 MB per DB | ~1.5 KB per txn all-in → ~20 MB at 13k txns |
| D1 queries per request | 50 | well under |
| Workers requests | 100k / day | tens |
| Worker CPU | 10 ms per request / cron run | the real hard constraint on code design |
| Cron triggers | 5 per account | 2 used |
| R2 | 10 GB-month, 1M writes, 10M reads | one ~1 MB file a day, 90 kept → <0.1 GB |

Cap hit → D1 queries fail until 00:00 UTC. Nothing is charged.

## 2. Where reads come from (measured)

Method: a synthetic history in the real test harness, counting `meta.rows_read` per call. 7.4k txns ≈ Caleb's real size; 12k ≈ +3 years.

| Source | 7.4k txns | 12k txns | Grows with |
|---|---|---|---|
| Dashboard load (all its calls, summed) | ~14k | ~22k | **last 6 months of activity**, not history |
| ↳ `/reports/cash-flow` | 6.8k | 10.8k | activity (6-month window) |
| ↳ `/reports/spending` | 4.3k | 6.9k | activity |
| ↳ `/review/queue` | 2.1k | 3.2k | 90 days of activity |
| Budget screen, `m` months after Oct 2026 | 0.2k now → ~10k at +36 mo | | **months since Oct 2026, unbounded** |
| One sync (3×/day) | 26k | 42k | history, capped at the 3-year recurring lookback |
| Nightly backup | 30k | 49k | history, linear (reads every row) |
| Migrate step on deploy | tiny, but **fails when cap is spent** | | |

Writes: first sync of 7.4k txns = 83k writes; incremental sync ≈ 44; everything interactive is a handful.

**Daily projection, heavy use** (20 app opens, 3 syncs, 1 backup, some budget editing):
today ≈ 20×14k + 3×26k + 30k ≈ **390k (8% of cap)**. In 3 years (activity-bound reads flat, sync plateaus at the lookback, backup grows, Budget screen grows) ≈ 20×(22k+10k) + 3×42k + 49k ≈ **~800k (16%)**. In 10 years the Budget chain alone is ~36k per load → ~1.5M (30%). Storage stays under 100 MB. So the structural design fits free tier for the long run; the incidents came from (a) pre-#109 full scans (80k/load), (b) bulk imports, (c) the deploy step failing on a spent cap.

**The write cap is the other real risk.** 100k/day ≈ 9k txns of import. The Monarch import used most of a day. Any re-link/backfill of years of history can hit it.

## 3. Status (2026-10-02)

Shipped: #1 skip-migrate on deploy (#111) · #7 client staleTime (#112) · #3/#4 carry chain + reports from `period_aggregate`, with the `budgeted`-flip cache fix and reads guard (#113) · #11 DB-limit 503 + banner (#114) · #12/#14 usage meter + backup download (#115) · #5 idle cron syncs skip recurring re-detection · #13/#15 `RUNBOOK.md`, grouped monthly Dependabot.

Decided against: #6 skipping idle backups (sync runs write every day, so there is never an "unchanged" night; backup reads are ~1% of the cap) · #9 dropping `txn` indexes (saves ~1 of ~11 writes per row but risks slow queries) · #10 6am/6pm sync (immaterial). #9 chunked import: the import already sends small chunks and skips rows already in, so a limit hit mid-way is re-runnable after the reset; the 503 message now says so.

## 4. Plan, prioritized

Effort: S < ½ day, M ~1 day, L multi-day. Impact on "never stuck".

### Release path (so a cap never blocks a deploy)
1. **Skip migrate when no migration changed** — S, high. *Done in this PR* (`deploy.yml`). Manual dispatch has a `migrate` checkbox to force it. Caveat: if a migration deploy fails on the cap and a later non-migration commit lands before you re-run it, the later deploy skips migrate; re-run with `migrate: true` the next UTC day.
2. **Migration safety rule** (docs, below): migrations must be additive/backward-compatible so code deploys and schema can land on different days. — S, medium.

### Reads
3. **Budget carry chain from `period_aggregate` instead of scanning splits** (`spentBetween`, `lib/rollover.ts`) — M, high. Only unbounded read growth on the main screen. **Prerequisite:** changing a category's `budgeted` flag does not refresh `period_aggregate` today (grep: nothing outside sync/transactions/import calls `refreshAggregateStmts`). Fix that first (refresh all periods for that category, or recompute lazily), add a test, then switch. Otherwise carry would drift from what transactions say, violating the "carry is live from transactions" rule.
4. **Reports (`spendingByPeriod`, `incomeByPeriod`) from `period_aggregate`** — S after #3's prerequisite. Dashboard load 14k → ~3k.
5. **Narrow `listOccurrences` for recurring detection** — M, medium. Sync's 26–42k is mostly this (3-year scan + per-txn split subquery). Options: run detection only when new txns arrived; or once/day (first sync of the UTC day); or restrict to merchants touched by the sync.
6. **Backup reads** — S: skip the nightly dump when nothing changed since the last one (one `max(updated)`-style probe; or a `last_write` counter row). A quiet night costs ~0 instead of 30–50k. Also keep 90 backups → fine.
7. **Client caching** — S: raise `staleTime` on slow-changing reads (reports, categories, accounts: 5 min), and don't refetch on every focus. Mutations already invalidate. Cuts Dashboard loads by ~3–5×.
8. **Add new Dashboard-class endpoints to `test/reads.test.ts`** with an absolute ceiling (e.g. < 5k rows regardless of history), plus a 3-years-forward Budget case — S, high. This is the guard that keeps future features from reintroducing scans.

### Writes
9. **Chunked/resumable bulk import** — M, high. Cap batches at ~6k writes per run with a clear "continue tomorrow" status instead of failing mid-way. Fewer secondary indexes on `txn` also directly cuts writes per txn (each index = 1 write); review `ix_txn_merchant`, `ix_txn_account_date`, `ix_txn_user_date`, `ix_txn_review` — keep only what queries use.

### Sync cadence
10. **6am/6pm** (discussed, not approved): saves ~1/3 of sync reads (~10–15k/day). Immaterial to the cap; SimpleFIN itself only refreshes ~daily. **Recommendation: leave at 3×/day**; do #5 instead.

### Graceful degradation
11. **Map D1 "free tier limit" errors to a friendly 503** (`{code:'D1_CAP'}`), and show a one-line Dashboard banner: "Daily database limit reached; resets at 6 pm Central. Cached data below." The persisted query cache (14 days) already lets the PWA open and show last-known data. — S–M, high. Cron: on the same error, log and exit cleanly; the next run catches up (the sync window re-reads from last report).

### No-AI self-maintenance
12. **Usage meter in Settings** — M. D1 isn't readable from the Worker, so count it ourselves: wrap `DB.prepare/batch` to sum `meta.rows_read/rows_written` per request, flush with `waitUntil` into one `usage_day` row (≈1 write per request, or per-isolate batching). Settings shows "Today: reads 6% · writes 1%" and a 14-day sparkline, and the banner in #11 uses it to warn at 80%. (Alternative: Cloudflare GraphQL Analytics with an API-token secret — accurate, but one more secret to rot.)
13. **Runbook** `docs/RUNBOOK.md` — S, high: restore from backup (command already in the dump header), hand-fix a failed deploy, rotate secrets, re-auth SimpleFIN, add a passkey. See §4 for the core of it.
14. **Export & backup independence** — S: the user CSV/JSON export exists (`/export`); add a "Download latest backup" button (R2 object via the Worker) and a reminder if you haven't downloaded one in 90 days, so the data survives even if the Cloudflare account is lost.
15. **Dependency/runtime rot** — S: pin Node/pnpm in CI; Dependabot grouped monthly (it needs no AI to merge if CI is green); keep `compatibility_date` bumps in the runbook. Workers + D1 + R2 APIs are stable; the main long-term risks are SimpleFIN pricing and wrangler major bumps.

### Suggested order
Now: #1 (done), #8, #7, #6 → then #3+#4 (with the budgeted-flag fix) → #11 → #12 → #13/#14 → #5, #9 as needed.
Total ≈ 5–6 working days for everything; the first four are about a day and remove nearly all cap risk.

## 5. If it breaks and no AI is around (short form; full steps in RUNBOOK.md)

**A deploy failed at "migrate"** (`code 7500`, "free tier daily row read limit"): it is not your code. Wait for 00:00 UTC (7 pm Central), GitHub → Actions → `deploy` → *Run workflow* with *migrate* ticked. After #1, ordinary merges never touch D1 in deploy, so this only happens for a commit that adds a migration.

**The app says it can't load data**: check the Settings usage meter (after #12) or Cloudflare → D1 → Metrics. If it's the cap, wait for reset; nothing is lost, cron syncs catch up from SimpleFIN's window.

**Bad data after a bug**: Cloudflare D1 Time Travel keeps 7 days (`wrangler d1 time-travel restore rise --timestamp=…`); older: nightly gzip in R2 (`rise-backups`, 90 days), restore into an empty DB with `wrangler d1 execute <db> --remote --file=<dump.sql>`.

**Never ship a migration that breaks the running code**, and never one that rewrites a whole table (writes cap): add columns/tables/indexes; backfill in a later release in chunks.

## 5. Oct 3 2026: one query spent the day

The split lookup behind every transaction list (`json_each(?) j JOIN split s`) read ~190k rows per call in production — every split once per transaction id — while tests showed ~100. Local SQLite and D1 picked different plans, so the read guard test couldn't see it. 26 Dashboard loads spent 5M rows. Fixes: the join order is pinned with `CROSS JOIN` (#129, #130); migration 0017 re-creates every index with `IF NOT EXISTS`; any statement reading ≥ 20k rows is logged with its SQL in Workers Logs (`heavyQuery`); Settings lists the day's heaviest routes; the Dashboard warns at 40% of either daily limit, naming the heaviest route; switching back to the app no longer refetches everything.

**Lesson:** a passing local reads test is necessary, not sufficient. In production, check Cloudflare → D1 → rise → Metrics → *Top queries by rows read* after any change to a query with a JOIN.
