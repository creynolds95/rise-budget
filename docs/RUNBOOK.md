# Runbook — keeping Rise alive without an AI

Everything here is a click or a one-line command. Rise runs on Cloudflare's free tier; limits and the reasoning are in `FREE-TIER.md`.

## Is something wrong? Look here first
1. **Settings → Your data → Database use.** Reads or writes near 100% = the daily Cloudflare cap. It resets at 00:00 UTC (7 pm Central). Nothing is lost; the app shows saved data meanwhile and the next sync catches up.
2. **Dashboard notes** say if a sync failed or a bank needs re-auth.
3. **GitHub → Actions.** A red `deploy` run means the new version did not go live; the old one keeps running.

## A deploy failed
- Open the failed `deploy` run and read the red step.
- `migrate` step, "free tier daily row read limit" / `7500`: the cap is spent. Wait past 00:00 UTC, then Actions → `deploy` → **Run workflow**, tick **migrate**. (Deploys with no new migration skip this step, so this only happens for a release that changes the database.)
- `build` or `typecheck` step: the code is broken, not the infrastructure. In GitHub, **revert** the last merged PR (button on the PR page) and merge the revert.
- `deploy` step with an auth error: the Cloudflare API token expired. Cloudflare dashboard → My Profile → API Tokens → recreate with "Edit Cloudflare Workers" + D1 + R2 edit, then update the GitHub repo secret `CLOUDFLARE_API_TOKEN`.

## The app is broken after a release
GitHub → the last merged PR → **Revert** → merge. Deploy runs on its own. If the release included a database migration, reverts are safe as long as the migration was only additive (that is the rule for every migration).

## Bad or missing data
1. **Within 7 days:** Cloudflare dashboard → Storage & Databases → D1 → `rise` → Time Travel → restore to a time before the problem.
2. **Older:** the nightly backups (90 days) are in R2 bucket `rise-backups` as `backups/YYYY-MM-DD.sql.gz`, or tap **Settings → Your data → Download latest backup**. Restore into a brand-new, empty database:
   ```
   gunzip rise-backup-DATE.sql.gz
   npx wrangler d1 create rise-restore
   npx wrangler d1 execute rise-restore --remote --file=rise-backup-DATE.sql
   ```
   Then point `database_id` in `apps/api/wrangler.toml` at the new database and deploy.
3. Rise's own exports (Settings → Your data → CSV / JSON) are readable in any spreadsheet if everything else is gone.

## Dashboard says the last backup is old
Open GitHub → Actions → **backup** and read the failed run. Usually the Cloudflare API token
expired or lost its D1/R2 permission: make a new one (see `SETUP.md`) and update the
`CLOUDFLARE_API_TOKEN` repo secret, then **Run workflow** to take a backup now.

## Bank sync stopped
- Dashboard says "needs attention / auth required": sign in to SimpleFIN Bridge and re-authorize that bank. Rise needs nothing.
- Nothing new but no error: SimpleFIN itself refreshes a bank about once a day.
- Everything fails: SimpleFIN subscription lapsed or the access URL changed. Re-claim a token and `wrangler secret put SIMPLEFIN_ACCESS_URL` (`pnpm simplefin:claim` prints it).

## Secrets (Cloudflare Workers → rise → Settings → Variables)
`JWT_SECRET`, `TOTP_KEY`, `SIMPLEFIN_ACCESS_URL`, `SIMPLEFIN_OWNER_EMAIL`. Changing `JWT_SECRET` signs everyone out; `TOTP_KEY` must never change or stored authenticator secrets stop working. Keep a copy of all four in a password manager.

## Locked out
Another signed-in device: Settings → Passkeys → add one. None: use a recovery code or the authenticator app from Settings → Backup sign-in. All lost: re-run the `seed-user` workflow from a private machine (it prints a one-time passkey link; never from a public Actions log).

## Monthly (two minutes)
- Merge the grouped Dependabot PR if its checks are green; otherwise leave it.
- Glance at Database use: if a normal day sits above ~50%, something new is scanning too much — see `FREE-TIER.md`.
- Download a backup once a quarter and keep it somewhere that is not Cloudflare.

## Rules that keep it cheap
- Every migration is additive. Never rewrite a whole table in one migration (100k writes/day cap).
- Every new screen's query must use an index; add it to `apps/api/test/reads.test.ts`.
- Bulk imports are chunked and re-runnable; if one stops at the daily limit, run it again after the reset. Rows already in are skipped.
