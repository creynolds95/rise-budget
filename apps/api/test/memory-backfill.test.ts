import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { refreshSuggestions } from '../src/lib/categorize';
import { call, signedInUser } from './helpers/http';

const files = import.meta.glob('../migrations/0018_memory_from_history.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const backfill = Object.values(files)[0] as string;

const memory = async (userId: string) =>
  (
    await env.DB.prepare(
      'SELECT merchant_normalized AS m, category_id AS c, count FROM merchant_memory WHERE user_id = ?1 ORDER BY m, c',
    )
      .bind(userId)
      .all<{ m: string; c: string; count: number }>()
  ).results;

describe('0018 merchant memory from history', () => {
  it('counts what reviewed history already says, so the next charge has a real guess', async () => {
    const u = await signedInUser();
    const api = (method: string, path: string, body?: unknown) =>
      call(method, path, { access: u.access, body });
    const group = (await api('POST', '/category-groups', { name: 'Home', kind: 'expense' })).json;
    const mortgage = (await api('POST', '/categories', { groupId: group.id, name: 'Mortgage' }))
      .json;
    const repairs = (await api('POST', '/categories', { groupId: group.id, name: 'Repairs' })).json;
    const acct = (await api('POST', '/accounts', { name: 'Checking', kind: 'depository' })).json;
    const add = (postedAt: string, descriptor: string, categoryId?: string) =>
      api('POST', '/transactions', {
        accountId: acct.id,
        postedAt,
        amountCents: 274_998,
        descriptor,
        categoryId,
      });
    // Three mortgage payments and one repair filed by hand, then memory wiped as it was before
    // history was ever counted.
    for (const d of ['2026-06-01', '2026-07-01', '2026-08-01'])
      await add(d, 'BENCHMARK PMT MTGE', mortgage.id);
    await add('2026-08-15', 'ACE HARDWARE', repairs.id);
    await add('2026-09-01', 'NEVER REVIEWED'); // waiting in the queue: says nothing yet
    await env.DB.prepare('DELETE FROM merchant_memory WHERE user_id = ?1').bind(u.userId).run();

    await env.DB.prepare(backfill).run();
    const rows = await memory(u.userId);
    expect(rows).toEqual([
      { m: expect.stringMatching(/ace hardware/i), c: repairs.id, count: 1 },
      { m: expect.stringMatching(/benchmark/i), c: mortgage.id, count: 3 },
    ]);

    // Running it again changes nothing.
    await env.DB.prepare(backfill).run();
    expect(await memory(u.userId)).toEqual(rows);

    // The next payment arrives with a suggestion: 3 / (3 + 1) = 0.75.
    const next = (await add('2026-09-01', 'BENCHMARK PMT MTGE')).json;
    await refreshSuggestions(env.DB, u.userId);
    const after = (await api('GET', `/transactions/${next.id}`)).json;
    expect(after.suggestedCategoryId).toBe(mortgage.id);
    expect(after.suggestionConfidence).toBeCloseTo(0.75, 10);
  });

  it('never teaches the catch-all, which is the absence of a guess', async () => {
    const u = await signedInUser();
    const api = (method: string, path: string, body?: unknown) =>
      call(method, path, { access: u.access, body });
    const acct = (await api('POST', '/accounts', { name: 'Checking', kind: 'depository' })).json;
    const waiting = (
      await api('POST', '/transactions', {
        accountId: acct.id,
        postedAt: '2026-09-02',
        amountCents: 1_000,
        descriptor: 'MYSTERY CHARGE',
      })
    ).json;
    const other = waiting.splits[0].categoryId;
    await api('PATCH', `/transactions/${waiting.id}`, { reviewState: 'reviewed' });
    await env.DB.prepare('DELETE FROM merchant_memory WHERE user_id = ?1').bind(u.userId).run();
    await env.DB.prepare(backfill).run();
    expect((await memory(u.userId)).filter((r) => r.c === other)).toEqual([]);
  });
});
