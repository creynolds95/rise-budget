# Rise — one page

**A personal budget that knows what you can spend, and treats going over as a debt to pay back, not a failure.**

Installable phone app. Your own bank feed, your own private cloud copy, about $15 a year.

## How it works

Banks → **SimpleFIN** (read-only feed) → Rise syncs 3×/day → auto-categorizes → you review the few it's unsure of → the budget updates. Everything runs on your own free Cloudflare account.

## What you get

| | |
|---|---|
| **Budget** | Monthly plan per category. Mark a category *rollover* and leftover (or overspent) money carries to next month. "Left to budget" shows income not yet planned. Pace shows if you're ahead or behind. |
| **Surplus** | Cash on hand before your next paycheck: checking balance, upcoming paychecks and bills, day-by-day low point. Tells you when you can safely pay cards or fund savings. |
| **Auto-categorizing** | Rules you confirm, merchant memory, recurring detection. Low-confidence items wait in **Review**; nothing is learned silently. |
| **Transactions** | Search, filter (including "not" filters), split across categories, link refunds and transfers. Card payments and transfers never count as spending. |
| **Accounts & net worth** | Synced and manual accounts, balance history, loans, investments vs the S&P 500. |
| **Recurring** | Paychecks, bills, loans and savings transfers detected or added by hand; matched to what posts. |
| **Financial health** | Retirement planner (range of outcomes), debt payoff (snowball/avalanche), mortgage payoff and home equity, savings goals. All inputs editable. |
| **Reports** | Money flow, spending trends, category breakdowns. |
| **Safety** | Passkey sign-in (Face ID / Touch ID), authenticator + recovery codes as backup, nightly backups, 7-day point-in-time restore, full CSV/JSON export. |
| **Works offline** | Changes queue and sync when you're back online. |

## What makes it different

- **Rollover, not reset.** Overspending is a clay-coloured debt carried forward, never a red alarm.
- **Never silent.** New rules and forgiving a deficit are always your explicit choice.
- **Honest numbers.** Money is whole cents, pending-to-posted drift and late arrivals are handled, and 15 named edge cases (duplicate rows, card payments, refunds…) are each covered by a test.
- **Yours.** One user, your own database, no ads, no third-party analytics. Open source.

## What it takes

| | |
|---|---|
| Hosting | Cloudflare account (Workers + D1 + R2, free tier; R2 asks for a card on file) |
| Bank feed | SimpleFIN Bridge, ~$15/yr |
| Setup | About 30 minutes following `SETUP.md` |
| Upkeep | Two minutes a month (`RUNBOOK.md`) |

**Limits:** single user (a partner can share the login), bank data refreshes about daily, free-tier caps apply (usage meter in Settings).

Full guide: `HANDOFF.md`.
