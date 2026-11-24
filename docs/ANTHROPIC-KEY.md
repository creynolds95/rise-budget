# Adding an Anthropic API key (monthly report summary)

Optional. Without a key the Monthly report still shows every figure and chart; the key only adds the written sentences. Cost is cents a month: one small request per report.

1. **Create the key.** In the Anthropic Console (console.anthropic.com): add a payment method and a few dollars of credit, then API keys → Create key. Name it `rise`. Copy it once; it is not shown again.
2. **Cap the spend.** Console → Settings → Limits → set a monthly spend limit (5 USD is far more than this uses). A leaked or runaway key can then never cost more than that.
3. **Add it to the Worker.** From `apps/api`:
   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY -c wrangler.local.toml
   ```
   Paste the key at the prompt. Secrets apply right away; no redeploy is needed. For local dev, put `ANTHROPIC_API_KEY=...` in `.dev.vars` instead.
4. **Deploy the report itself** once (`pnpm rise:update`): it applies migration 0038 and ships the Monthly view.
5. **Test.** Settings → Reports → Monthly → pick a month with data → **Write summary**. A few seconds later the headline bullets, chips and one or two sentences per section appear. If it fails, a short message says so and nothing is stored.
6. **Automatic monthly run.** Nothing to switch on: on the 1st of each month (16:00 UTC, after the morning syncs) Rise writes the month just ended and shows "Your report is ready" on the Dashboard. A failed call retries on the 2nd and 3rd. With no key it writes the figures alone.

**Remove it:** `npx wrangler secret delete ANTHROPIC_API_KEY -c wrangler.local.toml`. The report keeps working from the figures alone, and summaries already written stay.

**What is sent:** category names and totals, index returns, goal names and progress. Never merchants, transaction text, account names or numbers.

## Optional extras: weather and gas prices

- **ZIP.** Monthly view → "ZIP for weather and gas" → Save. The ZIP is looked up on zippopotam.us and its coordinates sent to Open-Meteo (free, no key) for monthly highs and lows. It is stored in your settings only.
- **Gas prices.** The EIA is the U.S. Energy Information Administration, which publishes weekly average gas prices by region. Its data API is free but asks for a key (an identifier, not a payment). Get one at eia.gov/opendata (email sign-up, arrives by email), then `npx wrangler secret put EIA_API_KEY -c wrangler.local.toml`. Without it the gas section is simply left out.
- **Names.** Category names are sent as written; rename a category that holds a personal name if you would rather it not be.
