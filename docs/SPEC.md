# Rise — Product & Logic Specification

Personal budgeting tool. Single user. Installable PWA (phone + desktop), one shared API.

This document defines **behaviour and logic**. See `ARCHITECTURE.md` for the stack,
`DESIGN-SYSTEM.md` for visual rules, `TASKS.md` for the build order.

All money is stored and computed as **integer cents**. Never floats. Ever.
All dates are stored as ISO `YYYY-MM-DD` in the user's local timezone (`America/Chicago`).
Periods are calendar months, identified as `YYYY-MM`.

---

## 1. Core model

### 1.1 Sign convention

| Thing | Sign |
|---|---|
| Expense transaction | **positive** (`amount_cents > 0`) |
| Income transaction | **negative** |
| Refund / return on an expense category | negative |
| Depository account balance (checking/savings) | positive when you have money |
| Credit account balance | **negative** when you owe money |

Rationale: budgets are about spending, so expenses being positive makes every budget
computation read naturally (`spent = SUM(amount_cents)`). Account balances follow the
normal-person convention, so the sign flips at the account boundary. The importer is
responsible for normalising each source into this convention — see §6.3.

### 1.2 Entities

- **Account** — a real financial account. `depository | credit | loan | investment | other`.
  Either `synced` (SimpleFIN) or `manual` (balance snapshots).
- **Transaction** — a single movement. Belongs to exactly one account.
- **Split** — a portion of a transaction assigned to a category. A transaction with no
  splits is implicitly a single split of its whole amount.
- **Category** — a budget bucket. Belongs to a **Category Group**.
- **Period** — a calendar month, `open` or `closed`.
- **Allocation** — the `(period, category)` row. Holds `planned_cents` and `carried_in_cents`.
- **Reallocation** — a logged move of planned money between categories (or pool) within a period.
- **Rule** — user-created deterministic categorisation rule.
- **MerchantMemory** — learned statistics, not a rule.
- **BalanceSnapshot** — a manual account balance recorded at a date.

---

## 2. The budget engine

This is the heart of the product. It is implemented as **pure functions** in
`packages/shared/src/budget/` with no I/O, so it is fully unit-testable and can run
identically on the client (optimistic UI) and the server (authority).

### 2.1 Per-category arithmetic

For a given `(period, category)`:

```
available = carried_in + planned
spent     = SUM(split.amount_cents) for splits in this category and period
remaining = available - spent
```

`carried_in` is **computed** from the month before (see §2.4), never stored.

### 2.2 Rollover policy

Each category has `rollover_policy ∈ { roll, return_to_pool }`, changeable at any time.
In the UI this is one switch: **Rolls over to next month**.

**Only a rolling category carries, in both directions** (owner, 2026-10-01). Credit or debit,
a category that is not marked to roll starts every month fresh: its leftover and its overspend
both stay in the month they happened in. Neither goes to the pool.

```
carried_out(c, P) = remaining(c, P)   if policy == roll
                  = 0                 otherwise
```

**Defaults on category creation:** discretionary categories default to `roll`; categories
flagged `is_bill` default to `return_to_pool`. The user can override either.

**Income never rolls.** A month that earned more or less than planned changes nothing about
the next one.

### 2.3 The unallocated pool ("Left to budget")

```
pool(P) = expected_income(P) - SUM(planned(c, P) for all expense categories c)
```

The pool is **derived**, never stored, and shown at the top of the Budget screen as
**Left to budget** (sage when positive, plain at $0) or **Over budget** (clay when negative).
A reallocation between two categories leaves `SUM(planned)` unchanged and therefore does not
move the pool.

`pool` may be negative. A negative pool means over-allocated and must be shown plainly, not
hidden or clamped to zero. Nothing flows into the pool from the month before.

### 2.4 Live rollover (there is no month close)

Months are never closed. Each month's `carried_in` is computed from the month before it:

```
carried_in(c, P) = carried_out(c, P-1) + carry_adjust(c, P)
available        = carried_in + planned
remaining        = available - spent
```

The chain starts at **October 2026** (`ROLLOVER_START`). Nothing carries into October 2026 or
out of any earlier month: those months are history (this is where the Monarch import lives),
and nothing about them can change what a later month carries.

The rollover therefore happens by itself on the 1st, and any change to a past month — a
recategorisation, a late-posting transaction, an edited plan — flows forward into every later
month on the next read. This replaces the earlier close / recalculate flow, where carry was
frozen and a banner asked the user to restate it.

`carry_adjust` is the only stored carry figure: the amount a deficit forgiveness (§2.8) added.

### 2.5 Late-arriving transactions (the Apple Card problem)

A transaction may post into a month that has already ended. This is normal, not an error. The
month's spending and every later month's carry simply read the new numbers; there is nothing
to confirm and no banner.

### 2.6 Reallocation

The signature interaction. When the user changes `planned` on a category:

```
delta = new_planned - old_planned
if delta <= 0:
    apply directly; the freed money returns to the pool
else:
    apply directly; any funding the user names comes from those categories,
    the rest from the pool, even past zero
```

Planning past income is allowed (owner, 2026-10-06). Nothing is blocked: the pool goes
negative and the Budget tab's bar reads "Over budget" on a solid clay fill until plans come
back under income.

Every applied reallocation writes a `reallocation` row: `from_category_id` (nullable = pool),
`to_category_id` (nullable = pool), `amount_cents`, `note`, `created_at`. The month's
reallocation log is viewable — it is how the user sees what they traded away.

### 2.7 Pace

```
pace_fraction = days_elapsed_in_period / days_in_period     # clamped [0,1]
```

Pace is **category-shape aware**. `category.spend_shape ∈ { linear, fixed }`:

- `linear` (groceries, gas, eating out) — expected spend by now is `available * pace_fraction`.
- `fixed` (rent, daycare, insurance) — a single charge. Expected is `0` before the bill
  typically posts and `available` after. `typical_post_day` is learned from history.

This matters: a linear pace marker on rent would show you 50% "overspent" on the 1st every
single month, which trains the user to ignore the indicator.

**Pace honesty.** Staleness is judged against each account's *expected* cadence
(`account.sync_cadence_hours`), never a global threshold. An account is stale when:

```
last_synced_at < now - max(sync_cadence_hours * 1.5, 96 hours)
```

The 4-day floor exists because SimpleFIN re-polls each bank about once a day, some lag more,
and a connection needing re-auth stays quiet until the owner fixes it. The Dashboard note is
dismissible per account until that account's next sync moves its last-synced time.

This distinction matters. Apple Card updates **monthly by design** — a global 48-hour rule
would mark it permanently stale, and a warning that is always on is a warning the user
stops reading. A monthly account is only stale once it has missed its monthly window.

When an account *is* stale, the pace indicator on affected categories and on the Dashboard
is marked, with the reason named:

> Apple Card last reported Aug 31 — this month's charges haven't arrived yet.

Never estimate the missing amount. State what is missing.

### 2.8 Deficit forgiveness

A category can get stuck permanently underwater. There is a deliberate escape hatch:

`POST /categories/{id}/forgive` — adds back a negative `carried_in` for the current month by
writing a `carry_adjust` that brings it to zero, plus an audit row with the amount and the
user's reason. Later months then carry from the adjusted figure. It lives in the **Manage**
zone of the category detail page, styled as a destructive-adjacent action, and requires
confirmation naming the amount.

### 2.9 Plan defaults ("apply to all future months")

A new month starts with every category's `planned` at 0 unless the user has set a default.
When editing a category's plan for open period `P`, the user may tick **Apply to all future
months**. That does three things, atomically, and nothing else:

1. Sets `planned(c, P)` like any other edit (§2.6 funding rules apply to `P` only).
2. Records `category.plan_default_cents = new_planned` and `plan_default_from = P + 1`.
3. Sets `planned` on every existing allocation row of `c` in a period after `P` (all such
   periods are open, because months close in order).

The **resolved** plan for `(Q, c)` is:

```
if an allocation row exists for (Q, c):      its planned_cents
elif plan_default_from <= Q:                 plan_default_cents
else:                                        0
```

Every reader (period view, close, history) uses the resolved plan. Every writer that
creates an allocation row (a plan edit, a funding source, a close writing carry-in) first
seeds it with the resolved plan, so a row's existence never changes a month's numbers.

**A default never restates a closed month.** Before moving `plan_default_from` from `F` to
`P + 1`, every month in `[F, P]` lacking a row is given one holding the old default, so its
resolved plan is unchanged. The per-edit toggle starts from the user setting
`settings.planChangesApplyToFuture` (default **off**: this month only). (Decided 2026-09-24.)

### 2.10 Deleting a category

Deleting archives the category; its past splits and history stay intact. It is refused
while the category holds money in any open month (non-zero planned, carried-in or spent),
because hiding it would silently move the pool. The user moves that money first. Rules that
file into the category are deleted with it, audited as `rule.deleted`, and the confirmation
names how many.

---

## 3. Transactions

### 3.1 Lifecycle

```
                 ┌──────────────┐
  sync/import ──▶│ needs_review │──accept/edit──▶ reviewed
                 └──────────────┘
                        ▲
                        └── user reopens
```

`needs_review` is set on every newly ingested transaction. The user reviews **everything**
— this is a stated requirement, not a fallback. Confidence (see §4) exists only to make
review fast, never to skip it.

### 3.2 Pending → posted matching

SimpleFIN returns pending transactions. They may change amount (tips, fuel holds) or vanish.

```
match pending P to posted Q when:
    P.account_id == Q.account_id
    Q.posted_at BETWEEN P.posted_at AND P.posted_at + 7 days
    |P.amount_cents - Q.amount_cents| <= MAX(100, ABS(P.amount_cents) * 0.02)
    normalized_merchant matches, or trigram similarity >= 0.8
    neither already matched
```

On match: **update P in place** with Q's values and Q's `source_id`. Preserve the user's
category, splits, notes, and review state. Do not create a second row and do not reset
review status — the user already made a decision about this purchase.

Pending transactions **count toward `spent`** so pace stays honest, and are rendered in
italic with a `P` marker.

A pending transaction with no match after 14 days is marked `dropped` and excluded from
`spent`, with a review-queue entry explaining it.

### 3.3 Transfer detection

Transfers between the user's own accounts are not income and not spending. Untagged, they
inflate both sides of every report.

```
candidate pair (A, B) when:
    A.account_id != B.account_id
    A.amount_cents == -B.amount_cents
    ABS(A.posted_at - B.posted_at) <= 4 days
    neither already paired
    A.amount_cents != 0

confidence = high when |date diff| <= 1 AND one account is credit and the other depository
           = medium otherwise
```

High-confidence pairs are auto-linked but still appear in the review queue **as a pair**,
so the user can unlink. Linked transfers set `is_transfer = true` on both rows and are
excluded from `spent`, income, and all category reporting.

### 3.4 Credit cards — the modelling rule that is easy to get wrong

- A purchase **on a credit card** is spending. It hits its category on `posted_at`. It does
  not matter that the money has not left checking yet.
- A **payment from checking to the card** is a transfer. It is never spending, never
  categorised, and never appears in the budget.
- The card's balance is negative (a liability) and contributes negatively to net worth.

Failing to treat the payment as a transfer double-counts every dollar of card spending.
There must be an explicit test for this.

### 3.5 Splits

Any transaction can be split into N `(category, amount)` pairs. Amounts must sum exactly to
the transaction amount; the UI auto-computes the remainder on the last row. Splits are the
mechanism that makes Amazon usable.

A split inherits the parent's `posted_at` and `account_id`. Reporting always reads splits,
never transactions — a transaction without explicit splits is treated as one implicit split.

### 3.6 Spreading one charge across months

A charge in one category can be spread evenly over 2–12 months, starting with its own month,
so a yearly bill draws on a rollover category a month at a time. It is stored as one split per
month (same category, `period_id` set to each month); the cents that don't divide evenly land
on the first month, so the parts always sum exactly. The budget, carry and reports read each
part in its own month; the transaction keeps its real date and amount everywhere else.

- Spreading is always the user's explicit choice; nothing spreads on its own. "None" undoes it.
- Changing the category, or accepting a review suggestion, keeps the spread under the new
  category. Moving the date shifts every part by the same number of months.
- A pending charge that posts is re-spread at its posted amount from its posted month; one
  that is dropped stops counting in every month.
- Transfers can't be spread, and linking or marking one as a transfer puts it back in one
  month. A charge split across categories can't be spread; the split editor is hidden while
  a charge is spread.
- A category's month shows the spread charges drawing on it that month, with their part.

---

## 4. Categorisation

Four layers, evaluated in priority order. The first that produces a category wins.

### 4.1 Layer 1 — explicit rules

User-created, visible and editable in Settings.

```
Rule: { match_field: descriptor|merchant, match_type: contains|equals|regex,
        match_value, category_id, priority }
```

Confidence `1.0`. Rules are the only mechanism that overrides a user's prior manual choice.

### 4.2 Layer 2 — merchant memory (statistics, not rules)

For each `normalized_merchant`, keep counts of categories chosen.

```
n     = total decisions for this merchant
top   = most-chosen category
p     = count(top) / n
confidence = p * (1 - 1 / (1 + n))
```

The shrinkage term prevents a single observation from becoming certainty:
`n=1 → ×0.50`, `n=5 → ×0.83`, `n=20 → ×0.95`.

### 4.3 Layer 3 — recurring series

If the transaction belongs to a detected recurring series (§7) with an established
category, confidence `0.95`.

### 4.4 Layer 4 — keyword seeds

A shipped starter list (`GAS`, `SHELL`, `KROGER`, …) so month one is not blank.
Confidence `0.5`. Overridden permanently the first time the user corrects it.

### 4.5 Confidence → behaviour

| Confidence | Behaviour in the review queue |
|---|---|
| `>= 0.90` | Pre-filled with a check. Eligible for **Accept all confident** bulk action |
| `0.60 – 0.90` | Pre-filled, visually flagged as a guess |
| `< 0.60` | **Not pre-filled.** Shows the top 3 categories for this merchant as one-tap buttons |

Never pre-fill below `0.60`. A wrong guess the user must notice and undo is worse than no guess.

### 4.6 Rule generation — offered, never silent

Every manual categorisation updates merchant memory silently (it is counting, and it is
reversible). Creating a **rule** is different — it is permanent and overrides everything —
so the app asks:

**Trigger:** 3 consecutive identical manual corrections for the same `normalized_merchant`,
where no rule currently matches it.

> You've categorised **QUIKTRIP** as Gas 3 times. Always do this?
> [ Yes ] [ No ] [ Not now ]

`No` sets `suppress_rule_offer = true` for that merchant permanently. `Not now` re-arms
after 3 more corrections.

### 4.7 Merchant normalisation

Raw descriptors are noisy. Normalise before keying memory:

1. Uppercase; collapse whitespace.
2. Strip trailing reference tokens: `\*[A-Z0-9]{4,}$`, `#\d+$`, `\b\d{6,}\b`.
   Strip a store number (`#N`, or a bare 4–5 digit token after the name) and everything
   after it, so every location is one merchant (`CHIPOTLE 2231` → `CHIPOTLE`). Bare 3-digit
   tokens stay — they are often part of a name. *(Decided 2026-09-24.)*
3. Strip known processor prefixes: `SQ *`, `TST* `, `PAYPAL *`, `POS DEBIT `, `SP `.
4. Strip trailing `CITY ST` when `ST` is a valid 2-letter state code.
5. Map through a known-merchant table (`AMZN MKTP US` → `Amazon Marketplace`).

The user can rename a merchant; the rename applies to all past and future transactions and
is stored as a `merchant_alias` row.

**Amazon is the canonical hard case and must be handled explicitly.** Amazon's statement
descriptors distinguish its businesses — typically `Amazon Prime*…` (subscription),
`AMZN Mktp US*…` (marketplace), `Amazon.com*…` (retail), `Amazon Digital*…`. Map these to
**separate normalized merchants**, because Prime is a deterministic recurring subscription
while marketplace purchases are genuinely ambiguous.

Marketplace purchases carry no signal about what was in the box. The app must not guess:
confidence stays low, nothing is pre-filled, and the review row surfaces the user's top
Amazon categories as one-tap buttons plus a prominent **Split** affordance.

---

## 5. Accounts & net worth

### 5.1 Synced vs manual

- **Synced** — balance and transactions from SimpleFIN. `last_synced_at` is displayed
  wherever the balance is shown, judged against `sync_cadence_hours` (§2.7).

  Sync cadence is a **per-account property**, not a global one. Most institutions refresh
  daily; Apple refreshes monthly. Set `sync_cadence_hours` from observed behaviour on the
  first few syncs and expose it as an editable field.

  **Apple accounts specifically:** Apple Card (credit) and Apple Savings (depository) are
  distinct accounts that may arrive through one SimpleFIN connection. Savings is a net-worth
  item — monthly balance updates are entirely adequate for an account that does not move
  daily — and should carry `include_in_budget = 0`, since its only transactions are interest.
  Transfers between Apple Savings and other accounts follow §3.3 like any other transfer.
- **Manual** — the user records `BalanceSnapshot { account_id, as_of, balance_cents }`.

Net worth between snapshots is **linearly interpolated**, and the chart renders interpolated
segments visually distinct (dashed) from known points. Do not draw a step function and do
not present interpolation as measured fact.

### 5.2 Loans

`account.kind = loan` carries `expected_payment_cents` and `payment_day`. This lets the
Budget tab show the bill as an upcoming obligation even when the balance is only updated
manually and occasionally.

### 5.3 Net worth

```
net_worth(d) = SUM(balance_at(account, d)) for all accounts where include_in_net_worth
```

Credit and loan balances are negative and reduce it. Never show a percentage change over a
window shorter than 3 months — short-window percentages on a volatile base are noise.

---

## 6. Ingestion

### 6.1 SimpleFIN

One-time: exchange the single-use setup token for a long-lived **access URL**. Store it
encrypted (see `ARCHITECTURE.md` §5). It is never returned to any client.

Sync runs on a cron trigger 3× daily and is manually triggerable. It is **read-only by
protocol** — SimpleFIN cannot move money.

```
GET {access_url}/accounts?start-date={unix}&pending=1
```

Dedupe on `source_id` (SimpleFIN's transaction id) scoped to the account. Sync is idempotent:
re-running over the same window must produce zero new rows.

Sync writes a `sync_run` audit row: started, finished, accounts touched, rows inserted,
rows updated, errors. Failures never leave partial state — each account's batch is one
transaction.

### 6.2 File import (CSV / OFX / QFX)

Primary purpose is **disaster recovery**: if SimpleFIN fails or drops an institution, the
user must be able to export from the bank and keep going. At ~175 transactions/month,
manual re-entry is not a viable fallback, so import is not optional.

Secondary purpose is ad-hoc backfill — pulling a specific date range from a slow-syncing
account when the user wants current numbers before the next sync lands.

- **OFX/QFX** — dedupe on `FITID`.
- **CSV** — no stable id. Dedupe on a composite:

```
hash = sha256(account_id | posted_at | amount_cents | normalized_descriptor)
occurrence_index = ordinal of this row within its (hash) group in the imported file
dedupe key = (hash, occurrence_index)
```

The occurrence index is **not optional**. Two identical $5.00 coffees at the same shop on
the same day are two real transactions; hashing alone silently swallows the second, and the
user will never notice the budget is wrong. There must be a test for exactly this case.

Import is a **preview-then-commit** flow: parse, classify each row as `new | duplicate |
conflicting`, show counts, let the user confirm. Overlapping date ranges must be safe to
re-import — the user will export Sep 1–23 one week and Sep 1–30 the next.

### 6.3 Normalisation at the boundary

Every source normalises into the §1.1 sign convention at the adapter layer. Source-specific
sign quirks never leak past `packages/shared/src/import/adapters/`.

---

## 7. Recurring detection

A series is detected from `>= 3` transactions with:

- the same `normalized_merchant`
- amounts within 5% of the median, **or** identical
- intervals within ±4 days of a consistent cadence (weekly / biweekly / monthly / annual)

A series yields `next_expected_date` and `expected_amount_cents`, which feed:

- the Budget tab's upcoming-bills strip
- `category.typical_post_day` for fixed-shape pace
- Layer-3 categorisation confidence

A series is marked `broken` if an expected occurrence is >7 days late, surfaced as
"Netflix hasn't charged since July."

### 7.1 Subscription radar

Recurring shows what a year of live recurring charges costs (money out only), and two quiet
notes per series, each for 60 days after it happened:

- **Price went up**: the latest price is over 5% above the charge before it started.
- **Charged twice**: two charges within 5% of each other inside a quarter of one cycle
  (never for weekly series, which sit too close together to tell).

A price change or a double charge is exactly what stops a series fitting detection for a
while, so the radar reads every known series' own charges, not only the ones detected on this
refresh. Notes are a gold dot and plain text: never clay, never a badge, never a push unless
the owner turns that on. Each kind can be turned off in Settings → Alerts.

---

## 8. Review queue

The primary daily interaction. At ~175 transactions/month this must be fast.

- Grouped by date, newest first, with per-day totals.
- Each row: merchant, amount, account, category control sized by confidence (§4.5).
- **Bulk action:** *Accept all confident* — applies every `>= 0.90` suggestion at once.
- Swipe right accepts; swipe left opens the category picker.
- Transfer pairs render as a single linked row.
- Splits are reachable in one tap from the row.
- The queue count is the app's only badge. It should reach zero weekly.

### 8.1 Quiet charge flags

Every charge is reviewed anyway, so a flag is a caption on the row and a line on the
transaction, not an interruption. Recurring refresh sets at most one flag on a charge still
waiting for review, posted in the last 10 days, money out, comparing it with the same
merchant's own history:

- **Possible duplicate**: the same amount at the same account within two days of another
  charge, $20 or more.
- **More than usual here**: at least three earlier charges, and this one is over 2.5× their
  median and at least $50 more.
- **First charge here**: no earlier charge at this merchant, and $300 or more.

A flag is set once and never recomputed. "Looks fine" clears it for good. Each kind can be
turned off in Settings → Alerts, which hides it everywhere.

### 8.2 Push notifications

Optional, per device: Settings → Alerts → Push to this device asks the browser, then signs the
device up (on iPhone, only from the app added to the Home Screen). After each scheduled sync the
server works out what is new and pushes it:

- **On by default**: the weekly recap (Sunday: last week's money out and how many to review),
  a bill that didn't charge (a recurring series gone broken), and a bank sync needing a look.
- **Off by default**: price went up, charged twice, and the three charge flags of §8.1. A kind
  turned off under "Show me" never pushes either. Also off by default: Surplus going negative
  (once when the projected lowest point first goes under zero, again only after it has
  recovered and dipped anew) and transactions to review (one count per sync that brings in new rows, never one per
  transaction, nothing at zero).

Every notice has a key and is told once; at most five go out per run and the rest wait in the
app. A device signing up starts from now, not with a backlog. A device the browser has dropped
is removed on the next send. The sender's key pair is made on first use and never rotated,
since a new one would orphan every device.

---

## 9. Auth & security

See `ARCHITECTURE.md` §5 for implementation. Behaviour:

- **No public registration.** The single user is provisioned out of band via a one-time
  CLI/seed script. There is no signup endpoint to attack.
- **Passkeys (WebAuthn)** are the primary credential. Multiple may be registered.
- **TOTP + single-use recovery codes** are the only fallback. No email-based reset — that
  would make the user's inbox a single point of failure for their financial data.
- **App lock** — configurable `off | immediate | 5m | 1h`. Re-verifies via WebAuthn.
  Optional local PIN as an offline fallback (app-lock only, never account auth).
- **Every query is scoped by `user_id`** and enforced at the data-access layer, not only in
  handlers. Broken object-level authorisation is the #1 bug class in apps like this.
- **Audit log** (append-only) for: auth events, period close/recalculate, deficit
  forgiveness, rule create/delete, account link/unlink, data export.

---

## 10. Offline

The PWA must be readable offline — the user checks it at arbitrary times.

- Read models are cached (last 90 days of transactions, current + prior period budgets).
- Mutations while offline are queued with a client-generated `idempotency_key` and replayed
  on reconnect.
- The server rejects duplicate `idempotency_key` values, making replay safe.
- Conflict policy: last-write-wins per field, server timestamp authoritative. With one user
  and one active device this is near-theoretical, but the rule must be stated rather than
  emergent.
- A visible "offline — showing data from {time}" indicator. Never show stale data as live.

---

## 11. Edge cases that must have tests

| # | Case | Required behaviour |
|---|---|---|
| 1 | Two identical amounts, same merchant, same day, CSV import | Both rows survive (§6.2) |
| 2 | Re-import an overlapping CSV date range | Zero duplicates |
| 3 | Credit card payment from checking | Transfer; excluded from spend |
| 4 | Pending becomes posted with a different amount | Row updated in place; category/notes/review state preserved |
| 5 | Transaction posts into a past month | That month's spending and every later month's carry read the new numbers; nothing to confirm |
| 6 | Rollover policy changed | Applies across the whole chain from October 2026 |
| 7 | Overspent category | Carries only if it is marked to roll; otherwise it resets next month |
| 8 | Reallocation exceeding pool | Commits; pool goes negative and the month shows "Over budget" |
| 9 | Fixed-shape category on day 1 | Pace does not report "overspent" |
| 10 | Monthly-cadence account 20 days since sync | **Not** marked stale — within its expected cadence |
| 10b | Monthly-cadence account 45 days since sync | Marked stale with reason; no estimate of missing spend |
| 10c | Account has not reported past month end | Not applicable: there is no close to wait on |
| 11 | Split amounts not summing to parent | Rejected with a clear error |
| 12 | Sync run repeated over the same window | Idempotent, zero new rows |
| 13 | Refund posted to a category | Reduces `spent`; may push `remaining` positive |
| 14 | Period with no allocations | Pool equals expected income; no divide-by-zero in pace |
| 15 | Offline mutation replayed twice | Idempotency key prevents double-apply |

---

## 12. Planning tools

### 12.1 Retirement: Social Security and life events

Everything is in today's dollars and the owner's own numbers; nothing is fetched or guessed.

- **Social Security.** The owner types each person's monthly benefit at full retirement age
  (67) from their ssa.gov statement, and the age each will claim (62–70). Rise applies SSA's
  rules: 5/9 of 1% off a month for the first 36 months early and 5/12 of 1% beyond (30% off
  at 62), and 2/3 of 1% more a month after 67 (124% at 70). Each person gets their own
  check or half the other's full benefit, whichever is more; the spousal half is cut 25/36 of
  1% a month early (35% at 62) and never grows by waiting. A "count on" share (default 100%)
  plans for a cut to benefits.
- **What it changes.** The monthly goal less the household's checks is what savings must pay.
  Until each check starts, savings stand in for it: the months between retiring and that
  claim, times the check, are set aside on top of what the goal needs.
- **Life events.** One-time money in or out at the owner's age. Before retiring, each lands
  in the projection (and the range of outcomes) at the end of its year. At or after
  retiring, money out adds to what savings must hold and money in reduces it.

### 12.2 Household binder

One place for whoever has to step in: who to call and where things are. Every open account
is listed automatically so none is forgotten; insurance, people to call, documents and
anything else are added by hand. Each entry holds a name, the last four digits, a phone, a
website, where the paper copy is, and notes. It never holds a password, a full account
number or a PIN: the binder records only where passwords live. It is stored with the
owner's settings and is part of the data export.

### 12.3 Claude connector

Optional and off by default; nothing in Rise depends on it. Settings › Your data › Claude
turns on a read-only MCP server after a passkey check and shows its link once. The link
carries a 32-byte secret, stored only as a hash; turning it on again replaces the link, and
turning it off deletes it. Its tools read through the app's own GET routes (budget month,
transactions and their totals, accounts, categories, recurring, Surplus, net worth). There is
no tool that writes.
