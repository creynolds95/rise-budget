/**
 * Try the monthly report on a transaction CSV, outside the app (SPEC §12.6). Three steps:
 *
 *   node scripts/monthly-report.mjs aggregate <export.csv> <YYYY-MM> <aggregate.json>
 *     Figures only (category names and totals): no merchants, accounts or descriptions.
 *   node scripts/monthly-report.mjs context <aggregate.json> --zip 12345 [--eia-key KEY]
 *     Adds the month's weather (and, with an EIA key, regional gas prices) to the aggregate, as
 *     the app does. The ZIP is given here and never stored. Needs network; skips what fails.
 *   node scripts/monthly-report.mjs prompt <aggregate.json> <outDir>
 *     Writes system.txt, user.txt and schema.json: exactly what the app sends to the model.
 *   node scripts/monthly-report.mjs render <aggregate.json> <out.html> [--narrative n.json] [--label "Haiku, medium"]
 *     A standalone HTML page of the report as the app draws it. With --narrative (JSON in the
 *     shape of schema.json) the written parts are included; without it, the figures alone.
 *
 * Run from apps/web. Uses Vite to load the app's own TypeScript and styles, so the render is
 * the real component, not a copy.
 */
import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const say = (m) => process.stdout.write(m + '\n');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});
try {
  const report = await server.ssrLoadModule('@rise/shared/report');
  const usd = (c) => report.formatUsd(c);

  if (cmd === 'aggregate') {
    const [csvPath, month, out] = args;
    if (!csvPath || !/^\d{4}-\d{2}$/.test(month ?? '') || !out)
      throw new Error('usage: aggregate <export.csv> <YYYY-MM> <aggregate.json>');
    const data = report.reportDataFromCsv(report.csvTxns(readFileSync(csvPath, 'utf8')), month);
    writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
    say(`${out}: income ${usd(data.cash.incomeCents)}, spent ${usd(data.cash.spentCents)}`);
  } else if (cmd === 'context') {
    const [aggPath] = args;
    const zip = flag('zip');
    if (!aggPath || !/^\d{5}$/.test(zip ?? ''))
      throw new Error('usage: context <aggregate.json> --zip 12345 [--eia-key KEY]');
    const data = report.ReportData.parse(JSON.parse(readFileSync(aggPath, 'utf8')));
    const ctx = await server.ssrLoadModule(resolve(root, '../api/src/lib/reportContext.ts'));
    const today = new Date().toISOString().slice(0, 10);
    const got = await ctx.fetchContext(
      { zip, eiaKey: flag('eia-key'), lifeNotes: [] },
      data.month,
      today,
      globalThis.fetch,
    );
    writeFileSync(aggPath, JSON.stringify({ ...data, ...got }, null, 2) + '\n');
    say(
      `${aggPath}: weather ${got.weather ? 'added' : 'unavailable'}, gas ${got.gas ? 'added' : 'unavailable'}`,
    );
  } else if (cmd === 'prompt') {
    const [aggPath, dir] = args;
    if (!aggPath || !dir) throw new Error('usage: prompt <aggregate.json> <outDir>');
    const data = report.ReportData.parse(JSON.parse(readFileSync(aggPath, 'utf8')));
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'system.txt'), report.REPORT_SYSTEM + '\n');
    writeFileSync(resolve(dir, 'user.txt'), report.buildReportPrompt(data, usd) + '\n');
    writeFileSync(
      resolve(dir, 'schema.json'),
      JSON.stringify(report.REPORT_JSON_SCHEMA, null, 2) + '\n',
    );
    say(`wrote system.txt, user.txt, schema.json to ${dir}`);
  } else if (cmd === 'render') {
    const [aggPath, out] = args;
    if (!aggPath || !out)
      throw new Error(
        'usage: render <aggregate.json> <out.html> [--narrative n.json] [--label text]',
      );
    const data = report.ReportData.parse(JSON.parse(readFileSync(aggPath, 'utf8')));
    const narPath = flag('narrative');
    let narrative = null;
    if (narPath) {
      narrative = report.parseNarrative(readFileSync(narPath, 'utf8'));
      if (!narrative) throw new Error(`${narPath} does not fit the narrative schema`);
    }
    const label = flag('label');
    const { MonthlyReportBody } = await server.ssrLoadModule(
      '/src/components/MonthlyReportBody.tsx',
    );
    const { monthName } = await server.ssrLoadModule('/src/lib/dates.ts');
    const css = (await server.ssrLoadModule('/src/styles.css?inline')).default;
    const body = renderToStaticMarkup(
      createElement(MonthlyReportBody, {
        report: { month: data.month, generatedAt: null, model: label ?? null, data, narrative },
      }),
    );
    const title = `${monthName(data.month, true)} report`;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    writeFileSync(
      out,
      `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}${label ? ` (${esc(label)})` : ''}</title>
<style>${css}</style>
<style>html,body{height:auto;overflow:visible}</style></head>
<body><div class="mx-auto max-w-2xl pb-16 gutter">
<header class="pt-6"><h1 class="type-title">${esc(title)}</h1>${
        label ? `<p class="type-label text-ink-muted mt-1">${esc(label)}</p>` : ''
      }</header>${body}</div></body></html>\n`,
    );
    say(`wrote ${out}`);
  } else {
    throw new Error('commands: aggregate | context | prompt | render');
  }
} finally {
  await server.close();
}
