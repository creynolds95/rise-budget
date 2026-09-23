# Rise — Build Order

Each task is independently verifiable. **Do them in order** — dependencies are real.
`AC` = acceptance criteria. A task is done when its AC passes, not when the code exists.

Read `SPEC.md` before starting any task. It is the authority on behaviour; this file is
only the ordering.

---

## Phase 0 — Foundation

**T1. Monorepo scaffold**
pnpm workspaces: `apps/web`, `apps/api`, `packages/shared`. TypeScript strict everywhere,
ESLint, Prettier, Vitest. Root scripts: `typecheck`, `lint`, `test`, `dev`.
`AC:` `pnpm typecheck && pnpm lint && pnpm test` passes on an empty repo.

**T2. Worker + D1 bootstrap**
Hono app, `wrangler.toml`, local D1 binding, health route.
`AC:` `wrangler dev` serves `GET /health` → `{ ok: true }`; `pnpm test` runs a Worker test
against real D1 via `@cloudflare/vitest-pool-workers`.

**T3. Migration 0001 — full schema**
Every table and index from `ARCHITECTURE.md` §3.
`AC:` `wrangler d1 migrations apply` succeeds locally; a test asserts every table exists.

**T4. Zod schemas in `packages/shared/src/schemas`**
Entities, request bodies, response shapes. Types are **inferred from Zod**, never
hand-written in parallel.
`AC:` `apps/api` and `apps/web` both import from `@rise/shared` and typecheck.

---

## Phase 1 — Budget engine (pure, no I/O)

Do this before any UI. It is the product, it is cheap to test, and everything else depends
on it being right.

**T5. Money & period primitives**
Integer-cent helpers, `PeriodId` (`YYYY-MM`) arithmetic, `daysInPeriod`, `paceFraction`.
`AC:` No floats anywhere. Property test: cent arithmetic never loses a penny across 10k
random splits.

**T6. Per-category arithmetic** — `SPEC §2.1`
`available`, `spent`, `remaining` from plain inputs.
`AC:` Unit tests incl. refunds pushing `remaining` positive (edge case 13).

**T7. Rollover & close** — `SPEC §2.2`, `§2.4`
`computeCarryOut(category, remaining)` and `closePeriod(state)`.
`AC:` Deficits carry regardless of policy (edge 7). `return_to_pool` surplus lands in
`returned_surplus`, not `carried_out`. `closePeriod` is idempotent. Policy change does not
alter already-closed periods (edge 6).

**T8. Pool** — `SPEC §2.3`
Derived, may be negative, includes income variance when enabled.
`AC:` Category-to-category reallocation leaves the pool unchanged. Negative pool is
returned as negative, never clamped (edge 14).

**T9. Pace with spend shapes** — `SPEC §2.7`
`linear` vs `fixed`.
`AC:` A `fixed` category on day 1 does not report overspent (edge 9).

**T10. Reallocation & funding** — `SPEC §2.6`
`planFunding(delta, pool, categories)` returning candidates ranked by slack.
`AC:` Raising beyond the pool requires funding (edge 8). Candidates exclude the target and
anything with `slack <= 0`, ranked descending.

**T11. Deficit forgiveness** — `SPEC §2.8`
`AC:` Zeroes only a negative carry, only in an open period, and emits an audit payload.

**T12. Engine edge-case suite**
All 15 cases in `SPEC §11` that are engine-level.
`AC:` **100% branch coverage on `packages/shared/src/budget`.** This is the gate for Phase 2.

---

## Phase 2 — Data layer & API

**T13. Query layer with mandatory user scoping**
`apps/api/src/db` — every function takes `userId` first and filters on it.
`AC:` A test scans the directory and fails if any SQL string lacks `user_id`. A second test
asserts cross-user reads return empty.

**T14. Auth — passkeys**
`@simplewebauthn/server`; registration and login ceremonies; `session` rows; access JWT
(15 min) + rotating refresh with reuse detection.
`AC:` Full register→login→refresh→logout cycle in tests. A replayed refresh token revokes
the session family.

**T15. Auth — TOTP, recovery codes, provisioning script**
`pnpm seed:user` creates the single user and prints a 10-minute registration link.
`AC:` No signup route exists. Recovery codes are single-use. Secrets are stored hashed.

**T16. Auth middleware + error contract**
`AC:` Every non-auth route 401s without a token. Errors always return
`{ error: { code, message } }` with stable codes.

**T17. Accounts & snapshots**
CRUD, manual balance snapshots, interpolated net worth.
`AC:` Net worth interpolates linearly between snapshots and flags interpolated points.
Credit and loan balances reduce net worth.

**T18. Categories, groups, periods, allocations**
Including policy/shape editing and smart defaults on creation (discretionary → `roll`,
`is_bill` → `return_to_pool`).
`AC:` `GET /periods/:id` returns allocations, pool, and pace matching engine output exactly.

**T19. Allocation edit + reallocation endpoint**
`AC:` `PATCH /allocations/:id` beyond the pool without funding returns **409
`INSUFFICIENT_POOL` carrying ranked candidates**. With funding, it writes a `reallocation`
row and applies atomically.

**T20. Period close & recalculate**
`AC:` Close is idempotent and transactional. Recalculate cascades forward through all later
closed periods. Neither ever runs automatically.

**T21. Transactions & splits**
CRUD, split replacement, cursor pagination, filters.
`AC:` Splits must sum to the parent or the request is rejected (edge 11). Reporting reads
splits; a transaction without splits behaves as one implicit split.

**T22. Idempotency middleware**
`AC:` Replaying a mutation with the same `Idempotency-Key` returns the original response and
applies nothing twice (edge 15).

**T23. `period_aggregate` maintenance**
Recompute on any split change.
`AC:` Aggregates always equal a live `SUM` over splits, verified by a reconciliation test.

---

## Phase 3 — Ingestion & intelligence

**T24. Merchant normalisation** — `SPEC §4.7`
Including the Amazon descriptor split into separate normalized merchants.
`AC:` Fixture table of ~40 real descriptors. `Amazon Prime*…` and `AMZN Mktp US*…`
normalise to **different** merchants.

**T25. Categorisation engine** — `SPEC §4`
Four layers, confidence maths with the shrinkage term, precedence.
`AC:` `n=1 → ×0.50`, `n=5 → ×0.83`, `n=20 → ×0.95`. Rules beat memory. Below `0.60`
returns no pre-fill.

**T26. Rule offer state machine** — `SPEC §4.6`
`AC:` Fires after exactly 3 consecutive identical corrections. `No` suppresses permanently.
Rules are never created without an explicit yes.

**T27. SimpleFIN client & sync** — `SPEC §6.1`
Token exchange script, account fetch, upsert, `sync_run` audit.
`AC:` Re-running sync over the same window inserts **zero** rows (edge 12). One account
failing yields `status = partial` without rolling back others.

**T28. Pending → posted reconciliation** — `SPEC §3.2`
`AC:` Amount drift within tolerance updates in place and preserves category, splits, notes,
and review state (edge 4). Unmatched pending is `dropped` after 14 days.

**T29. Transfer detection** — `SPEC §3.3` and `§3.4`
`AC:` **A credit-card payment from checking is a transfer and never counts as spending**
(edge 3). High-confidence pairs auto-link but still appear in review as one row.

**T30. CSV/OFX import** — `SPEC §6.2`
Preview-then-commit; adapters normalise sign at the boundary. This is the disaster-recovery
path, not a routine ritual — but at 175 txn/month there is no manual fallback, so it ships.
`AC:` **Two identical $5.00 coffees, same merchant, same day, both survive** (edge 1).
Re-importing an overlapping range produces zero duplicates (edge 2). At least one real bank
CSV and one OFX fixture parse correctly.

**T31. Recurring detection** — `SPEC §7`
`AC:` Detects monthly from 3 occurrences; marks `broken` when >7 days late; feeds
`typical_post_day`.

**T32. Late-arrival flagging + close readiness** — `SPEC §2.5`, `§2.4`
`AC:` A split landing in a closed period sets `needs_recalc` and accumulates
`recalc_delta_cents`. **Nothing is recalculated automatically.** A period is not offered for
close until every budget account has reported past the period end, and the control names
what it is waiting for (edge 10c). Override is permitted.

---

## Phase 4 — Web foundation

**T33. Design tokens + primitives**
Tailwind theme from `DESIGN-SYSTEM.md` §1–3. `Button`, `Field`, `MoneyText`, `Sheet`,
`StaticRow`, `EditRow`, `NavRow`, `Rail`, `Chart`.
`AC:` All money renders with tabular figures. Gold never used for text. Contrast audit
passes AA on every token pair in use.

**T34. `DetailPage` five-zone scaffold** — `DESIGN-SYSTEM.md` §5
`AC:` Zones can be omitted but not reordered — enforced by the component API, not
convention. Back control requires an origin label.

**T35. App shell, tabs, routing, auth screens**
Four tabs, avatar → settings, depth guard.
`AC:` Passkey login works on an installed PWA on iOS. No route exceeds two pushes from a tab.

---

## Phase 5 — Screens

**T36. Review queue** — `SPEC §8`
Date grouping, per-day totals, confidence-sized controls, swipe, *Accept all confident*,
transfer pairs as one row.
`AC:` 175 transactions reviewable in under 5 minutes in a timed manual pass. Below-0.60
suggestions are never pre-filled.

**T37. Budget tab + the rail** — `DESIGN-SYSTEM.md` §6
Collapsible groups with roll-ups, inline planned editing, pool header.
`AC:` Rail renders carried / allocated / spent plus the pace tick. Negative carry visibly
starts underwater. Overspend uses `--clay`, never red.

**T38. Reallocation flow**
Raise a planned amount → funding sheet ranked by slack → applied and logged.
`AC:` Matches `SPEC §2.6`. The month's reallocation log is viewable.

**T39. Transaction detail + splits**
Five-zone template; split editor with auto-remainder.
`AC:` Three row types are visually distinct. Amazon rows surface top categories as one-tap
buttons plus a prominent Split affordance.

**T40. Accounts tab + account detail**
Net worth with range chips, grouped accounts, snapshot entry for manual accounts, loan fields.
`AC:` Interpolated segments render dashed. Staleness shown wherever a balance is.

**T41. Dashboard** — "this month, answered"
On-pace answer, upcoming bills, review-queue count, spend vs last month, reports scrolling in.
`AC:` Staleness is judged per-account against `sync_cadence_hours`, so a monthly account is
not flagged at 20 days (edge 10) but is at 45 (edge 10b). Stale accounts surface an explicit
caveat naming the account and the gap. **No estimate of missing spend.**

**T42. Category detail + forgiveness**
Hero is *available this month*. History chart. Manage zone.
`AC:` The hero is the number, not a chart. Forgiveness confirm names the amount.

**T43. Settings**
Categories, rules, merchants, accounts, app lock, export.
`AC:` Not a stock grouped-list screen. Rules are viewable, editable, deletable.

---

## Phase 6 — Resilience

**T44. PWA + offline** — `ARCHITECTURE.md` §7
Manifest, service worker, IndexedDB-persisted query cache, mutation replay queue.
`AC:` Installs to iOS home screen. Readable in airplane mode. Queued mutations replay once
and only once. Offline banner names the data's timestamp.

**T45. App lock**
Off / immediate / 5m / 1h, WebAuthn re-verify, optional local PIN offline fallback.
`AC:` Lock survives app restart. PIN gates the app only, never account auth.

**T46. Backups & export**
Nightly D1 → gzip → R2, 90-day retention. `GET /export`.
`AC:` A restore from an R2 backup into a fresh D1 reproduces the data exactly. **Test the
restore, not just the backup.**

**T47. CI/CD**
Actions: typecheck, lint, test, migrate, deploy. Scoped API token.
`AC:` Green pipeline deploys on `main`. No long-lived credentials on any dev machine.

---

## Phase 7 — Reports & polish

**T48. Reports** — spend by category over time, month-over-month, net worth trend.
`AC:` Reads `period_aggregate`, not raw splits. No sub-3-month percentage deltas.

**T49. Recurring / upcoming bills view** inside Budget.
`AC:` Shows next expected date and amount; flags broken series.

**T50. Empty, loading, error, and stale states** across every screen.
`AC:` Designed empty states, not explanatory sentences. Skeletons match final layout.

**T51. Accessibility & polish pass**
`AC:` AA contrast throughout, 44px targets, full keyboard navigation on web, screen-reader
labels on the rail. Both tests in `DESIGN-SYSTEM.md` §9 pass on every screen.

---

## Definition of done

1. `pnpm typecheck && pnpm lint && pnpm test` green.
2. Budget engine at 100% branch coverage.
3. All 15 edge cases in `SPEC §11` have named, passing tests.
4. A restore from backup has been performed successfully at least once.
