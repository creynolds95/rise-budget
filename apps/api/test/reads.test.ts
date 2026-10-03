import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { centsToDecimal } from '../src/sync/mock';
import { runSync } from '../src/sync/run';
import type { SimpleFinSource } from '../src/sync/source';
import { call, signedInUser } from './helpers/http';
import { seedProdShape } from './helpers/prodShape';
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

describe('split lookup plan', () => {
  it('walks the id list and searches split by txn_id, never scanning split', async () => {
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT s.id FROM json_each(?2) j CROSS JOIN split s ON s.txn_id = j.value WHERE s.user_id = ?1`,
    )
      .bind('u', '["a"]')
      .all<{ detail: string }>();
    const plan = results.map((r) => r.detail);
    expect(plan[0]).toContain('SCAN j');
    expect(plan.join('\n')).toContain('SEARCH s USING INDEX ix_split_txn');
  });
});

/**
 * Deleting a transaction makes D1 check every foreign key pointing at it, and an unindexed
 * child key turns that check into a scan of the table, once per row deleted: 200 deletes read
 * 1.5M rows before `ix_txn_pair`, and undoing a Monarch import deletes thousands.
 */
describe('D1 rows read for deletes', () => {
  it('undoing an import costs rows per row removed, not per row times history', async () => {
    const s = await signedInUser();
    await seedProdShape(s.userId, 'del');
    await env.DB.prepare(
      `UPDATE txn SET source = 'csv', import_batch_id = 'b1'
       WHERE user_id = ?1 AND CAST(substr(id, 5) AS INTEGER) < 500`,
    )
      .bind(s.userId)
      .run();
    let status = 0;
    const reads = await rowsRead(async () => {
      status = (await call('DELETE', '/import/monarch/batches/b1', { access: s.access })).status;
    });
    expect(status).toBe(204);
    // A few passes over the history are fine (finding the batch's rows has no index); one
    // pass per deleted row (500 × 7.4k = 3.7M) is the bug.
    expect(reads, `undo read ${reads} rows`).toBeLessThan(60_000);

    const one = await rowsRead(async () => {
      status = (await call('DELETE', '/transactions/delt7000', { access: s.access })).status;
    });
    expect(status).toBe(204);
    expect(one, `delete read ${one} rows`).toBeLessThan(2_000);
  }, 60_000);
});

/**
 * Making a rule re-guesses the review queue, and the one-off memory backfill reads the
 * reviewed history once. Neither may cost a pass per row.
 */
describe('D1 rows read for rules and the memory backfill', () => {
  const files = import.meta.glob('../migrations/0018_memory_from_history.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  });

  it('a new rule reads the queue, not the history; the backfill reads the history about once', async () => {
    const s = await signedInUser();
    await seedProdShape(s.userId, 'rul');
    const cat = await env.DB.prepare('SELECT id FROM category WHERE user_id = ?1 LIMIT 1')
      .bind(s.userId)
      .first<{ id: string }>();
    let status = 0;
    const made = await rowsRead(async () => {
      status = (
        await call('POST', '/rules', {
          access: s.access,
          body: {
            matchField: 'merchant',
            matchType: 'equals',
            matchValue: 'Benchmark Mortgage',
            categoryId: cat?.id,
          },
        })
      ).status;
    });
    expect(status).toBe(201);
    expect(made, `rule creation read ${made} rows`).toBeLessThan(3_000);

    const backfill = await rowsRead(async () => {
      await env.DB.prepare(Object.values(files)[0] as string).run();
    });
    // One-off at deploy (about 13 rows per transaction, 2% of a day). A pass per row would be 55M.
    expect(backfill, `backfill read ${backfill} rows`).toBeLessThan(150_000);
  }, 60_000);
});
