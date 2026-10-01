# Setting up your own Rise

Rise is single-user: each person runs their own copy on their own Cloudflare account, with
their own SimpleFIN subscription. Nothing is shared with the original deployment.

Cost: SimpleFIN Bridge is ~$15/yr. Cloudflare Workers, D1 and R2 fit the free tier at
personal-use volume, but **R2 asks for a payment method on file** before it can be enabled.

## 0. What you need

- Node 22+, pnpm (`corepack enable`), git
- A Cloudflare account
- A SimpleFIN Bridge account: <https://beta-bridge.simplefin.org>

```sh
git clone <your fork> rise && cd rise
pnpm install
cd apps/api
npx wrangler login
```

All commands below run from `apps/api` unless noted.

## 1. Create the database and backup bucket

```sh
npx wrangler d1 create rise
npx wrangler r2 bucket create rise-backups   # enable R2 in the dashboard first; retry once if it errors
```

`d1 create` prints a `database_id`. Put it in `wrangler.toml`.

## 2. Point the config at your domain

Edit `apps/api/wrangler.toml`:

| Field | Set to |
|---|---|
| `database_id` | the id from step 1 |
| `RP_ID` | your Worker's host, e.g. `rise.<your-subdomain>.workers.dev` |
| `RP_ORIGIN` | `https://` + the same host |

Your workers.dev subdomain is shown in the Cloudflare dashboard under Workers & Pages.
Passkeys only work on the exact domain in `RP_ID`; get this wrong and sign-in fails.

## 3. Secrets

```sh
openssl rand -hex 32 | npx wrangler secret put JWT_SECRET    # keep a copy for step 5
openssl rand -base64 32 | npx wrangler secret put TOTP_KEY
echo -n you@example.com | npx wrangler secret put SIMPLEFIN_OWNER_EMAIL
```

`SIMPLEFIN_OWNER_EMAIL` must match the email you seed in step 5. If it's missing or
different, the scheduled sync silently does nothing.

Simplest way to keep `JWT_SECRET` for step 5: generate it into a shell variable first
(`JWT_SECRET=$(openssl rand -hex 32)`), then `printf '%s' "$JWT_SECRET" | npx wrangler secret put JWT_SECRET`.

## 4. Build and deploy

From the repo root:

```sh
pnpm --filter @rise/web build
pnpm --filter @rise/api migrate:remote
pnpm --filter @rise/api run deploy     # `run` matters: plain `deploy` is a pnpm built-in
```

The cron schedule (sync 3×/day, nightly backup) deploys with it.

## 5. Create your user and passkey

There is no sign-up page. On **your own machine** (never in CI; the link is a live login):

```sh
JWT_SECRET=<the value from step 3> pnpm seed:user \
  --email you@example.com --name "Your Name" \
  --remote --origin https://<your RP_ID>
```

It prints a link valid for 10 minutes. Open it on your phone and register Face ID / Touch ID.
Whoever opens it first owns the account.

New users start in `America/Chicago`. Change the timezone in Settings if needed.

## 6. Connect SimpleFIN

1. In SimpleFIN Bridge, connect your banks, then create a new app connection and copy its
   setup token.
2. From `apps/api`:

   ```sh
   pnpm simplefin:claim --yes      # paste the setup token when asked
   ```

   This exchanges the single-use token for an access URL and saves it straight into the
   `SIMPLEFIN_ACCESS_URL` Worker secret. The URL is never printed. If the claim fails, make a
   new token; a token is burned once claimed or opened in a browser.
3. In Rise: Accounts → **Sync**. Accounts appear on first sync. Check each account's kind
   (loans are not always detected; set Account → Kind → Loan by hand).

Notes:

- SimpleFIN refreshes each bank about once a day. "Nothing new" right after a sync is
  normal.
- History depth varies by bank (often ~90 days on first connect).
- If a bank shows "Auth required", re-link it inside SimpleFIN Bridge, not in Rise.

## 7. A second person (partner, same account)

1. You: Settings → Backup sign-in → set up an authenticator app (or recovery codes).
2. Them, on their phone: Login → "Use an authenticator code" → sign in.
3. Them: Settings → Passkeys → "Add a passkey on this device".

## Optional: deploy from GitHub Actions

`ci.yml` + `deploy.yml` deploy on every push to `main`. Add repo secrets
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (token permissions: Workers Scripts,
D1, Workers R2 Storage, all Edit). Actions on a private repo use paid minutes once the free
allowance runs out.

Do **not** use `seed-user.yml`: it is hard-coded to the original deployment's domain, and in
a public repo its log would expose your passkey-registration link.

## Local development

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm --filter @rise/api migrate:local
pnpm dev
```

`.dev.vars` uses the built-in mock bank data (`SIMPLEFIN_MOCK=1`). Remove that line before
running `pnpm test`, or two sync tests fail.
