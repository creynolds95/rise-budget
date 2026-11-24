import { addPeriods, hasEnded, periodEnd, periodStart, resolvePlanned } from '@rise/shared/budget';
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
  classifyCategory,
  compareBudget,
  groundNarrative,
  rateBp,
  splitRows,
  trailingRateBp,
  yoyNotes,
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
import type { SavingsGoal, UserSettings } from '@rise/shared/schemas';
import {
  allocationsBetween,
  getReportRow,
  planDefaultOf,
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
import { fetchContext, type ContextOptions } from './reportContext';
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

/** What the report needs beyond the figures: the outside context and which accounts are which. */
export interface ReportOptions extends ContextOptions {
  /** Accounts that hold savings (goal and followed accounts): their balance change is savings. */
  savingsAccountIds?: readonly string[];
  /** Retirement accounts and what the plan puts into each every month. */
  retirement?: readonly { accountId: string; monthlyCents: number }[];
  /** Loan accounts by the plan's group, for the payoff rows. */
  loanGroups?: readonly { accountId: string; group: 'student' | 'mortgage' }[];
}

const NO_OPTS: ReportOptions = { zip: '', lifeNotes: [] };

export async function computeReportData(
  userId: UserId,
  db: D1Database,
  month: string,
  today: string,
  goals: readonly SavingsGoal[],
  /** null skips the market-data calls (the live preview needs no index returns). */
  fetcher: typeof fetch | null = fetch,
  opts: ReportOptions = NO_OPTS,
): Promise<ReportData> {
  const prev = addPeriods(month, -1);
  const lastYear = addPeriods(month, -12);
  const partial = !hasEnded(month, today);
  const end = partial ? today : periodEnd(month);
  // The last six months of spending for the trend lines; the last three before this one for
  // the savings rate's average, which also needs balances from the start of the first.
  const trendFrom = addPeriods(month, -5);
  const rateMonths = [3, 2, 1, 0].map((i) => addPeriods(month, -i));
  const monthStart = (m: string) => periodEnd(addPeriods(m, -1));
  const monthEnd = (m: string) => (m === month ? end : periodEnd(m));

  const [aggs, lyAggs, cats, groups, income, accts, snaps, inflows, plans, sp, bonds, ext] =
    await Promise.all([
      listAggregates(userId, db, trendFrom, month),
      listAggregates(userId, db, lastYear, lastYear),
      listCategoriesWithArchived(userId, db),
      listGroupsWithArchived(userId, db),
      incomeByPeriod(userId, db, rateMonths[0] as string, month),
      listAccountsForNetWorth(userId, db),
      listSnapshots(userId, db, { from: monthStart(rateMonths[0] as string), to: end }),
      Promise.all(rateMonths.map((m) => investmentInflow(userId, db, monthStart(m), monthEnd(m)))),
      allocationsBetween(userId, db, month, month),
      fetcher ? fetchSp500(periodStart(prev), periodEnd(month), fetcher) : null,
      fetcher ? fetchBonds(periodStart(prev), periodEnd(month), fetcher) : null,
      fetcher ? fetchContext(opts, month, today, fetcher) : null,
    ]);

  // Transfers and card payments sit in unbudgeted categories, so they are never in the
  // aggregate: spending here is the budget's own definition, with no double count.
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const spendBy = (
    rows: typeof aggs,
    period: string,
  ): { rows: RawCategory[]; txns: number; byId: Map<string, number> } => {
    const out: RawCategory[] = [];
    const byId = new Map<string, number>();
    let txns = 0;
    for (const a of rows) {
      if (a.periodId !== period) continue;
      const c = catById.get(a.categoryId);
      const g = c && groupById.get(c.groupId);
      if (!c || !g || g.kind !== 'expense') continue;
      out.push({ name: c.name, cents: a.spentCents });
      byId.set(c.id, a.spentCents);
      txns += a.txnCount;
    }
    return { rows: out, txns, byId };
  };
  // Money set aside (savings, retirement) is not spending; debt payments stay in the list.
  const spending = (rows: RawCategory[]) =>
    rows.filter((r) => ['spending', 'debt'].includes(classifyCategory(r.name)));
  const cur = spendBy(aggs, month);
  const old = spendBy(aggs, prev);
  const ly = spendBy(lyAggs, lastYear);
  const curRows = spending(cur.rows);
  const oldRows = spending(old.rows);
  const sum = (r: RawCategory[]) => r.reduce((n, x) => n + x.cents, 0);
  const incomeOf = (p: string) => income.find((i) => i.periodId === p)?.cents ?? 0;

  const lyRows = ly.rows.length > 0 ? spending(ly.rows) : null;
  const trend = new Map<string, number[]>();
  const names = new Set([...curRows, ...oldRows].map((r) => r.name));
  for (let i = 5; i >= 0; i--) {
    const by = new Map<string, number>();
    for (const r of spending(spendBy(aggs, addPeriods(month, -i)).rows))
      by.set(r.name, (by.get(r.name) ?? 0) + r.cents);
    for (const n of names) trend.set(n, [...(trend.get(n) ?? []), by.get(n) ?? 0]);
  }

  // Variable categories against this month's plan. Fixed bills and bills are left out: the
  // owner sets their plan to the exact amount once it posts, so they are always on budget.
  const planRows = new Map(plans.map((a) => [a.category_id, a]));
  const variable = cats.flatMap((c) => {
    const g = groupById.get(c.groupId);
    if (!g || g.kind !== 'expense' || c.spendShape === 'fixed' || c.isBill) return [];
    if (classifyCategory(c.name) !== 'spending') return [];
    const row = planRows.get(c.id);
    const plannedCents = resolvePlanned(
      row && { plannedCents: row.planned_cents },
      planDefaultOf(c),
      month,
    );
    return plannedCents > 0
      ? [{ name: c.name, plannedCents, spentCents: cur.byId.get(c.id) ?? 0 }]
      : [];
  });
  const planByName = new Map(variable.map((v) => [v.name, v.plannedCents]));
  const categories = buildCategories(curRows, oldRows, lyRows, 10, { plans: planByName, trend });
  const spentCents = sum(curRows);
  const incomeCents = incomeOf(month);
  const netCents = incomeCents - spentCents;

  // Net worth, by kind of account. Accounts whose first balance is after the start are left
  // out of the bridge: an account appearing is not a gain.
  const byAccount = new Map<string, { asOf: string; balanceCents: number }[]>();
  for (const s of snaps) {
    const list = byAccount.get(s.account_id) ?? [];
    list.push({ asOf: s.as_of, balanceCents: s.balance_cents });
    byAccount.set(s.account_id, list);
  }
  const live = accts.filter((a) => a.includeInNetWorth && !a.archivedAt);
  const savingsIds = new Set(opts.savingsAccountIds ?? []);
  const retireIds = new Set((opts.retirement ?? []).map((r) => r.accountId));
  const loanGroup = new Map((opts.loanGroups ?? []).map((l) => [l.accountId, l.group]));
  const knownIn = (m: string) =>
    live.flatMap((a) => {
      const snapshots = byAccount.get(a.id) ?? [];
      const startBal = balanceAt(snapshots, monthStart(m));
      const endBal = balanceAt(snapshots, monthEnd(m));
      return startBal && endBal
        ? [{ id: a.id, kind: a.kind, start: startBal.balanceCents, end: endBal.balanceCents }]
        : [];
    });
  type Known = ReturnType<typeof knownIn>[number];
  const known = knownIn(month);
  const total = (pick: (k: Known) => boolean, f: 'start' | 'end', from: Known[] = known) =>
    from.filter(pick).reduce((n, k) => n + k[f], 0);
  const isInvest = (k: Known) => k.kind === 'investment';
  const isLoan = (k: Known) => k.kind === 'loan';
  const isSavings = (k: Known) => savingsIds.has(k.id);
  const isOther = (k: Known) => k.kind === 'other';
  const startCents = total(() => true, 'start');
  const endCents = total(() => true, 'end');
  const inflow = inflows[3] as (typeof inflows)[number];
  const { changeCents, bridge } = bridgeNetWorth({
    startCents,
    endCents,
    investStartCents: total(isInvest, 'start'),
    investEndCents: total(isInvest, 'end'),
    investContributionCents: inflow.cents,
    loanStartCents: total(isLoan, 'start'),
    loanEndCents: total(isLoan, 'end'),
    savingsStartCents: total(isSavings, 'start'),
    savingsEndCents: total(isSavings, 'end'),
    otherStartCents: total(isOther, 'start'),
    otherEndCents: total(isOther, 'end'),
  });
  const investStart = total(isInvest, 'start');

  // Net worth at each month end, over the accounts known at the first, so a new account is not
  // a gain.
  const first = rateMonths[0] as string;
  const trendAccts = live.filter((a) => balanceAt(byAccount.get(a.id) ?? [], monthStart(first)));
  const nwTrend =
    trendAccts.length === 0
      ? []
      : rateMonths.map((m) =>
          trendAccts.reduce(
            (n, a) => n + (balanceAt(byAccount.get(a.id) ?? [], monthEnd(m))?.balanceCents ?? 0),
            0,
          ),
        );

  // Savings rate: (savings moved + loan principal + retirement deposits) / income.
  const planned = (opts.retirement ?? []).reduce((n, r) => n + r.monthlyCents, 0);
  const setAside = (m: string, i: number) => {
    const k = m === month ? known : knownIn(m);
    const infl = inflows[i] as (typeof inflows)[number];
    const savingsCents = total(isSavings, 'end', k) - total(isSavings, 'start', k);
    const debtPrincipalCents = total(isLoan, 'end', k) - total(isLoan, 'start', k);
    const estimated = !infl.tracked && planned > 0;
    const retirementCents = infl.tracked ? infl.cents : planned;
    return {
      savingsCents,
      debtPrincipalCents,
      retirementCents,
      retirementEstimated: estimated,
      totalCents: savingsCents + debtPrincipalCents + retirementCents,
    };
  };
  const now = setAside(month, 3);
  const earlier = rateMonths
    .slice(0, 3)
    .map((m, i) => ({ totalCents: setAside(m, i).totalCents, incomeCents: incomeOf(m) }))
    .filter((m) => m.incomeCents > 0);
  const savings = {
    ...now,
    rateBp: rateBp(now.totalCents, incomeCents),
    avgRateBp: trailingRateBp(earlier),
    basis: 'balances' as const,
  };

  const debtRows = new Map<string, { owedCents: number; paidCents: number }>();
  for (const k of known.filter(isLoan)) {
    const g = loanGroup.get(k.id);
    const label = g === 'student' ? 'Student loans' : g === 'mortgage' ? 'Mortgage' : 'Other loans';
    const r = debtRows.get(label) ?? { owedCents: 0, paidCents: 0 };
    debtRows.set(label, {
      owedCents: r.owedCents - k.end,
      paidCents: r.paidCents + (k.end - k.start),
    });
  }
  const retireKnown = known.filter((k) => retireIds.has(k.id));
  const progress =
    debtRows.size === 0 && retireKnown.length === 0 && !known.some(isSavings)
      ? null
      : {
          debt: [...debtRows].map(([label, r]) => ({ label, ...r })),
          retirement: {
            balanceCents: total(() => true, 'end', retireKnown),
            contributedCents: now.retirementCents,
            plannedCents: planned,
            estimated: now.retirementEstimated,
          },
          savingsBalanceCents: total(isSavings, 'end'),
        };

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
      prevSpentCents: sum(oldRows),
      status: cashStatus(netCents),
    },
    split: splitRows(cur.rows),
    budget: variable.length > 0 ? compareBudget(variable) : null,
    savings: incomeCents > 0 || savings.totalCents !== 0 ? savings : null,
    progress,
    categories,
    movers: topMovers(buildCategories(curRows, oldRows, null, 200)),
    benchmarks: { year: BENCHMARK_YEAR, rows: buildBenchmarks(curRows, spentCents) },
    netWorth: {
      startCents,
      endCents,
      changeCents,
      bridge,
      trendCents: nwTrend,
      contributionsTracked: inflow.tracked,
      sp500Bp: sp ? monthReturnBp(sp, month) : null,
      bondsBp: bonds ? monthReturnBp(bonds, month) : null,
      investmentGrowthBp: growthBp(investStart, bridge.marketCents),
    },
    goals: goalRows,
    whatsNew: changelogFor(month),
    yoy: yoyNotes(curRows, lyRows),
    weather: ext?.weather ?? null,
    gas: ext?.gas ?? null,
    lifeNotes: [...opts.lifeNotes],
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
async function askModel(
  apiKey: string,
  prompt: string,
  fetcher: typeof fetch,
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
        // Thinking tokens count against this, so leave room beyond the ~700-token answer.
        max_tokens: 6_000,
        system: REPORT_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        output_config: {
          effort: 'medium',
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

/**
 * The written note. Every number in it must be one the model was shown: a sentence with
 * any other is dropped. If anything was dropped it asks once more and keeps the cleaner of the
 * two, so a stray figure costs a sentence, never a wrong number in the report.
 */
export async function generateNarrative(
  apiKey: string,
  data: ReportData,
  fetcher: typeof fetch = fetch,
): Promise<ModelResult | null> {
  const prompt = buildReportPrompt(data, formatUsd);
  let best: (ModelResult & { dropped: number }) | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await askModel(apiKey, prompt, fetcher);
    if (!r) break;
    const g = groundNarrative(r.narrative, prompt);
    if (!best || g.dropped < best.dropped)
      best = { ...r, narrative: g.narrative, dropped: g.dropped };
    if (g.dropped === 0) break;
  }
  return (
    best && {
      narrative: best.narrative,
      inputTokens: best.inputTokens,
      outputTokens: best.outputTokens,
    }
  );
}

/** Store a computed report; `r` null is the figures-only report (no written note). */
async function storeReport(
  userId: UserId,
  db: D1Database,
  month: string,
  data: ReportData,
  r: ModelResult | null,
): Promise<void> {
  await saveReportRow(userId, db, {
    periodId: month,
    generatedAt: new Date().toISOString(),
    model: r ? REPORT_MODEL : 'none',
    dataJson: JSON.stringify(data),
    narrativeJson: JSON.stringify(r ? r.narrative : null),
    inputTokens: r?.inputTokens ?? 0,
    outputTokens: r?.outputTokens ?? 0,
  });
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
  opts: ReportOptions = NO_OPTS,
): Promise<boolean> {
  const data = await computeReportData(userId, db, month, today, goals, fetcher, opts);
  const r = await generateNarrative(apiKey, data, fetcher);
  if (!r) return false;
  await storeReport(userId, db, month, data, r);
  return true;
}

/** 'first': the run on the 1st, after the morning sync. 'retry': nights 2 and 3, only if missing. */
export type ReportWindow = 'first' | 'retry';

/**
 * Last month's report, written once on the 1st (a monthly cron after the morning sync, so the
 * last day's transactions are in). With a key it adds the written note; with none it stores the
 * figures alone, so the report and its Dashboard card still appear. If the model call fails the
 * 'retry' runs on the next two nights try again, and the last of them stores the figures alone
 * rather than leave no report. A stored month is never rewritten. Never throws into the cron.
 */
export async function runMonthlyReportCron(
  userId: UserId,
  db: D1Database,
  apiKey: string | undefined,
  goals: readonly SavingsGoal[],
  now: Date,
  window: ReportWindow = 'first',
  fetcher: typeof fetch = fetch,
  opts: ReportOptions = NO_OPTS,
): Promise<'skipped' | 'done' | 'failed'> {
  const day = now.getUTCDate();
  if (window === 'first' ? day !== 1 : day < 2 || day > 3) return 'skipped';
  const today = now.toISOString().slice(0, 10);
  const month = addPeriods(today.slice(0, 7), -1);
  if (await getReportRow(userId, db, month)) return 'skipped';
  const data = await computeReportData(userId, db, month, today, goals, fetcher, opts);
  const r = apiKey ? await generateNarrative(apiKey, data, fetcher) : null;
  if (apiKey && !r && day < 3) return 'failed';
  await storeReport(userId, db, month, data, r);
  return apiKey && !r ? 'failed' : 'done';
}

/** The report's options from the owner's settings and the deployment's keys. */
export function contextOptions(
  settings: Pick<UserSettings, 'monthlyReport' | 'savings' | 'follow' | 'retirement' | 'debt'>,
  eiaKey: string | undefined,
): ReportOptions {
  return {
    zip: settings.monthlyReport.zip,
    eiaKey,
    lifeNotes: settings.monthlyReport.lifeNotes
      .filter((n) => n.status === 'kept')
      .map((n) => n.text),
    savingsAccountIds: [
      ...new Set([
        ...(settings.savings?.goals ?? []).map((g) => g.accountId),
        ...settings.follow.rules.map((r) => r.accountId),
      ]),
    ],
    retirement: settings.retirement?.contributions ?? [],
    loanGroups: (settings.debt?.loans ?? []).map((l) => ({
      accountId: l.accountId,
      group: l.group,
    })),
  };
}
