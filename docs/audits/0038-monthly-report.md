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

**Addendum: ZIP and notes.** No schema change. The `monthlyReport` user setting gains `zip` and `lifeNotes` (at most 12 short entries), stored in the existing `user.settings_json`; stored `data_json` gains `yoy`, `weather`, `gas`, `lifeNotes`. No new statements.
