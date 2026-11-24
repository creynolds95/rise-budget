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
5. **Test.** Settings → Reports → Monthly → pick a month with data → **Write summary**. A few seconds later the headline bullets, chips and one to three sentences per section appear. If it fails, a short message says so and nothing is stored.
6. **Automatic monthly run.** Switch on "Write each month's summary automatically" under the same button. On one of the first three nights of the month Rise writes the month just ended; a failure retries the next night.

**Remove it:** `npx wrangler secret delete ANTHROPIC_API_KEY -c wrangler.local.toml`. The report keeps working from the figures alone, and summaries already written stay.

**What is sent:** category names and totals, index returns, goal names and progress. Never merchants, transaction text, account names or numbers.
