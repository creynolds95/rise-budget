import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { listAggregates } from '../src/db';
import { call, signedInUser } from './helpers/http';

/** Small deterministic PRNG so a failure reproduces. */
function rng(seed: number) {
  let x = seed;
  return (n: number) => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return x % n;
  };
}

async function liveSums(userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT s.period_id, s.category_id, SUM(s.amount_cents) AS spent, COUNT(DISTINCT s.txn_id) AS n
     FROM split s JOIN txn t ON t.id = s.txn_id AND t.user_id = s.user_id
     WHERE s.user_id = ?1 AND t.is_transfer = 0 AND t.review_state != 'dropped'
     GROUP BY s.period_id, s.category_id ORDER BY s.period_id, s.category_id`,
  )
    .bind(userId)
    .all<{ period_id: string; category_id: string; spent: number; n: number }>();
  return results.map((r) => ({
    periodId: r.period_id,
    categoryId: r.category_id,
    spentCents: r.spent,
    txnCount: r.n,
  }));
}

describe('T23 period aggregates', () => {
  it('always equal a live SUM over splits (reconciliation)', async () => {
    const u = await signedInUser();
    const api = (method: string, path: string, body?: unknown) =>
      call(method, path, { access: u.access, body });
    const group = (await api('POST', '/category-groups', { name: 'Everyday', kind: 'expense' }))
      .json;
    const cats: string[] = [];
    for (const name of ['Groceries', 'Gas', 'Eating out', 'Kids']) {
      cats.push((await api('POST', '/categories', { groupId: group.id, name })).json.id);
    }
    const card = (await api('POST', '/accounts', { name: 'Chase Credit', kind: 'credit' })).json;
    const days = ['2026-07-03', '2026-07-28', '2026-08-01', '2026-08-15', '2026-09-09'];
    const r = rng(42);
    const txns: { id: string; amount: number }[] = [];

    for (let step = 0; step < 60; step++) {
      const cat = cats[r(cats.length)];
      const op = txns.length < 3 ? 0 : r(4);
      if (op === 0) {
        const amount = 100 + r(20_000);
        const t = await api('POST', '/transactions', {
          accountId: card.id,
          postedAt: days[r(days.length)],
          amountCents: amount,
          descriptor: `SHOP ${step}`,
          ...(r(3) > 0 ? { categoryId: cat } : {}),
        });
        expect(t.status).toBe(201);
        txns.push({ id: t.json.id, amount });
      } else {
        const t = txns[r(txns.length)];
        if (!t) continue;
        if (op === 1) {
          await api('PATCH', `/transactions/${t.id}`, { categoryId: cat });
        } else if (op === 2) {
          const first = r(t.amount + 1);
          const other = cats[r(cats.length)];
          const res = await api('POST', `/transactions/${t.id}/splits`, {
            splits: [
              { categoryId: cat, amountCents: first },
              { categoryId: other, amountCents: t.amount - first },
            ],
          });
          expect(res.status).toBe(200);
        } else {
          // A credit-card payment re-marked as a transfer, then re-split: it must not count.
          await env.DB.prepare('UPDATE txn SET is_transfer = 1 WHERE user_id = ?1 AND id = ?2')
            .bind(u.userId, t.id)
            .run();
          await api('POST', `/transactions/${t.id}/splits`, {
            splits: [{ categoryId: cat, amountCents: t.amount }],
          });
        }
      }
      if (step % 10 === 9) {
        expect(await listAggregates(u.userId, env.DB, '0000-01', '9999-12')).toEqual(
          await liveSums(u.userId),
        );
      }
    }
    expect((await liveSums(u.userId)).length).toBeGreaterThan(4);
  });

  it('only returns the asked range, and only for this user', async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    for (const u of [a, b]) {
      const api = (method: string, path: string, body?: unknown) =>
        call(method, path, { access: u.access, body });
      const g = (await api('POST', '/category-groups', { name: 'G', kind: 'expense' })).json;
      const c = (await api('POST', '/categories', { groupId: g.id, name: 'C' })).json;
      const acct = (await api('POST', '/accounts', { name: 'Card', kind: 'credit' })).json;
      for (const postedAt of ['2026-06-10', '2026-07-10', '2026-08-10']) {
        await api('POST', '/transactions', {
          accountId: acct.id,
          postedAt,
          amountCents: 1_000,
          descriptor: 'X',
          categoryId: c.id,
        });
      }
    }
    const rows = await listAggregates(a.userId, env.DB, '2026-07', '2026-08');
    expect(rows.map((x) => [x.periodId, x.spentCents, x.txnCount])).toEqual([
      ['2026-07', 1_000, 1],
      ['2026-08', 1_000, 1],
    ]);
  });
});
