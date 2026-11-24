import { z } from 'zod';
import { mulDiv } from '../budget/money';
import { BENCHMARKS, BENCHMARK_GROUPS, BENCHMARK_LABEL, benchmarkGroupOf } from './benchmarks';
import type { BenchmarkGroup } from './benchmarks';
import { ReportBudget, ReportProgress, ReportSavings, ReportSplit } from './plan';
import {
  REPORT_CONFIG,
  ReportGas,
  ReportWeather,
  ReportYoy,
  changeBp,
  formatPct,
  kindOf,
  spikeOf,
  type MoveKind,
} from './context';

export * from './benchmarks';
export * from './changelog';
export * from './csv';
export * from './context';
export * from './plan';

/**
 * The monthly report (SPEC §12.6). Everything numeric is computed here and in SQL; the model
 * only writes the short narrative around it. Pure: no I/O.
 */

const Cents = z.int();

export const ReportCategory = z.object({
  name: z.string(),
  cents: Cents,
  prevCents: Cents,
  deltaCents: Cents,
  /** Same month a year earlier; null when there is no history then. */
  lastYearCents: Cents.nullable(),
  /** This month's plan for a variable category; null for fixed bills and others. */
  plannedCents: Cents.nullable().default(null),
  /** Spending in the last months ending with this one, oldest first, for the trend line. */
  trend: z.array(Cents).max(12).default([]),
});
export type ReportCategory = z.infer<typeof ReportCategory>;

export const ReportBenchmarkRow = z.object({
  label: z.string(),
  youCents: Cents,
  avgCents: Cents,
  /** Share of total spending, basis points (1/100 of a percent), integer in transit. */
  youShareBp: Cents,
  avgShareBp: Cents,
});
export type ReportBenchmarkRow = z.infer<typeof ReportBenchmarkRow>;

export const ReportBridge = z.object({
  /** Money recorded into investment accounts. */
  contributionsCents: Cents,
  /** What the investment accounts did beyond that. */
  marketCents: Cents,
  /** Loans paid down (credit cards are in `cashCents`). */
  debtPaydownCents: Cents,
  /** Savings accounts' balance change (the Apple savings movement and the like). */
  savingsCents: Cents.default(0),
  /** Checking and other cash, net of card balances: income less everything that left. */
  cashCents: Cents.default(0),
  /** Home value and any other asset account. */
  otherCents: Cents,
});
export type ReportBridge = z.infer<typeof ReportBridge>;

export const ReportGoal = z.object({
  name: z.string(),
  savedCents: Cents,
  targetCents: Cents,
  pct: z.int(),
  monthsToGo: z.int().nullable(),
});
export type ReportGoal = z.infer<typeof ReportGoal>;

export const ReportData = z.object({
  month: z.string(),
  /** The month isn't over: figures are to date. */
  partial: z.boolean(),
  prevMonth: z.string(),
  /** The previous month has far fewer transactions than this one: compare with care. */
  prevSparse: z.boolean(),
  cash: z.object({
    incomeCents: Cents,
    spentCents: Cents,
    netCents: Cents,
    prevIncomeCents: Cents,
    prevSpentCents: Cents,
    status: z.enum(['surplus', 'deficit', 'even']),
  }),
  /** Where `cash.spentCents` went: spending against debt payments, with the money set aside
   * (savings and retirement categories) counted apart and never as spending. */
  split: ReportSplit.default({
    spendingCents: 0,
    debtPaymentCents: 0,
    savingsCents: 0,
    retirementCents: 0,
  }),
  /** Variable categories against this month's plan; null with no plan to compare. */
  budget: ReportBudget.nullable().default(null),
  /** Savings rate and what feeds it; null when there is nothing to measure. */
  savings: ReportSavings.nullable().default(null),
  progress: ReportProgress.nullable().default(null),
  categories: z.array(ReportCategory),
  /** Notable changes against the previous month: enough dollars AND percent (REPORT_CONFIG),
   * fixed categories included, with new and vanished ones. */
  movers: z.object({ up: z.array(ReportCategory), down: z.array(ReportCategory) }),
  benchmarks: z.object({
    year: z.int(),
    rows: z.array(ReportBenchmarkRow),
  }),
  netWorth: z.object({
    startCents: Cents,
    endCents: Cents,
    changeCents: Cents,
    bridge: ReportBridge,
    /** False when no deposit into an investment account is recorded as a transaction: the
     * market figure then includes deposits, and the narrative must say so. */
    contributionsTracked: z.boolean(),
    /** Index returns for the month in basis points; null when the source didn't answer. */
    sp500Bp: z.int().nullable(),
    bondsBp: z.int().nullable(),
    /** Investment growth excluding contributions, as basis points of the starting balance. */
    investmentGrowthBp: z.int().nullable(),
    /** Net worth at the end of each of the last months, this one last. */
    trendCents: z.array(Cents).max(12).default([]),
  }),
  goals: z.array(ReportGoal),
  whatsNew: z.array(z.object({ date: z.string(), text: z.string() })),
  /** Notable changes against the same month last year; empty when none stand out. */
  yoy: z.array(ReportYoy).default([]),
  /** Monthly highs and lows for the owner's ZIP; null with no ZIP set or no answer. */
  weather: ReportWeather.nullable().default(null),
  /** Regional regular-gas price; null with no ZIP, no EIA key or no answer. */
  gas: ReportGas.nullable().default(null),
  /** Facts the owner confirmed about their life in earlier months. */
  lifeNotes: z.array(z.string()).default([]),
});
export type ReportData = z.infer<typeof ReportData>;

/**
 * One or two sentences per section, or an empty string to skip it: the report only says what
 * it has something to say about. Never advice.
 */
export const ReportNarrative = z.object({
  /** One to three short sentences at the very top: what is worth knowing about the month. */
  summary: z.string().max(360),
  chips: z
    .array(z.object({ text: z.string().max(48), tone: z.enum(['good', 'note', 'watch']) }))
    .max(2),
  seasonal: z.string().max(260),
  movers: z.string().max(420),
  budget: z.string().max(300),
  yoy: z.string().max(300),
  benchmarks: z.string().max(300),
  netWorth: z.string().max(300),
  savings: z.string().max(300),
  goals: z.string().max(300),
  whatsNew: z.string().max(260),
  /** A fact the owner may want kept for later months; empty when nothing unique showed up. */
  lifeNote: z.string().max(160),
});
export type ReportNarrative = z.infer<typeof ReportNarrative>;

export const MonthlyReport = z.object({
  month: z.string(),
  generatedAt: z.string().nullable(),
  model: z.string().nullable(),
  data: ReportData,
  narrative: ReportNarrative.nullable(),
});
export type MonthlyReport = z.infer<typeof MonthlyReport>;

// ── pure helpers ────────────────────────────────────────────────────────────

/** Surplus, deficit, or even (within $1) — the break-even status. */
export function cashStatus(netCents: number): 'surplus' | 'deficit' | 'even' {
  if (Math.abs(netCents) < 100) return 'even';
  return netCents > 0 ? 'surplus' : 'deficit';
}

export interface RawCategory {
  name: string;
  cents: number;
}

/**
 * Join this month, last month and last year's month by category name. Biggest first; beyond
 * `top`, the rest fold into one "Everything else" row so the chart stays readable.
 */
export function buildCategories(
  cur: readonly RawCategory[],
  prev: readonly RawCategory[],
  lastYear: readonly RawCategory[] | null,
  top = 10,
  extra: {
    /** This month's plan by category name, for variable categories only. */
    plans?: ReadonlyMap<string, number>;
    /** Spending by category name over the last months, oldest first. */
    trend?: ReadonlyMap<string, readonly number[]>;
  } = {},
): ReportCategory[] {
  const sum = (rows: readonly RawCategory[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.name, (m.get(r.name) ?? 0) + r.cents);
    return m;
  };
  const c = sum(cur);
  const p = sum(prev);
  const y = lastYear ? sum(lastYear) : null;
  const names = new Set([...c.keys(), ...p.keys()]);
  const rows = [...names]
    .map((name) => {
      const cents = c.get(name) ?? 0;
      const prevCents = p.get(name) ?? 0;
      return {
        name,
        cents,
        prevCents,
        deltaCents: cents - prevCents,
        lastYearCents: y ? (y.get(name) ?? 0) : null,
        plannedCents: extra.plans?.get(name) ?? null,
        trend: [...(extra.trend?.get(name) ?? [])],
      };
    })
    .filter((r) => r.cents !== 0 || r.prevCents !== 0)
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  if (rows.length <= top) return rows;
  const head = rows.slice(0, top);
  const rest = rows.slice(top);
  const add = (f: (r: ReportCategory) => number) => rest.reduce((n, r) => n + f(r), 0);
  head.push({
    name: 'Everything else',
    cents: add((r) => r.cents),
    prevCents: add((r) => r.prevCents),
    deltaCents: add((r) => r.deltaCents),
    lastYearCents: y ? add((r) => r.lastYearCents ?? 0) : null,
    plannedCents: null,
    trend: [],
  });
  return head;
}

/**
 * Notable changes against the previous month: both the dollars and the percent must clear the
 * bar, so a small category doubling or a big one drifting is not news. Categories that appear
 * or vanish count. Pass the unfolded rows; the folded tail is ignored.
 */
export function topMovers(
  rows: readonly ReportCategory[],
  n: number = REPORT_CONFIG.moverMax,
): { up: ReportCategory[]; down: ReportCategory[] } {
  const hit = rows
    .filter((r) => r.name !== 'Everything else' && kindOf(r) !== null)
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
  return {
    up: hit.filter((r) => r.deltaCents > 0).slice(0, n),
    down: hit.filter((r) => r.deltaCents < 0).slice(0, n),
  };
}

/**
 * Share of total spending in each BLS group against the all-household average. Shares rather
 * than dollars: they stay meaningful whatever the household's size or income. Categories
 * with no BLS counterpart still count toward the total, so shares are of everything spent.
 */
export function buildBenchmarks(
  categories: readonly RawCategory[],
  totalSpentCents: number,
  minGapBp: number = REPORT_CONFIG.benchmarkMinGapBp,
): ReportBenchmarkRow[] {
  const band = BENCHMARKS.all;
  const mine = new Map<BenchmarkGroup, number>();
  for (const c of categories) {
    const g = benchmarkGroupOf(c.name);
    if (g) mine.set(g, (mine.get(g) ?? 0) + c.cents);
  }
  const bp = (part: number, whole: number) => (whole > 0 ? mulDiv(part, 10_000, whole) : 0);
  return BENCHMARK_GROUPS.filter((g) => (mine.get(g) ?? 0) > 0)
    .map((g) => ({
      label: BENCHMARK_LABEL[g],
      youCents: mine.get(g) ?? 0,
      avgCents: band.monthlyCents[g],
      youShareBp: bp(mine.get(g) ?? 0, totalSpentCents),
      avgShareBp: bp(band.monthlyCents[g], band.totalMonthlyCents),
    }))
    .filter((r) => Math.abs(r.youShareBp - r.avgShareBp) >= minGapBp);
}

export interface BridgeInput {
  startCents: number;
  endCents: number;
  investStartCents: number;
  investEndCents: number;
  /** Net money moved into investment accounts during the month. */
  investContributionCents: number;
  /** Loan balances (negative) at the start and end. Credit cards are not here. */
  loanStartCents: number;
  loanEndCents: number;
  /** Savings accounts' balances at the start and end. */
  savingsStartCents: number;
  savingsEndCents: number;
  /** Home value and other asset accounts. */
  otherStartCents: number;
  otherEndCents: number;
}

/**
 * Where the net worth change came from, by kind of account, so nothing is left unexplained:
 * contributions (money the owner moved into investments), market (what those accounts did
 * beyond that), loans paid down, savings accounts moving, home and other assets, and cash,
 * which is whatever remains: checking and card balances, i.e. income less everything that
 * left. The six always add up to the change exactly.
 */
export function bridgeNetWorth(i: BridgeInput): { changeCents: number; bridge: ReportBridge } {
  const changeCents = i.endCents - i.startCents;
  const contributionsCents = i.investContributionCents;
  const marketCents = i.investEndCents - i.investStartCents - contributionsCents;
  const debtPaydownCents = i.loanEndCents - i.loanStartCents;
  const savingsCents = i.savingsEndCents - i.savingsStartCents;
  const otherCents = i.otherEndCents - i.otherStartCents;
  const cashCents =
    changeCents - contributionsCents - marketCents - debtPaydownCents - savingsCents - otherCents;
  return {
    changeCents,
    bridge: {
      contributionsCents,
      marketCents,
      debtPaydownCents,
      savingsCents,
      cashCents,
      otherCents,
    },
  };
}

export interface IndexPointLike {
  date: string;
  /** Close × 100. */
  level: number;
}

/**
 * Return over a calendar month in basis points: last close on or before the month's last day
 * against the last close before its first day. null when either end is missing.
 */
export function monthReturnBp(points: readonly IndexPointLike[], month: string): number | null {
  const first = `${month}-01`;
  const last = `${month}-31`;
  let before: IndexPointLike | null = null;
  let end: IndexPointLike | null = null;
  for (const p of points) {
    if (p.date < first && (!before || p.date > before.date)) before = p;
    if (p.date >= first && p.date <= last && (!end || p.date > end.date)) end = p;
  }
  if (!before || !end || before.level <= 0) return null;
  return mulDiv(end.level - before.level, 10_000, before.level);
}

export function growthBp(startCents: number, deltaCents: number): number | null {
  return startCents > 0 ? mulDiv(deltaCents, 10_000, startCents) : null;
}

/** Deterministic headline bullets for when there is no narrative (no key, or the call failed). */
export function fallbackHeadlines(d: ReportData, fmt: (cents: number) => string): string[] {
  const out: string[] = [];
  out.push(`${fmt(d.cash.incomeCents)} in, ${fmt(d.cash.spentCents)} spent.`);
  if (d.savings && d.savings.rateBp !== null)
    out.push(`Savings rate ${formatPct(d.savings.rateBp)} of income.`);
  if (d.netWorth.changeCents !== 0)
    out.push(
      `Net worth ${d.netWorth.changeCents > 0 ? 'up' : 'down'} ${fmt(Math.abs(d.netWorth.changeCents))}.`,
    );
  const m = d.movers.up[0] ?? d.movers.down[0];
  if (m)
    out.push(
      `${m.name} ${m.deltaCents > 0 ? 'up' : 'down'} ${fmt(Math.abs(m.deltaCents))} on last month.`,
    );
  return out;
}

/**
 * The previous month is "sparse" when it has under three quarters of this month's
 * transactions: months run alike in volume, so a clearly lighter one means missing data (an
 * account not yet synced, a late import) and swings against it are not real changes.
 */
export function isPrevSparse(prevCount: number, curCount: number): boolean {
  return curCount > 0 && prevCount * 4 < curCount * 3;
}

/** "$1,234" for whole dollars, "$1,234.56" otherwise; a minus sign for negatives. Integer math. */
export function formatUsd(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rem = abs % 100;
  return `${cents < 0 ? '-' : ''}$${whole}${rem === 0 ? '' : `.${String(rem).padStart(2, '0')}`}`;
}

// ── the model call ──────────────────────────────────────────────────────────

export const REPORT_MODEL = 'claude-haiku-5-5';

export const REPORT_SYSTEM = `You write a short monthly note about one household's budget, in the voice of a morning newsletter: conversational, informative, a little light. It exists to explain what changed this month and whether spending is ahead or behind, not to alarm or advise. It is not going to change anyone's life.

Facts: you are given figures and context in the input, and nothing else. Every number, amount, date, season, holiday and cause you write must come from the input or be plain calendar knowledge about that month. Quote the formatted strings (fields ending Usd, Pct, or temperatures) exactly as given: never round, convert, add, subtract or invent a figure. If the input does not show why something moved, say what moved and do not guess why.
Skip, don't pad: every field is a string you may leave empty (""). Leave a section empty when there is no real insight. An empty section beats a filler one.
summary: one to three short sentences at the very top, the things worth knowing: a one-off expense that changes the picture (see spikes), a notable increase or decrease, a big savings rate or debt payoff month. Those are a baseline, not a limit: lead with whatever is most notable this month. Skip anything unremarkable; if nothing stands out, say so in one short sentence. Not a list of numbers.
Never repeat what a tile already shows, or the summary. The page already shows income, spending, debt payments, savings, the savings rate, net worth and its change, goal progress and the bars. Text must add what they do not: why, a trend, a comparison, whether it is ahead or behind. If you have nothing to add to a section, leave it empty.
Length: one or two sentences per section. Chips: at most 2, only for something the summary does not already say.
No lists of percentages. Use a percent only when it makes a point a dollar figure can't, and never two in a row.
Never remark that the biggest fixed costs (mortgage, rent, loans, insurance) are the biggest, or that they stayed the same. A change in one of them is news.
Savings is good, not spending. "Spent" excludes money set aside. Never call income minus spending a surplus or deficit and never judge it: it is room to add to savings or pay down debt. You may say so plainly when it is positive, and say it went past income when it is not, without alarm.
movers: the categories that moved against last month (kind up, down, new or gone), each with a short trend of recent months in trendUsd. Lead with the ones that tell a story: eating out more or less, groceries creeping, a new category. Attach the reason to the mover it explains, inline: weather for power, gas, water and other utilities when the weather clearly shifted (use the weather comparisons, e.g. "highs 8°F colder than last year"), and the regional gas price for the gas or fuel category when it moved. If the input has no weather or gas for it, say nothing about them. Say "fits" or "lines up with", never prove a cause.
budget: variable categories against this month's plan (budgetVariable and overBudget). Say whether the owner is ahead or behind, and name the categories over plan. Fixed bills are not compared: the owner sets their plan to the exact amount, so never mention fixed bills against budget or expected against posted.
yoy: only the notable differences against the same month last year (new, gone, or a big swing). Empty when the list is empty.
seasonal: holidays, school terms, annual bills or seasons that fit this month's dates and the categories. Only when the data supports it.
benchmarks: only categories listed in benchmarks.rows, which already are the unusual ones. Neutral, never a verdict. One sentence, no percent pairs.
netWorth: the bridge splits the change by kind of account: investments (contributions, market), loans paid, savings accounts, cash (checking and cards: income less everything that left), home and other assets. Explain the biggest piece in words and say whether the trend over recent months is up or down. Do not restate the totals. When contributionsTracked is false, deposits into investments are not recorded separately, so say the market figure includes any deposits. Use index returns only when present.
savings: the savings rate, its recent average, loan principal paid and retirement contributions. Say whether the rate is above or below its recent average and what moved it. When basis is "categories" or retirementEstimated is true, say it is approximate. Never restate the plain totals.
goals, whatsNew: only when there is something to say. whatsNew lists features shipped this month: say they are new, never give a date.
If prevSparse is true, last month has far fewer transactions: say the comparison is rough rather than presenting swings as real.
Overspending is a debt carried forward, not a failure. No scolding, no alarm, no advice, no "consider" or "should". Transfers and card payments are already excluded; do not mention them. Never mention merchants, account names or account numbers.
lifeNote: leave empty unless something unique shows up that the owner may want remembered for later months (income changed by 10% or more, or a major category changed by 30% or more with no seasonal or price explanation in the input). Then write one plain factual sentence from the input, such as "Income was $X, up from $Y." Never guess a cause. Facts in lifeNotes are already known: do not repeat them as news, but use them to explain a change they account for.`;

/** JSON Schema for `output_config.format`, kept in step with `ReportNarrative`. */
export const REPORT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'chips',
    'seasonal',
    'movers',
    'budget',
    'yoy',
    'benchmarks',
    'netWorth',
    'savings',
    'goals',
    'whatsNew',
    'lifeNote',
  ],
  properties: {
    summary: { type: 'string' },
    chips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'tone'],
        properties: {
          text: { type: 'string' },
          tone: { type: 'string', enum: ['good', 'note', 'watch'] },
        },
      },
    },
    seasonal: { type: 'string' },
    movers: { type: 'string' },
    budget: { type: 'string' },
    yoy: { type: 'string' },
    benchmarks: { type: 'string' },
    netWorth: { type: 'string' },
    savings: { type: 'string' },
    goals: { type: 'string' },
    whatsNew: { type: 'string' },
    lifeNote: { type: 'string' },
  },
} as const;

type TempsLike = { avgHighF: number; avgLowF: number; maxF: number; minF: number; days: number };

/** "6°F colder" / "6°F warmer" / "no different" for a change in temperature. */
function warmer(now: number, then: number): string {
  const d = now - then;
  return d === 0 ? 'no different' : `${Math.abs(d)}°F ${d > 0 ? 'warmer' : 'colder'}`;
}

/**
 * The user message. Every amount is a formatted string and the raw cents and basis points are
 * left out, so the model has one form to quote and `groundNarrative` can check its numbers
 * against exactly what it was shown. Weather and gas arrive as comparisons it can attach to
 * the category they explain.
 */
export function buildReportPrompt(d: ReportData, fmt: (cents: number) => string): string {
  const view = (o: object): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      const isNum = typeof v === 'number' || v === null;
      if (isNum && k === 'cents') out['usd'] = v === null ? null : fmt(v);
      else if (isNum && k.endsWith('Cents'))
        out[`${k.slice(0, -5)}Usd`] = v === null ? null : fmt(v);
      else if (isNum && k.endsWith('Bp'))
        out[`${k.slice(0, -2)}Pct`] = v === null ? null : formatPct(v);
      else out[k] = v;
    }
    return out;
  };
  const move = (name: string, kind: MoveKind, now: number, then: number, label: string) => ({
    name,
    kind,
    nowUsd: fmt(now),
    [`${label}Usd`]: fmt(then),
    changeUsd: fmt(Math.abs(now - then)),
    pct: kind === 'new' || kind === 'gone' ? null : formatPct(Math.abs(changeBp(now, then) ?? 0)),
  });
  const trendOf = (name: string) => d.categories.find((c) => c.name === name)?.trend ?? [];
  const temps = (t: TempsLike | null) =>
    t && {
      avgHigh: `${t.avgHighF}°F`,
      avgLow: `${t.avgLowF}°F`,
      hottestDay: `${t.maxF}°F`,
      coldestNight: `${t.minF}°F`,
    };
  const w = d.weather;
  const weather = w && {
    thisMonth: temps(w.month),
    lastMonth: temps(w.prev),
    sameMonthLastYear: temps(w.lastYear),
    highsVsLastMonth: w.prev ? warmer(w.month.avgHighF, w.prev.avgHighF) : null,
    highsVsLastYear: w.lastYear ? warmer(w.month.avgHighF, w.lastYear.avgHighF) : null,
    lowsVsLastYear: w.lastYear ? warmer(w.month.avgLowF, w.lastYear.avgLowF) : null,
  };
  const g = d.gas;
  const gal = (c: number) => `${fmt(c)} a gallon`;
  const gasMove = (now: number, then: number | null) =>
    then === null
      ? null
      : now === then
        ? 'unchanged'
        : `${fmt(Math.abs(now - then))} a gallon ${now > then ? 'higher' : 'lower'}`;
  const gas = g && {
    region: g.region,
    thisMonth: gal(g.monthCents),
    lastMonth: g.prevCents === null ? null : gal(g.prevCents),
    sameMonthLastYear: g.lastYearCents === null ? null : gal(g.lastYearCents),
    vsLastMonth: gasMove(g.monthCents, g.prevCents),
    vsLastYear: gasMove(g.monthCents, g.lastYearCents),
  };
  const sv = d.savings;
  const pr = d.progress;
  const body = {
    month: d.month,
    prevMonth: d.prevMonth,
    prevSparse: d.prevSparse,
    cash: {
      ...view({
        incomeCents: d.cash.incomeCents,
        spentCents: d.cash.spentCents,
        prevIncomeCents: d.cash.prevIncomeCents,
        prevSpentCents: d.cash.prevSpentCents,
        leftAfterSpendingCents: d.cash.netCents,
      }),
      ...view({
        spendingCents: d.split.spendingCents,
        debtPaymentCents: d.split.debtPaymentCents,
      }),
    },
    categories: d.categories.map((c) =>
      view({ ...c, plannedCents: undefined, trend: undefined, deltaCents: c.deltaCents }),
    ),
    moves: [...d.movers.up, ...d.movers.down].flatMap((r) => {
      const k = kindOf(r);
      return k
        ? [
            {
              ...move(r.name, k, r.cents, r.prevCents, 'prev'),
              trendUsd: trendOf(r.name).map((c) => fmt(c)),
            },
          ]
        : [];
    }),
    spikes: d.categories.flatMap((c) => {
      const sp = spikeOf(c);
      return sp ? [{ name: c.name, nowUsd: fmt(c.cents), usualUsd: fmt(sp.usualCents) }] : [];
    }),
    budgetVariable:
      d.budget && view({ plannedCents: d.budget.plannedCents, spentCents: d.budget.spentCents }),
    overBudget:
      d.budget?.over.map((o) => ({
        name: o.name,
        plannedUsd: fmt(o.plannedCents),
        spentUsd: fmt(o.spentCents),
        overUsd: fmt(o.spentCents - o.plannedCents),
      })) ?? [],
    yoy: d.yoy.map((y) => move(y.name, y.kind, y.cents, y.lastYearCents, 'lastYear')),
    benchmarks: { year: d.benchmarks.year, rows: d.benchmarks.rows.map(view) },
    netWorth: {
      ...view({
        startCents: d.netWorth.startCents,
        endCents: d.netWorth.endCents,
        changeCents: d.netWorth.changeCents,
      }),
      bridge: view(d.netWorth.bridge),
      trendUsd: d.netWorth.trendCents.map((c) => fmt(c)),
      contributionsTracked: d.netWorth.contributionsTracked,
      ...view({
        sp500Bp: d.netWorth.sp500Bp,
        bondsBp: d.netWorth.bondsBp,
        investmentGrowthBp: d.netWorth.investmentGrowthBp,
      }),
    },
    savings: sv && {
      ...view({
        savingsCents: sv.savingsCents,
        debtPrincipalCents: sv.debtPrincipalCents,
        retirementCents: sv.retirementCents,
        rateBp: sv.rateBp,
        avgRateBp: sv.avgRateBp,
      }),
      retirementEstimated: sv.retirementEstimated,
      basis: sv.basis,
    },
    progress: pr && {
      debt: pr.debt.map(view),
      retirement: view(pr.retirement),
      savingsBalanceUsd: fmt(pr.savingsBalanceCents),
    },
    weather,
    gas,
    goals: d.goals.map(view),
    whatsNew: d.whatsNew.map((e) => e.text),
    lifeNotes: d.lifeNotes,
  };
  return `Write the note for this month. Data (JSON):\n${JSON.stringify(body)}`;
}

/** Validate and trim model output; null when it doesn't fit the schema. */
export function parseNarrative(text: string): ReportNarrative | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : s);
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    // Trim over-long strings rather than discard a whole report for a few extra characters.
    for (const [k, n] of [
      ['summary', 360],
      ['seasonal', 260],
      ['movers', 420],
      ['budget', 300],
      ['yoy', 300],
      ['benchmarks', 300],
      ['netWorth', 300],
      ['savings', 300],
      ['goals', 300],
      ['whatsNew', 260],
      ['lifeNote', 160],
    ] as const)
      o[k] = clip(o[k], n);
    if (Array.isArray(o['chips']))
      o['chips'] = o['chips'].slice(0, 2).map((c) => {
        if (c && typeof c === 'object')
          (c as Record<string, unknown>)['text'] = clip((c as Record<string, unknown>)['text'], 48);
        return c;
      });
  }
  const r = ReportNarrative.safeParse(json);
  return r.success ? r.data : null;
}
