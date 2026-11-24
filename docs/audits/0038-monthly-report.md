# D1 audit: migration 0038 (monthly report)

Needs the owner's sign-off before deploy. Nothing here is deployed.

**Schema.** One new table, `monthly_report`, primary key `(user_id, period_id)`, one row per user per month (about 12 a year). No change to existing tables, no new indexes, no foreign keys beyond `user(id)`.

**What is stored.** The computed figures (`data_json`: category names and totals, index returns, goal names and progress, net worth totals) and the written summary (`narrative_json`), the model id and token counts. No merchant names, descriptions, account names or numbers, notes, or credentials. The API key is a Worker secret, never in D1.

**Writes.** One upsert per generated report: about 1 row written. A month is generated on demand or once by the nightly housekeeping on one of the first three nights of the month, only when the owner has turned it on and a key is set. A failed call writes nothing.

**Reads (all user-scoped, bounded).** Opening a month with no stored report computes the figures live:
- `listAggregates` for two ranges (previous and current month; same month last year), `period_aggregate` by `(user_id, period_id)`.
- `listCategoriesWithArchived`, `listGroupsWithArchived`, `incomeByPeriod`, `listAccountsForNetWorth`: existing, unchanged.
- `listSnapshots` bounded to the month (one last-before-start snapshot per account, then the month's range).
- `investmentInflow` (new, `db/monthlyReport.ts`): driven from the few investment accounts, joined to `txn` on `(user_id, account_id, posted_at)` which is `ix_txn_feed`, bounded by two dates.
- `getReportRow`: primary key.
About 10 statements, none scanning a growing table whole. Idle cost is zero: nothing runs unless the page is opened or the nightly step fires, and the nightly step exits on its first check (no key, setting off, or past the third) with one `user` read.

**Plans.** Run `scripts/check-plans.ts` against the new statements before deploy (`--migrations --remote` covers the migration itself; the query catalog covers the rest). `monthly_report` is small and is not added to the growing-tables list.

**Failure mode.** The model step runs after all figures are computed and swallows its own failures (no key, network, refusal, bad output): the report just has no written summary. The nightly step is wrapped so it can never fail housekeeping.

**Rollback.** Drop `monthly_report` and revert the code; nothing else depends on it. The `monthlyReport` user setting is ignored if present.

**Addendum: the 1st-of-month run and Dashboard card.** No new migration or table. A new cron entry (`0 16 1 * *`, once a month) runs last month's report; the nightly housekeeping hook now only retries on UTC days 2-3 (it was days 1-3 and key-gated). A figures-only report is stored with `model = 'none'` and `narrative_json = 'null'` (columns unchanged). One new read: `GET /reports/monthly/ready` is a primary-key `getReportRow` for last month, called on Dashboard load (about 1 row read per open). The `auto` setting is removed; `alerts.monthlyReport` is added to `user.settings_json`. The mid-month live computation is no longer offered in the app.

**Addendum: ZIP and notes.** No schema change. The `monthlyReport` user setting gains `zip` and `lifeNotes` (at most 12 short entries), stored in the existing `user.settings_json`; stored `data_json` gains `yoy`, `weather`, `gas`, `lifeNotes`. No new statements.

**Addendum: v2 (full months, plan-aware).** No migration. Stored `data_json` gains split, savings, budget, progress, bridge-by-kind and trend fields (older rows are read with defaults). The computation adds no statements beyond one bounded range read of the previous 5 months of `period_aggregate` (by `(user_id, period_id)`); plans and settings are already loaded. `/generate` now rejects an unfinished month. Weather and gas fetches are unchanged but feed the prompt only. Rollback: revert the code; old stored rows still parse.
