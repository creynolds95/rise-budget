import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { runBackup } from '../src/backup/run';
import { centsToDecimal } from '../src/sync/mock';
import { runSync } from '../src/sync/run';
import type { SimpleFinSource } from '../src/sync/source';
import { call, signedInUser } from './helpers/http';
import { seedProdShape } from './helpers/prodShape';
import { bySql, rowsRead } from './helpers/reads';

/**
 * Rows read per request on a production-sized database (7.4k transactions, 8k splits, daily
 * balances for 3¾ years). The free tier allows 5M a day; a normal day is ~20 app opens, 3
 * syncs and a backup, so a screen should cost thousands, not tens of thousands.
 *
 * Each budget is about 1.5× what the request reads today. A change that needs more should
 * say why here; a scan of the history blows through any of them. On a breach the message
 * names the statements that read the most.
 */
const M = '2026-10';
const BUDGETS: [path: string, rows: number][] = [
  ['/me', 50],
  ['/devices', 200],
  ['/usage', 50],
  ['/accounts', 100],
  ['/accounts/ACCT', 50],
  ['/category-groups', 100],
  ['/categories', 300],
  ['/categories/CAT', 50],
  ['/categories/CAT/history?months=12', 2_500],
  ['/rules', 200],
  ['/merchants/MERCHANT%2031', 200],
  [`/periods/${M}`, 1_000],
  ['/periods/2026-09', 1_500],
  ['/periods/2029-09', 2_000],
  [`/periods/${M}/reallocations`, 50],
  ['/transactions', 500],
  ['/transactions?account=ACCT', 500],
  ['/transactions?reviewState=needs_review', 300],
  ['/transactions?from=2026-09-01&to=2026-09-30', 500],
  ['/transactions?q=MERCHANT%2012', 3_000],
  ['/transactions?direction=in', 3_500],
  ['/transactions/TXN', 50],
  ['/sync/status', 100],
  ['/recurring', 150],
  ['/cash-to-payday', 150],
  ['/cash-to-payday/manual-events', 100],
  ['/review/count', 100],
  ['/review/queue', 4_500],
  [`/reports/spending?month=${M}`, 2_600],
  [`/reports/money-flow?month=${M}`, 300],
  [`/reports/cash-flow?month=${M}`, 2_600],
  // A daily balance per account in the range, plus one before it: grows with the range asked,
  // never with the years of history kept.
  ['/networth?from=2025-10-02&to=2026-10-02', 7_500],
  ['/networth?from=2026-07-02&to=2026-10-02', 2_000],
  ['/investments?from=2025-10-02&to=2026-10-02', 7_500],
  ['/export/backups', 50],
];

const top = () =>
  [...bySql]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sql, n]) => `${n}: ${sql.replace(/\s+/g, ' ').slice(0, 200)}`)
    .join('\n');

describe('rows read on a production-sized database', () => {
  it('every screen stays within its budget', async () => {
    const s = await signedInUser();
    const ids = await seedProdShape(s.userId, 'bud');
    const failures: string[] = [];
    for (const [template, budget] of BUDGETS) {
      const path = template
        .replace('ACCT', ids.accountId)
        .replace('CAT', ids.categoryId)
        .replace('TXN', ids.txnId);
      bySql.clear();
      let status = 0;
      const reads = await rowsRead(async () => {
        status = (await call('GET', path, { access: s.access })).status;
      });
      console.log(`BUDGET ${reads} / ${budget} ${path}`);
      expect(status, path).toBe(200);
      if (reads > budget) failures.push(`${path} read ${reads} rows (budget ${budget})\n${top()}`);
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('a sync and the nightly backup stay within theirs', async () => {
    const s = await signedInUser();
    await seedProdShape(s.userId, 'syn');
    const { results: recent } = await env.DB.prepare(
      `SELECT account_id, source_id, posted_at, amount_cents, descriptor_raw FROM txn
       WHERE user_id = ?1 AND posted_at >= '2026-09-20'`,
    )
      .bind(s.userId)
      .all<{
        account_id: string;
        source_id: string;
        posted_at: string;
        amount_cents: number;
        descriptor_raw: string;
      }>();
    const sec = (d: string) =>
      Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 18) / 1000;
    const source = (fresh: number): SimpleFinSource => ({
      mode: 'mock',
      fetchAccounts: () =>
        Promise.resolve({
          accounts: Array.from({ length: 7 }, (_, i) => ({
            org: { name: 'Bank' },
            id: `synsfa${i}`,
            name: `Account ${i}`,
            currency: 'USD',
            balance: '1000.00',
            'balance-date': sec('2026-10-02'),
            transactions: [
              ...recent
                .filter((r) => r.account_id === `syna${i}`)
                .map((r) => ({
                  id: r.source_id,
                  posted: sec(r.posted_at),
                  amount: centsToDecimal(-r.amount_cents),
                  description: r.descriptor_raw,
                })),
              ...Array.from({ length: fresh }, (_, k) => ({
                id: `new${fresh}-${i}-${k}`,
                posted: sec('2026-10-02'),
                amount: '-12.34',
                description: `MERCHANT ${k * 31}`,
              })),
            ],
          })),
        }),
    });
    await env.DB.prepare(
      `UPDATE account SET last_synced_at = '2026-10-02T14:00:00.000Z',
         created_at = '2025-09-25T00:00:00.000Z' WHERE user_id = ?1`,
    )
      .bind(s.userId)
      .run();
    const now = new Date('2026-10-02T22:00:00Z');
    const runs: [string, () => Promise<unknown>, number][] = [
      ['sync, nothing new', () => runSync(env.DB, s.userId, source(0), { now }), 50_000],
      [
        'cron sync, nothing new, later the same day',
        () => runSync(env.DB, s.userId, source(0), { now, skipRecurringWhenIdle: true }),
        22_000,
      ],
      ['sync, 2 new per account', () => runSync(env.DB, s.userId, source(2), { now }), 50_000],
      // The backup reads every row on purpose. This file's database holds two production-sized
      // users, so this is ~2× Caleb's real nightly cost.
      ['backup', () => runBackup(env.DB, env.BACKUPS, now), 250_000],
    ];
    const failures: string[] = [];
    for (const [label, run, budget] of runs) {
      bySql.clear();
      const reads = await rowsRead(run);
      console.log(`BUDGET ${reads} / ${budget} ${label}`);
      if (reads > budget) failures.push(`${label} read ${reads} rows (budget ${budget})\n${top()}`);
    }
    expect(failures).toEqual([]);
  }, 60_000);
});
