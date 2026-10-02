import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { centsToDecimal } from '../src/sync/mock';
import { runSync } from '../src/sync/run';
import type { SimpleFinSource } from '../src/sync/source';
import { call, signedInUser } from './helpers/http';
import { rowsRead } from './helpers/reads';

const sec = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 18) / 1000;
const isoDay = (n: number) =>
  new Date(Date.UTC(2024, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);

/** About 2,000 transactions over three years: paychecks, monthly bills, everyday spending. */
function history(): [string, string, number, string][] {
  const out: [string, string, number, string][] = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const today = new Date().toISOString().slice(0, 10);
  for (let d = 0; isoDay(d) <= today; d++) {
    const date = isoDay(d);
    if (d % 14 === 0) out.push([`p${d}`, date, -250_000, 'ACME PAYROLL']);
    if (date.endsWith('-01')) {
      for (const [i, m] of ['RENT CO', 'ELECTRIC', 'PHONE CO', 'NETFLIX'].entries()) {
        out.push([`b${d}-${i}`, date, 2_000 + i * 900, m]);
      }
    }
    if (rnd() < 0.8) out.push([`s${d}`, date, 300 + Math.floor(rnd() * 9000), `SHOP ${d % 40}`]);
  }
  return out;
}

/**
 * The free tier allows 5M rows read a day. A Dashboard request must read only what it shows,
 * never the whole history — 7k transactions once cost 80k rows per Dashboard load.
 */
describe('D1 rows read', () => {
  it('no Dashboard or review request scans the transaction history', async () => {
    const txns = history();
    const source: SimpleFinSource = {
      mode: 'mock',
      fetchAccounts: () =>
        Promise.resolve({
          accounts: [
            {
              org: { name: 'Bank' },
              id: 'chk',
              name: 'Checking',
              currency: 'USD',
              balance: '1000.00',
              'balance-date': sec(new Date().toISOString().slice(0, 10)),
              transactions: txns.map(([id, date, cents, description]) => ({
                id,
                posted: sec(date),
                amount: centsToDecimal(-cents),
                description,
              })),
            },
          ],
        }),
    };
    const s = await signedInUser();
    await runSync(env.DB, s.userId, source, { since: '2024-01-01' });
    await env.DB.prepare(
      "UPDATE txn SET review_state = 'reviewed' WHERE user_id = ?1 AND id NOT IN (SELECT id FROM txn WHERE user_id = ?1 LIMIT 3)",
    )
      .bind(s.userId)
      .run();

    const month = new Date().toISOString().slice(0, 7);
    const paths = [
      '/me',
      `/periods/${month}`,
      '/accounts',
      '/categories',
      '/recurring',
      '/transactions?sort=date_desc',
      '/sync/status',
      '/review/count',
      '/review/queue',
      '/cash-to-payday',
      `/reports/spending?month=${month}`,
      `/reports/money-flow?month=${month}`,
      `/reports/cash-flow?month=${month}`,
      // The carry chain runs from Oct 2026 to the month asked: three years out must not cost
      // a pass over three years of splits.
      '/periods/2029-09',
    ];
    // Well under one pass over the history: a scan reads every transaction at least once.
    const budget = txns.length / 2;
    for (const path of paths) {
      let status = 0;
      const reads = await rowsRead(async () => {
        status = (await call('GET', path, { access: s.access })).status;
      });
      expect(status, path).toBe(200);
      expect(reads, `${path} read ${reads} rows`).toBeLessThan(budget);
    }
  }, 60_000);
});
