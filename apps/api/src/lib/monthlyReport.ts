import { addPeriods, hasEnded, periodEnd, periodStart } from '@rise/shared/budget';
import { balanceAt } from '@rise/shared/networth';
import {
  REPORT_JSON_SCHEMA,
  REPORT_MODEL,
  REPORT_SYSTEM,
  ReportData,
  bridgeNetWorth,
  buildBenchmarks,
  buildCategories,
  buildReportPrompt,
  cashStatus,
  changelogFor,
  formatUsd,
  growthBp,
  isPrevSparse,
  monthReturnBp,
  parseNarrative,
  topMovers,
  BENCHMARK_YEAR,
  type RawCategory,
  type ReportNarrative,
} from '@rise/shared/report';
import { emergencyTargetCents, goalProgress, shareAccountBalance } from '@rise/shared/savings';
import type { SavingsGoal } from '@rise/shared/schemas';
import {
  getReportRow,
  incomeByPeriod,
  investmentInflow,
  listAccountsForNetWorth,
  listAggregates,
  listCategoriesWithArchived,
  listGroupsWithArchived,
  listSnapshots,
  saveReportRow,
  type UserId,
} from '../db';
import { fetchSp500, parseYahoo, type IndexPoint } from './sp500';

/**
 * The monthly report (SPEC §12.6). `computeReportData` is plain SQL and arithmetic and always
 * works. `generateNarrative` is the one optional model call: it sends only the aggregates in
 * `ReportData` (category names and totals, never merchants, account names or numbers) and
 * stores the result. With no key the report still renders from the figures alone.
 */

/** Bond index for context only, via Yahoo's AGG fund (no key). null when it doesn't answer. */
async function fetchBonds(
  from: string,
  to: string,
  fetcher: typeof fetch,
): Promise<IndexPoint[] | null> {
  try {
    const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
    const p2 = Math.floor(Date.parse(`${to}T00:00:00Z`) / 1000) + 86_400;
    const res = await fetcher(
      `https://query1.finance.yahoo.com/v8/finance/chart/AGG?period1=${p1}&period2=${p2}&interval=1d`,
      { headers: { 'user-agent': 'Mozilla/5.0' }, cf: { cacheTtl: 3600, cacheEverything: true } },
    );
    if (!res.ok) return null;
    const pts = parseYahoo(await res.json());
    return pts.length > 0 ? pts : null;
  } catch {
    return null;
  }
}

export async function computeReportData(
  userId: UserId,
  db: D1Database,
  month: string,
  today: string,
  goals: readonly SavingsGoal[],
  /** null skips the market-data calls (the live preview needs no index returns). */
  fetcher: typeof fetch | null = fetch,
): Promise<ReportData> {
  const prev = addPeriods(month, -1);
  const lastYear = addPeriods(month, -12);
  const partial = !hasEnded(month, today);
  const start = periodEnd(prev);
  const end = partial ? today : periodEnd(month);

  const [aggs, lyAggs, cats, groups, income, accts, snaps, inflow, sp, bonds] = await Promise.all([
    listAggregates(userId, db, prev, month),
    listAggregates(userId, db, lastYear, lastYear),
    listCategoriesWithArchived(userId, db),
    listGroupsWithArchived(userId, db),
    incomeByPeriod(userId, db, prev, month),
    listAccountsForNetWorth(userId, db),
    listSnapshots(userId, db, { from: start, to: end }),
    investmentInflow(userId, db, start, end),
    fetcher ? fetchSp500(periodStart(prev), periodEnd(month), fetcher) : null,
    fetcher ? fetchBonds(periodStart(prev), periodEnd(month), fetcher) : null,
  ]);

  // Transfers and card payments sit in unbudgeted categories, so they are never in the
  // aggregate: spending here is the budget's own definition, with no double count.
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const spendBy = (rows: typeof aggs, period: string): { rows: RawCategory[]; txns: number } => {
    const out: RawCategory[] = [];
    let txns = 0;
    for (const a of rows) {
      if (a.periodId !== period) continue;
      const c = catById.get(a.categoryId);
      const g = c && groupById.get(c.groupId);
      if (!c || !g || g.kind !== 'expense') continue;
      out.push({ name: c.name, cents: a.spentCents });
      txns += a.txnCount;
    }
    return { rows: out, txns };
  };
  const cur = spendBy(aggs, month);
  const old = spendBy(aggs, prev);
  const ly = spendBy(lyAggs, lastYear);
  const sum = (r: RawCategory[]) => r.reduce((n, x) => n + x.cents, 0);
  const incomeOf = (p: string) => income.find((i) => i.periodId === p)?.cents ?? 0;

  const categories = buildCategories(cur.rows, old.rows, ly.rows.length > 0 ? ly.rows : null);
  const spentCents = sum(cur.rows);
  const incomeCents = incomeOf(month);
  const netCents = incomeCents - spentCents;

  // Net worth. Accounts whose first balance is after the start are left out of the bridge:
  // an account appearing is not a gain.
  const byAccount = new Map<string, { asOf: string; balanceCents: number }[]>();
  for (const s of snaps) {
    const list = byAccount.get(s.account_id) ?? [];
    list.push({ asOf: s.as_of, balanceCents: s.balance_cents });
    byAccount.set(s.account_id, list);
  }
  const live = accts.filter((a) => a.includeInNetWorth && !a.archivedAt);
  const known = live.flatMap((a) => {
    const snapshots = byAccount.get(a.id) ?? [];
    const startBal = balanceAt(snapshots, start);
    const endBal = balanceAt(snapshots, end);
    return startBal && endBal
      ? [{ kind: a.kind, start: startBal.balanceCents, end: endBal.balanceCents }]
      : [];
  });
  const total = (pick: (k: (typeof known)[number]) => boolean, f: 'start' | 'end') =>
    known.filter(pick).reduce((n, k) => n + k[f], 0);
  const isInvest = (k: (typeof known)[number]) => k.kind === 'investment';
  const isDebt = (k: (typeof known)[number]) => k.kind === 'credit' || k.kind === 'loan';
  const all = () => true;
  const startCents = total(all, 'start');
  const endCents = total(all, 'end');
  const { changeCents, bridge } = bridgeNetWorth({
    startCents,
    endCents,
    investStartCents: total(isInvest, 'start'),
    investEndCents: total(isInvest, 'end'),
    investContributionCents: inflow.cents,
    debtStartCents: total(isDebt, 'start'),
    debtEndCents: total(isDebt, 'end'),
  });
  const investStart = total(isInvest, 'start');

  // Goals: each goal's share of its account at the end of the month.
  const balanceOf = (accountId: string): number =>
    balanceAt(byAccount.get(accountId) ?? [], end)?.balanceCents ?? 0;
  const goalRows = goals.map((g) => {
    const siblings = goals.filter((x) => x.accountId === g.accountId);
    const shares = shareAccountBalance(
      balanceOf(g.accountId),
      siblings.map((x) => x.savedCents),
    );
    const savedCents = shares[siblings.indexOf(g)] as number;
    const targetCents =
      g.kind === 'emergency'
        ? emergencyTargetCents(g.months, g.monthlyExpenseCents)
        : g.targetCents;
    const p = goalProgress({
      savedCents,
      targetCents: Math.max(targetCents, 1),
      monthlyCents: g.monthlyCents,
    });
    return { name: g.name, savedCents, targetCents, pct: p.pct, monthsToGo: p.monthsToGo };
  });

  return ReportData.parse({
    month,
    partial,
    prevMonth: prev,
    prevSparse: isPrevSparse(old.txns, cur.txns),
    cash: {
      incomeCents,
      spentCents,
      netCents,
      prevIncomeCents: incomeOf(prev),
      prevSpentCents: sum(old.rows),
      status: cashStatus(netCents),
    },
    categories,
    movers: topMovers(categories),
    benchmarks: { year: BENCHMARK_YEAR, rows: buildBenchmarks(cur.rows, spentCents) },
    netWorth: {
      startCents,
      endCents,
      changeCents,
      bridge,
      contributionsTracked: inflow.tracked,
      sp500Bp: sp ? monthReturnBp(sp, month) : null,
      bondsBp: bonds ? monthReturnBp(bonds, month) : null,
      investmentGrowthBp: growthBp(investStart, bridge.marketCents),
    },
    goals: goalRows,
    whatsNew: changelogFor(month),
  });
}

export interface ModelResult {
  narrative: ReportNarrative;
  inputTokens: number;
  outputTokens: number;
}

/**
 * One Messages API call. Plain `fetch` rather than the SDK: this runs inside a Worker with a
 * 10 ms CPU budget, one request shape needs none of the SDK's machinery, and it keeps the
 * bundle (and cold start) unchanged for everyone who never sets a key. Returns null on any
 * failure (no network, bad key, refusal, unparsable output): the report just has no narrative.
 */
export async function generateNarrative(
  apiKey: string,
  data: ReportData,
  fetcher: typeof fetch = fetch,
): Promise<ModelResult | null> {
  try {
    const res = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: REPORT_MODEL,
        // Thinking tokens count against this, so leave room beyond the ~600-token answer.
        max_tokens: 4_000,
        system: REPORT_SYSTEM,
        messages: [{ role: 'user', content: buildReportPrompt(data, formatUsd) }],
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: REPORT_JSON_SCHEMA },
        },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (body.stop_reason === 'refusal' || body.stop_reason === 'max_tokens') return null;
    const text = body.content?.find((b) => b.type === 'text')?.text;
    const narrative = text ? parseNarrative(text) : null;
    if (!narrative) return null;
    return {
      narrative,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    };
  } catch {
    return null;
  }
}

/** Compute, ask the model, store. Returns false when the model step failed (nothing stored). */
export async function generateAndStore(
  userId: UserId,
  db: D1Database,
  apiKey: string,
  month: string,
  today: string,
  goals: readonly SavingsGoal[],
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const data = await computeReportData(userId, db, month, today, goals, fetcher);
  const r = await generateNarrative(apiKey, data, fetcher);
  if (!r) return false;
  await saveReportRow(userId, db, {
    periodId: month,
    generatedAt: new Date().toISOString(),
    model: REPORT_MODEL,
    dataJson: JSON.stringify(data),
    narrativeJson: JSON.stringify(r.narrative),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  });
  return true;
}

/**
 * Nightly housekeeping hook: in the first days of a month, write last month's report if the
 * owner turned it on, a key is set, and it isn't there yet. Retries on later nights if the
 * call failed. Never throws into the cron.
 */
export async function runMonthlyReportCron(
  userId: UserId,
  db: D1Database,
  apiKey: string | undefined,
  auto: boolean,
  goals: readonly SavingsGoal[],
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<'skipped' | 'done' | 'failed'> {
  if (!apiKey || !auto || now.getUTCDate() > 3) return 'skipped';
  const today = now.toISOString().slice(0, 10);
  const month = addPeriods(today.slice(0, 7), -1);
  if (await getReportRow(userId, db, month)) return 'skipped';
  return (await generateAndStore(userId, db, apiKey, month, today, goals, fetcher))
    ? 'done'
    : 'failed';
}
