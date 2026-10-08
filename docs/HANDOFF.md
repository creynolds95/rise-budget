# Rise — hand-off guide

For a person or an AI taking over, running, or cloning Rise. Start here; it links to the deeper docs.

Rise is a single-user budgeting PWA: a rollover (envelope-style) budget fed by bank sync. It runs on Cloudflare's free tier with one SimpleFIN subscription (~$15/yr). One-page product tour: `ONE-PAGER.md`.

## 1. Read order

| Need | File |
|---|---|
| What the product does, and why | `ONE-PAGER.md`, then `SPEC.md` (the authority: behaviour wins over code) |
| How it's built | `ARCHITECTURE.md` (stack, schema, API) |
| Set up your own copy | `SETUP.md` |
| Keep it running, fix it | `RUNBOOK.md` |
| Why it stays free, and its limits | `FREE-TIER.md` |
| UI rules | `DESIGN-SYSTEM.md` |
| Rules for changing code | `/CLAUDE.md` |

## 2. What it runs on (back end)

| Piece | Service | Role | Cost |
|---|---|---|---|
| Worker | Cloudflare Workers | API + serves the web app (static assets) + cron | Free |
| Database | Cloudflare D1 (SQLite) | All data. One database, named `rise` | Free |
| Backups | Cloudflare R2 bucket `rise-backups` | Nightly SQL dumps, 90 days kept | Free, but R2 needs a payment method on file |
| Bank data | SimpleFIN Bridge | Read-only bank feed, polled ~once a day by SimpleFIN | ~$15/yr |
| Code + deploys | GitHub + Actions | `ci.yml` tests, `deploy.yml` ships `main` | Free on a public repo |

No other servers. Cron (in `wrangler.toml`): bank sync hourly tick, syncing in the hours chosen in Settings; backup 09:30 UTC.

**Secrets** (Worker secrets, never in the repo): `JWT_SECRET`, `TOTP_KEY` (never change it), `SIMPLEFIN_ACCESS_URL`, `SIMPLEFIN_OWNER_EMAIL`. **Deploy-time GitHub secrets:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `D1_DATABASE_ID`, `RISE_HOST`. The repo ships placeholders; the deploy job swaps in the real values.

## 3. Set up

Follow `SETUP.md` (about 30 minutes): create D1 + R2, set config and secrets, deploy, seed the first user (locally, never from CI), install the app on the phone, connect SimpleFIN.

Order matters: database id and host in config → secrets → deploy → seed user → passkey → SimpleFIN.

## 4. Back up and restore

Three layers:
1. **D1 Time Travel**: restore to any minute in the last 7 days (Cloudflare dashboard → D1 → `rise` → Time Travel).
2. **Nightly R2 dump**: `backups/YYYY-MM-DD.sql.gz`, 90 days. Download the latest in the app: Settings → Your data → Download latest backup (needs a fresh passkey check).
3. **Exports**: Settings → Your data → CSV / JSON, readable without Rise.

Keep one downloaded backup somewhere that isn't Cloudflare, quarterly. Restore steps are in `RUNBOOK.md` ("Bad or missing data"): load the dump into a new empty D1 database, point `database_id` at it, deploy.

## 5. Use it

Four tabs: **Dashboard**, **Accounts**, **Transactions**, **Budget**. The menu (Dashboard) holds Surplus, Review, Reports, Investments, Financial health (Retirement, Debt payoff, Mortgage, Savings), Categories, Rules, Settings.

Daily rhythm:
1. Open the app; it syncs on its own 3×/day (Sync button for on-demand, though SimpleFIN only has fresh data about daily).
2. **Review**: confirm or fix low-confidence categories and suggested transfers. Rules are only created when you confirm.
3. **Budget**: set each category's plan for the month. Categories marked *rollover* carry what's left (or owed) into next month; income never rolls.
4. **Surplus**: cash on hand before the next paycheck, from the checking balance and upcoming paychecks and bills. It is not "leftover income".

Core rules to remember (full list in `SPEC.md`):
- Money is integer cents. Expenses are positive, income negative.
- Overspending is a debt, shown in clay colour, never red.
- Credit-card payments and transfers aren't spending.
- Nothing about your money changes silently: new rules and forgiving a deficit are always confirmed.
- "Left to budget" = month's income minus plans.

Second person (partner, same account): Settings → Backup sign-in, then they add their own passkey (`SETUP.md` step 7).

If the app looks stale after a release, close it fully and reopen (it's a PWA with a service worker).

## 6. Connect the bank API (SimpleFIN)

1. Create a SimpleFIN Bridge account; link banks inside Bridge.
2. In Bridge create an app connection; copy the **setup token** (single use).
3. `pnpm simplefin:claim --yes` from the repo root; paste the token. It exchanges it for an access URL and stores it as the `SIMPLEFIN_ACCESS_URL` secret without printing it.
4. Accounts → **Sync**. Accounts appear on the first sync. Set loan accounts' kind by hand (Account → Kind → Loan).

Trouble: "Auth required" on a bank means re-link it inside Bridge. "Nothing new" right after a sync is normal. If everything fails, the subscription lapsed or the token was burned: make a new one. Local development uses mock bank data (`SIMPLEFIN_MOCK=1` in `.dev.vars` only).

The app's own HTTP API lives under `/api/*` (routers in `apps/api/src/routes`, one per resource), authenticated with a session cookie from passkey or TOTP login. There is no public or third-party API key by design.

## 7. For an AI maintainer

- Work from `SPEC.md`; if code and spec disagree, the spec wins. If the spec is ambiguous, pick the more conservative reading and ask.
- Write the test first. Shared logic is pure functions in `packages/shared`; the budget engine imports nothing with I/O. `packages/shared` has a 100% branch-coverage gate.
- Raw SQL lives only in `apps/api/src/db`; every query takes `userId` first and filters on it.
- Types come from the Zod schemas in `packages/shared/src/schemas`.
- **D1 free-tier reads are the main hazard.** Every query needs an index; the CI plan check (`apps/api/scripts/check-plans.ts`) fails a query that scans a growing table. Migrations must be additive.
- Commands: `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm -r typecheck`, `pnpm lint`, `pnpm --filter @rise/shared coverage`. Before `pnpm test`, remove `SIMPLEFIN_MOCK=1` from `apps/api/.dev.vars`.
- Deploy is automatic on merge to `main` once CI passes. A merged PR isn't live until the `deploy` run is green.
- This repo is public: no real names, bank details, amounts, domains or ids in code, tests, docs or commits. Use made-up fixtures; say "the owner".
- Never create the user from CI: the registration link is a live credential and Actions logs are public.

## 8. Known limits

- Single user (one shared login), by design.
- Bank data freshness is SimpleFIN's: about daily, varying history depth per bank.
- Free-tier caps: Workers 10 ms CPU, D1 5M reads / 100k writes per day (see `FREE-TIER.md`). The Settings → Database use meter shows today's usage.
