import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { getReportRow } from '../src/db';
import {
  generateAndStore,
  generateNarrative,
  runMonthlyReportCron,
} from '../src/lib/monthlyReport';
import { call, signedInUser } from './helpers/http';

// Every figure and name below is invented.

const NARRATIVE = {
  headlines: ['Surplus this month.'],
  chips: [{ text: 'Steady', tone: 'good' }],
  seasonal: '',
  where: 'Housing led.',
  monthOverMonth: 'Little changed.',
  benchmarks: 'Near average.',
  netWorth: 'Slightly up.',
  goals: 'No goals set.',
  whatsNew: '',
};

const modelReply = (text: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 900, output_tokens: 300 },
      ...extra,
    }),
  );

/** A fetcher standing in for the market-data sources and the model. */
function fakeFetch(opts: { model?: (body: string) => Response } = {}) {
  const sent: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (url.includes('api.anthropic.com')) {
      sent.push(String(init?.body));
      return (opts.model ?? (() => modelReply(JSON.stringify(NARRATIVE))))(String(init?.body));
    }
    return new Response('no', { status: 500 });
  }) as unknown as typeof fetch;
  return { f, sent };
}

async function seed() {
  const u = await signedInUser();
  const api = (method: string, path: string, body?: unknown) =>
    call(method, path, { access: u.access, body });
  const inc = (await api('POST', '/category-groups', { name: 'Pay', kind: 'income' })).json;
  const life = (await api('POST', '/category-groups', { name: 'Life', kind: 'expense' })).json;
  const pay = (await api('POST', '/categories', { groupId: inc.id, name: 'Paycheck' })).json;
  const food = (await api('POST', '/categories', { groupId: life.id, name: 'Groceries' })).json;
  const rent = (await api('POST', '/categories', { groupId: life.id, name: 'Mortgage' })).json;
  const xfer = (
    await api('POST', '/categories', {
      groupId: life.id,
      name: 'Credit Card Payment',
      budgeted: false,
    })
  ).json;
  const bank = (await api('POST', '/accounts', { name: 'Checking', kind: 'depository' })).json;
  const add = (postedAt: string, amountCents: number, categoryId: string, descriptor = 'X') =>
    api('POST', '/transactions', {
      accountId: bank.id,
      postedAt,
      amountCents,
      descriptor,
      categoryId,
    });
  await add('2026-08-05', -300_000, pay.id);
  await add('2026-08-10', 40_000, food.id);
  await add('2026-09-02', -500_000, pay.id);
  await add('2026-09-03', 80_000, food.id, 'SECRET MERCHANT STORE 4411');
  await add('2026-09-04', 150_000, rent.id);
  await add('2026-09-20', 90_000, xfer.id);
  return { u, api };
}

describe('monthly report: figures without a key', () => {
  it('computes income, spending and movers, leaving transfers out', async () => {
    const { api } = await seed();
    const r = await api('GET', '/reports/monthly?month=2026-09');
    expect(r.status).toBe(200);
    expect(r.json.keySet).toBe(false);
    expect(r.json.auto).toBe(false);
    expect(r.json.report.narrative).toBeNull();
    const d = r.json.report.data;
    expect(d.cash).toMatchObject({
      incomeCents: 500_000,
      spentCents: 230_000,
      netCents: 270_000,
      prevIncomeCents: 300_000,
      prevSpentCents: 40_000,
      status: 'surplus',
    });
    expect(d.categories.map((c: { name: string }) => c.name)).toEqual(['Mortgage', 'Groceries']);
    expect(d.movers.up.map((c: { name: string }) => c.name)).toEqual(['Mortgage', 'Groceries']);
    expect(d.netWorth.contributionsTracked).toBe(false);
    expect(d.benchmarks.rows.map((x: { label: string }) => x.label)).toEqual([
      'Housing',
      'Groceries',
    ]);
  });

  it('rejects a bad month, and generate says why when no key is set', async () => {
    const { api } = await seed();
    expect((await api('GET', '/reports/monthly?month=nope')).status).toBe(400);
    const g = await api('POST', '/reports/monthly/generate', { month: '2026-09' });
    expect(g.status).toBe(409);
    expect(g.json.error.message).toMatch(/API key/);
  });

  it('turning the monthly summary on is a setting the owner controls', async () => {
    const { api } = await seed();
    await api('PATCH', '/me/settings', { monthlyReport: { auto: true } });
    expect((await api('GET', '/reports/monthly?month=2026-09')).json.auto).toBe(true);
  });
});

describe('monthly report: the model call', () => {
  it('sends aggregates only, stores the narrative, and the report then carries it', async () => {
    const { u, api } = await seed();
    const { f, sent } = fakeFetch();
    expect(await generateAndStore(u.userId, env.DB, 'k', '2026-09', '2026-10-02', [], f)).toBe(
      true,
    );
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0] as string);
    expect(body.model).toBe('claude-haiku-5-5');
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain('Groceries');
    expect(prompt).not.toMatch(/SECRET MERCHANT|4411|Checking|@example\.com/);
    expect(body.output_config.format.type).toBe('json_schema');

    const row = await getReportRow(u.userId, env.DB, '2026-09');
    expect(row?.model).toBe('claude-haiku-5-5');
    const r = await api('GET', '/reports/monthly?month=2026-09');
    expect(r.json.report.narrative.headlines).toEqual(['Surplus this month.']);
    expect(r.json.report.generatedAt).not.toBeNull();
  });

  it.each([
    ['a failed request', () => new Response('x', { status: 401 })],
    ['a refusal', () => modelReply('', { stop_reason: 'refusal' })],
    ['running out of tokens', () => modelReply('{', { stop_reason: 'max_tokens' })],
    ['output that does not fit', () => modelReply(JSON.stringify({ headlines: [] }))],
    ['output that is not JSON', () => modelReply('hello')],
    ['no text block', () => new Response(JSON.stringify({ content: [] }))],
  ])('stores nothing after %s', async (_name, model) => {
    const { u } = await seed();
    const { f } = fakeFetch({ model });
    expect(await generateAndStore(u.userId, env.DB, 'k', '2026-09', '2026-10-02', [], f)).toBe(
      false,
    );
    expect(await getReportRow(u.userId, env.DB, '2026-09')).toBeNull();
  });

  it('survives the network failing outright', async () => {
    const { u } = await seed();
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await generateAndStore(u.userId, env.DB, 'k', '2026-09', '2026-10-02', [], boom)).toBe(
      false,
    );
    const data = (await call('GET', '/reports/monthly?month=2026-09', { access: u.access })).json;
    expect(await generateNarrative('k', data.report.data, boom)).toBeNull();
  });
});

describe('monthly report: the monthly cron step', () => {
  const at = (iso: string) => new Date(`${iso}T09:30:00Z`);

  it('does nothing without a key, without the setting, or after the third', async () => {
    const { u } = await seed();
    const { f, sent } = fakeFetch();
    const run = (key: string | undefined, auto: boolean, day: string) =>
      runMonthlyReportCron(u.userId, env.DB, key, auto, [], at(day), f);
    expect(await run(undefined, true, '2026-10-02')).toBe('skipped');
    expect(await run('k', false, '2026-10-02')).toBe('skipped');
    expect(await run('k', true, '2026-10-04')).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  it('writes last month once, retries a failure, and never repeats a stored month', async () => {
    const { u } = await seed();
    let fail = true;
    const { f, sent } = fakeFetch({
      model: () =>
        fail ? new Response('x', { status: 500 }) : modelReply(JSON.stringify(NARRATIVE)),
    });
    const run = (day: string) => runMonthlyReportCron(u.userId, env.DB, 'k', true, [], at(day), f);
    expect(await run('2026-10-01')).toBe('failed');
    expect(await getReportRow(u.userId, env.DB, '2026-09')).toBeNull();
    fail = false;
    expect(await run('2026-10-02')).toBe('done');
    expect(await getReportRow(u.userId, env.DB, '2026-09')).not.toBeNull();
    expect(await run('2026-10-03')).toBe('skipped');
    expect(sent).toHaveLength(2);
  });

  it('rolls over the year: January writes December', async () => {
    const { u } = await seed();
    const { f } = fakeFetch();
    expect(await runMonthlyReportCron(u.userId, env.DB, 'k', true, [], at('2027-01-01'), f)).toBe(
      'done',
    );
    expect(await getReportRow(u.userId, env.DB, '2026-12')).not.toBeNull();
  });
});

describe('monthly report: net worth bridge and goals', () => {
  it('splits the change into contributions, market, debt paydown and the rest', async () => {
    const { u, api } = await seed();
    const mk = async (name: string, kind: string, a: number, b: number) => {
      const acct = (await api('POST', '/accounts', { name, kind, source: 'manual' })).json;
      await env.DB.prepare(
        `INSERT INTO balance_snapshot (id, user_id, account_id, as_of, balance_cents, source, created_at)
         VALUES (?1, ?2, ?3, '2026-08-31', ?4, 'manual', 'x'), (?5, ?2, ?3, '2026-09-30', ?6, 'manual', 'x')`,
      )
        .bind(crypto.randomUUID(), u.userId, acct.id, a, crypto.randomUUID(), b)
        .run();
      return acct;
    };
    const inv = await mk('Brokerage', 'investment', 1_000_000, 1_150_000);
    await mk('Loan', 'loan', -500_000, -490_000);
    await mk('Savings', 'depository', 200_000, 230_000);
    await api('POST', '/transactions', {
      accountId: inv.id,
      postedAt: '2026-09-15',
      amountCents: -50_000,
      descriptor: 'Deposit',
    });
    const d = (await api('GET', '/reports/monthly?month=2026-09')).json.report.data.netWorth;
    expect(d.bridge).toEqual({
      contributionsCents: 50_000,
      marketCents: 100_000,
      debtPaydownCents: 10_000,
      otherCents: 30_000,
    });
    expect(d.changeCents).toBe(190_000);
    expect(d.contributionsTracked).toBe(true);
    expect(d.investmentGrowthBp).toBe(1_000);
    expect(d.sp500Bp).toBeNull();
  });

  it('reports goal progress from the account balance at month end', async () => {
    const { u, api } = await seed();
    const acct = (
      await api('POST', '/accounts', { name: 'Fund', kind: 'depository', source: 'manual' })
    ).json;
    await env.DB.prepare(
      `INSERT INTO balance_snapshot (id, user_id, account_id, as_of, balance_cents, source, created_at)
       VALUES (?1, ?2, ?3, '2026-09-30', 250_000, 'manual', 'x')`,
    )
      .bind(crypto.randomUUID(), u.userId, acct.id)
      .run();
    await api('PATCH', '/me/settings', {
      savings: {
        goals: [
          {
            id: 'g1',
            name: 'Trip',
            accountId: acct.id,
            targetCents: 1_000_000,
            monthlyCents: 50_000,
            savedCents: null,
            kind: 'goal',
            months: 6,
            monthlyExpenseCents: 0,
          },
          {
            id: 'g2',
            name: 'Buffer',
            accountId: acct.id,
            targetCents: 0,
            monthlyCents: 0,
            savedCents: null,
            kind: 'emergency',
            months: 3,
            monthlyExpenseCents: 100_000,
          },
        ],
      },
    });
    const goals = (await api('GET', '/reports/monthly?month=2026-09')).json.report.data.goals;
    expect(goals).toHaveLength(2);
    expect(goals[0]).toMatchObject({
      name: 'Trip',
      savedCents: 125_000,
      targetCents: 1_000_000,
      pct: 12,
    });
    expect(goals[1]).toMatchObject({ name: 'Buffer', savedCents: 125_000, targetCents: 300_000 });
  });
});
