# Rise — Technical Architecture

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Hosting / API | **Cloudflare Workers** | Free tier (100k req/day), no cold start, cron triggers built in |
| Database | **Cloudflare D1** (SQLite) | Free (5 GB, 5M row-reads/day), real SQL, exportable as one file |
| Static assets | **Workers Static Assets** | Served from the same Worker; no second service |
| Object storage | **Cloudflare R2** | Nightly DB exports; 10 GB free, no egress fees |
| Secrets | **Worker Secrets** | Encrypted at rest, never in the repo |
| Domain | `*.workers.dev` | Free, HTTPS included |
| Frontend | **React 18 + Vite + TypeScript** | |
| Server framework | **Hono** | Purpose-built for Workers, tiny, good TS inference |
| Validation | **Zod** | One schema definition shared by client and server |
| Server state | **TanStack Query** | Cache, optimistic updates, offline replay |
| Styling | **Tailwind** with a custom token theme | Tokens in `tailwind.config.ts` mirror `DESIGN-SYSTEM.md` |
| Auth | **@simplewebauthn/server + /browser** | Passkeys |
| Testing | **Vitest** + `@cloudflare/vitest-pool-workers` | Runs Worker tests against real D1 |

**Runtime budget.** Workers free tier allows 10 ms CPU per invocation. This is CPU time,
not wall time — waiting on D1 does not count. Aggregating one period (~175 rows) is
sub-millisecond. Multi-year reports must read **precomputed period aggregates**, not raw
splits. That constraint is why §2.3 exists.

## 2. Repository layout

```
/apps
  /web                  React PWA
    /src
      /routes           one file per screen
      /components
        /primitives     Button, Field, Row, Sheet, Rail…
        /detail         the five-zone DetailPage scaffold
      /lib              api client, offline queue, auth
  /api                  Cloudflare Worker
    /src
      /routes           Hono routers, one per resource
      /db               query layer — THE ONLY place SQL lives
      /sync             SimpleFIN client + reconciliation
      /import           CSV/OFX parsers
      index.ts
    /migrations         0001_init.sql, 0002_….sql
/packages
  /shared
    /src
      /budget           PURE budget engine — no I/O, fully unit-tested
      /categorize       normalisation, confidence, rule matching
      /schemas          Zod schemas — single source of truth for types
/docs
```

**Rule: the budget engine in `packages/shared/src/budget` imports nothing with I/O.** It
takes plain data and returns plain data. This is what makes it testable and what lets the
client compute optimistic UI identically to the server.

**Rule: raw SQL appears only in `apps/api/src/db`.** Route handlers call query functions.

## 3. Data model (D1 / SQLite)

Conventions: money is `INTEGER` cents. Booleans are `INTEGER` 0/1. Dates are `TEXT`
`YYYY-MM-DD`. Timestamps are `TEXT` ISO-8601 UTC. Every table carrying user data has
`user_id` and every query filters on it.

```sql
CREATE TABLE user (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  timezone          TEXT NOT NULL DEFAULT 'America/Chicago',
  settings_json     TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL
);

-- ── auth ──────────────────────────────────────────────────────────────────
CREATE TABLE credential (            -- WebAuthn passkeys
  id                TEXT PRIMARY KEY,          -- credential ID (base64url)
  user_id           TEXT NOT NULL REFERENCES user(id),
  public_key        BLOB NOT NULL,
  counter           INTEGER NOT NULL DEFAULT 0,
  transports        TEXT,
  device_label      TEXT,
  created_at        TEXT NOT NULL,
  last_used_at      TEXT
);

CREATE TABLE totp_secret (
  user_id           TEXT PRIMARY KEY REFERENCES user(id),
  secret_enc        TEXT NOT NULL,
  confirmed_at      TEXT
);

CREATE TABLE recovery_code (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  code_hash         TEXT NOT NULL,
  used_at           TEXT
);

CREATE TABLE session (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  refresh_hash      TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  revoked_at        TEXT,
  created_at        TEXT NOT NULL
);

-- ── accounts ──────────────────────────────────────────────────────────────
CREATE TABLE account (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES user(id),
  name                  TEXT NOT NULL,
  kind                  TEXT NOT NULL,   -- depository|credit|loan|investment|other
  source                TEXT NOT NULL,   -- simplefin|manual
  source_account_id     TEXT,            -- SimpleFIN account id
  institution_name      TEXT,
  mask                  TEXT,
  currency              TEXT NOT NULL DEFAULT 'USD',
  balance_cents         INTEGER NOT NULL DEFAULT 0,
  include_in_net_worth  INTEGER NOT NULL DEFAULT 1,
  include_in_budget     INTEGER NOT NULL DEFAULT 1,
  expected_payment_cents INTEGER,        -- loans
  payment_day           INTEGER,
  sync_cadence_hours    INTEGER,         -- expected freshness; drives staleness warnings
  last_synced_at        TEXT,
  archived_at           TEXT,
  created_at            TEXT NOT NULL,
  UNIQUE(user_id, source, source_account_id)
);

CREATE TABLE balance_snapshot (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  account_id        TEXT NOT NULL REFERENCES account(id),
  as_of             TEXT NOT NULL,
  balance_cents     INTEGER NOT NULL,
  source            TEXT NOT NULL,       -- manual|sync
  created_at        TEXT NOT NULL,
  UNIQUE(account_id, as_of)
);

-- ── categories ────────────────────────────────────────────────────────────
CREATE TABLE category_group (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL,       -- income|expense
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE category (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  group_id          TEXT NOT NULL REFERENCES category_group(id),
  name              TEXT NOT NULL,
  emoji             TEXT,
  rollover_policy   TEXT NOT NULL DEFAULT 'roll',   -- roll|return_to_pool
  spend_shape       TEXT NOT NULL DEFAULT 'linear', -- linear|fixed
  is_bill           INTEGER NOT NULL DEFAULT 0,
  typical_post_day  INTEGER,
  archived_at       TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0
);

-- ── periods & budget ──────────────────────────────────────────────────────
CREATE TABLE period (
  id                     TEXT NOT NULL,      -- '2026-09' — unique per user, not globally
  user_id                TEXT NOT NULL REFERENCES user(id),
  status                 TEXT NOT NULL DEFAULT 'open',  -- open|closed
  expected_income_cents  INTEGER NOT NULL DEFAULT 0,
  returned_surplus_cents INTEGER NOT NULL DEFAULT 0,
  needs_recalc           INTEGER NOT NULL DEFAULT 0,
  recalc_delta_cents     INTEGER NOT NULL DEFAULT 0,
  closed_at              TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE allocation (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  period_id         TEXT NOT NULL,
  category_id       TEXT NOT NULL REFERENCES category(id),
  planned_cents     INTEGER NOT NULL DEFAULT 0,
  carried_in_cents  INTEGER NOT NULL DEFAULT 0,   -- FROZEN at close; never recomputed implicitly
  UNIQUE(user_id, period_id, category_id),
  FOREIGN KEY (user_id, period_id) REFERENCES period(user_id, id)
);

CREATE TABLE reallocation (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  period_id         TEXT NOT NULL,
  from_category_id  TEXT REFERENCES category(id),   -- NULL = pool
  to_category_id    TEXT REFERENCES category(id),   -- NULL = pool
  amount_cents      INTEGER NOT NULL,
  note              TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (user_id, period_id) REFERENCES period(user_id, id)
);

-- ── transactions ──────────────────────────────────────────────────────────
CREATE TABLE txn (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES user(id),
  account_id             TEXT NOT NULL REFERENCES account(id),
  posted_at              TEXT NOT NULL,
  amount_cents           INTEGER NOT NULL,   -- expense positive, income negative
  descriptor_raw         TEXT NOT NULL,
  merchant_normalized    TEXT NOT NULL,
  merchant_display       TEXT,
  notes                  TEXT,
  is_pending             INTEGER NOT NULL DEFAULT 0,
  is_transfer            INTEGER NOT NULL DEFAULT 0,
  transfer_pair_id       TEXT REFERENCES txn(id),
  review_state           TEXT NOT NULL DEFAULT 'needs_review', -- needs_review|reviewed|dropped
  suggested_category_id  TEXT REFERENCES category(id),
  suggestion_confidence  REAL NOT NULL DEFAULT 0,
  source                 TEXT NOT NULL,      -- simplefin|ofx|csv|manual
  source_id              TEXT,               -- SimpleFIN txn id / OFX FITID
  dedupe_hash            TEXT,               -- CSV composite hash
  dedupe_ordinal         INTEGER NOT NULL DEFAULT 0,
  import_batch_id        TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_txn_source  ON txn(account_id, source, source_id)
  WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX ux_txn_dedupe  ON txn(account_id, dedupe_hash, dedupe_ordinal)
  WHERE dedupe_hash IS NOT NULL;
CREATE INDEX ix_txn_account_date   ON txn(user_id, account_id, posted_at DESC);
CREATE INDEX ix_txn_review         ON txn(user_id, review_state, posted_at DESC);
CREATE INDEX ix_txn_merchant       ON txn(user_id, merchant_normalized);

CREATE TABLE split (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  txn_id            TEXT NOT NULL REFERENCES txn(id) ON DELETE CASCADE,
  category_id       TEXT NOT NULL REFERENCES category(id),
  amount_cents      INTEGER NOT NULL,
  period_id         TEXT NOT NULL,          -- denormalised from txn.posted_at for fast reports
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_split_period_cat ON split(user_id, period_id, category_id);

-- ── categorisation ────────────────────────────────────────────────────────
CREATE TABLE rule (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  match_field       TEXT NOT NULL,       -- descriptor|merchant
  match_type        TEXT NOT NULL,       -- contains|equals|regex
  match_value       TEXT NOT NULL,
  category_id       TEXT NOT NULL REFERENCES category(id),
  priority          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE TABLE merchant_memory (
  user_id             TEXT NOT NULL REFERENCES user(id),
  merchant_normalized TEXT NOT NULL,
  category_id         TEXT NOT NULL REFERENCES category(id),
  count               INTEGER NOT NULL DEFAULT 0,
  last_used_at        TEXT,
  PRIMARY KEY (user_id, merchant_normalized, category_id)
);

CREATE TABLE merchant_meta (
  user_id             TEXT NOT NULL REFERENCES user(id),
  merchant_normalized TEXT NOT NULL,
  display_name        TEXT,
  suppress_rule_offer INTEGER NOT NULL DEFAULT 0,
  consecutive_same    INTEGER NOT NULL DEFAULT 0,
  consecutive_cat_id  TEXT,
  PRIMARY KEY (user_id, merchant_normalized)
);

CREATE TABLE recurring_series (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES user(id),
  merchant_normalized TEXT NOT NULL,
  category_id         TEXT REFERENCES category(id),
  cadence             TEXT NOT NULL,      -- weekly|biweekly|monthly|annual
  expected_amount_cents INTEGER NOT NULL,
  next_expected_date  TEXT,
  status              TEXT NOT NULL DEFAULT 'active',  -- active|broken|ended
  updated_at          TEXT NOT NULL
);

-- ── operations ────────────────────────────────────────────────────────────
CREATE TABLE sync_run (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  status            TEXT NOT NULL,       -- running|ok|partial|failed
  accounts_touched  INTEGER NOT NULL DEFAULT 0,
  rows_inserted     INTEGER NOT NULL DEFAULT 0,
  rows_updated      INTEGER NOT NULL DEFAULT 0,
  error_json        TEXT
);

CREATE TABLE import_batch (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  account_id        TEXT NOT NULL REFERENCES account(id),
  filename          TEXT NOT NULL,
  format            TEXT NOT NULL,       -- csv|ofx|qfx
  rows_total        INTEGER NOT NULL,
  rows_imported     INTEGER NOT NULL,
  rows_duplicate    INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE audit_log (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  action            TEXT NOT NULL,
  target_type       TEXT,
  target_id         TEXT,
  detail_json       TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE idempotency (
  key               TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES user(id),
  response_json     TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE period_aggregate (        -- precomputed; keeps multi-year reports under 10ms CPU
  user_id           TEXT NOT NULL REFERENCES user(id),
  period_id         TEXT NOT NULL,
  category_id       TEXT NOT NULL,
  spent_cents       INTEGER NOT NULL,
  txn_count         INTEGER NOT NULL,
  PRIMARY KEY (user_id, period_id, category_id)
);
```

## 4. API surface

REST over JSON. All routes require a valid access token except the auth handshake.
All mutating routes accept an `Idempotency-Key` header.

```
POST   /auth/passkey/register/options     (authenticated — adding a device)
POST   /auth/passkey/register/verify
POST   /auth/passkey/login/options
POST   /auth/passkey/login/verify         → { access, refresh }
POST   /auth/totp/verify
POST   /auth/recovery/verify
POST   /auth/refresh
POST   /auth/logout

GET    /me                                → user + settings
PATCH  /me/settings

GET    /accounts
POST   /accounts                          (manual)
PATCH  /accounts/:id
POST   /accounts/:id/snapshots            manual balance
GET    /accounts/:id/transactions

GET    /transactions?from&to&account&category&q&review_state&cursor
GET    /transactions/:id
PATCH  /transactions/:id                  category, notes, merchant, review_state
POST   /transactions                      manual entry
POST   /transactions/:id/splits           replace the full split set
POST   /transactions/bulk-accept          { ids[] } or { min_confidence }
POST   /transactions/:id/transfer-link    { other_txn_id }
DELETE /transactions/:id/transfer-link

GET    /review/queue?cursor               grouped, with confidence + suggestions

GET    /periods/:id                       allocations, pool, pace, totals
PATCH  /periods/:id                       expected_income
POST   /periods/:id/close
POST   /periods/:id/recalculate
GET    /periods/:id/reallocations

PATCH  /allocations/:id                   { planned_cents, funding: [{from_category_id, amount_cents}] }
                                          → 409 INSUFFICIENT_POOL if funding is required and absent

GET    /categories
POST   /categories
PATCH  /categories/:id                    name, policy, shape, group
POST   /categories/:id/forgive            { amount_cents, reason }
GET    /categories/:id/history?months=12

GET    /rules
POST   /rules
DELETE /rules/:id
GET    /merchants/:normalized             memory, top categories, alias
PATCH  /merchants/:normalized             rename / suppress_rule_offer

GET    /recurring
GET    /networth?from&to
GET    /reports/spending?from&to&group_by

POST   /sync/run                          manual trigger
GET    /sync/status

POST   /import/preview                    multipart → { new, duplicate, conflicting, rows[] }
POST   /import/commit                     { batch_id }

GET    /export                            full SQLite dump or JSON bundle
```

**Error contract.** Every error returns `{ error: { code, message, detail? } }` with a
stable machine-readable `code`. `INSUFFICIENT_POOL` carries the ranked funding candidates
so the client can render the reallocation sheet without a second round-trip.

## 5. Auth & secrets

**Token model.** Access JWT, 15 min, signed HS256 with a Worker secret. Refresh token is
opaque, 30 days, stored hashed in `session`, rotated on every use with reuse-detection
(a replayed refresh revokes the whole session family).

**Web storage.** Refresh token in an `httpOnly; Secure; SameSite=Strict` cookie. Access
token in memory only — never `localStorage`.

**Provisioning.** No signup endpoint. A `pnpm seed:user` script creates the single user
row and prints a one-time passkey-registration link valid for 10 minutes.

**SimpleFIN access URL.** Stored as a Worker Secret (`SIMPLEFIN_ACCESS_URL`), encrypted at
rest by Cloudflare, readable only inside the Worker. Never returned by any endpoint, never
logged. The setup-token exchange is a one-time operation performed by a script, not a route.

**Authorisation.** Every query function in `apps/api/src/db` takes `userId` as its first
parameter and includes it in the `WHERE` clause. There is a lint rule / test asserting no
query in that directory omits it.

**Logging.** Structured JSON. A redaction allowlist — never log tokens, the access URL,
full descriptors, or amounts joined to identity.

## 6. Sync

Cron trigger `0 8,14,22 * * *` (UTC) → 3× daily, plus `POST /sync/run`.

```
for each synced account:
    fetch window = [last_synced_at - 5 days, now]      # overlap absorbs late posts
    upsert by (account_id, source, source_id)
    reconcile pending → posted   (SPEC §3.2)
    run transfer detection over the affected window
    run categorisation for new rows
    update account.balance_cents and last_synced_at
    recompute period_aggregate for touched periods
    flag closed periods as needs_recalc if touched
write sync_run
```

Each account is one D1 transaction. A failure on one account does not roll back others and
is recorded in `sync_run.error_json` with `status = partial`.

## 7. PWA & offline

- `vite-plugin-pwa` with a Workbox service worker.
- App shell precached; API reads cached stale-while-revalidate.
- TanStack Query persisted to IndexedDB.
- Mutation queue: each mutation gets a client `idempotency_key`, is persisted, and replays
  on reconnect in order.
- Web app manifest: standalone display, maskable icon, theme colour from the design tokens.
- A persistent "offline — data from {time}" bar whenever the cache is being served.

## 8. Backups

Nightly cron: `wrangler d1 export` equivalent via the D1 REST API → gzip → R2, keyed
`backups/YYYY-MM-DD.sql.gz`, 90-day retention. `GET /export` gives the user the same dump
on demand. The user must always be able to walk away with their data.

## 9. CI/CD

GitHub Actions:

1. `pnpm typecheck && pnpm lint && pnpm test`
2. `wrangler deploy` on push to `main`, authenticated via a repository secret (Cloudflare
   API token scoped to Workers + D1 only).
3. Migrations run via `wrangler d1 migrations apply` before deploy.

No long-lived cloud credentials on any developer machine.

## 10. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Budget engine | Vitest, pure | Every rule in SPEC §2, all 15 edge cases in SPEC §11 |
| Categorisation | Vitest, pure | Normalisation, confidence maths, rule precedence |
| Import | Vitest, fixtures | Real Apple Card CSV + OFX fixtures; duplicate-coffee case |
| API | `@cloudflare/vitest-pool-workers` | Against real D1; authz scoping on every route |
| E2E | Playwright | Review → categorise → reallocate → close |

**Minimum bar before any UI work is called done:** the budget engine has 100% branch
coverage. It is pure, it is the product, and it is cheap to test.

## 11. Operating limits

| Resource | Free limit | Projected use | Headroom |
|---|---|---|---|
| Worker requests | 100k/day | few hundred | >99% |
| Worker CPU | 10 ms/invocation | <1 ms typical | comfortable |
| D1 rows read | 5M/day | ~50k | 99% |
| D1 rows written | 100k/day | ~50 | >99% |
| D1 storage | 5 GB | ~2 MB/yr | >99% |
| R2 storage | 10 GB | ~50 MB/yr of backups | >99% |

Total recurring cost: **$15/yr (SimpleFIN) + $0 infrastructure.**
