import { z } from 'zod';
import { mulDiv } from '../budget/money';
import { BENCHMARKS, BENCHMARK_GROUPS, BENCHMARK_LABEL, benchmarkGroupOf } from './benchmarks';
import type { BenchmarkGroup } from './benchmarks';

export * from './benchmarks';
export * from './changelog';
export * from './csv';

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
  contributionsCents: Cents,
  marketCents: Cents,
  debtPaydownCents: Cents,
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
  categories: z.array(ReportCategory),
  /** Largest increases and decreases against the previous month. */
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
  }),
  goals: z.array(ReportGoal),
  whatsNew: z.array(z.object({ date: z.string(), text: z.string() })),
});
export type ReportData = z.infer<typeof ReportData>;

/** One short string per section: a few sentences at most, never advice. */
export const ReportNarrative = z.object({
  headlines: z.array(z.string().max(160)).min(1).max(5),
  chips: z
    .array(z.object({ text: z.string().max(48), tone: z.enum(['good', 'note', 'watch']) }))
    .max(5),
  seasonal: z.string().max(220),
  where: z.string().max(360),
  monthOverMonth: z.string().max(360),
  benchmarks: z.string().max(360),
  netWorth: z.string().max(360),
  goals: z.string().max(360),
  whatsNew: z.string().max(260),
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
  });
  return head;
}

/** The biggest swings in dollars, ignoring noise under `minCents`. */
export function topMovers(
  rows: readonly ReportCategory[],
  n = 3,
  minCents = 2_500,
): { up: ReportCategory[]; down: ReportCategory[] } {
  const real = rows.filter((r) => r.name !== 'Everything else');
  const up = real
    .filter((r) => r.deltaCents >= minCents)
    .sort((a, b) => b.deltaCents - a.deltaCents)
    .slice(0, n);
  const down = real
    .filter((r) => r.deltaCents <= -minCents)
    .sort((a, b) => a.deltaCents - b.deltaCents)
    .slice(0, n);
  return { up, down };
}

/**
 * Share of total spending in each BLS group against the all-household average. Shares rather
 * than dollars: they stay meaningful whatever the household's size or income. Categories
 * with no BLS counterpart still count toward the total, so shares are of everything spent.
 */
export function buildBenchmarks(
  categories: readonly RawCategory[],
  totalSpentCents: number,
): ReportBenchmarkRow[] {
  const band = BENCHMARKS.all;
  const mine = new Map<BenchmarkGroup, number>();
  for (const c of categories) {
    const g = benchmarkGroupOf(c.name);
    if (g) mine.set(g, (mine.get(g) ?? 0) + c.cents);
  }
  const bp = (part: number, whole: number) => (whole > 0 ? mulDiv(part, 10_000, whole) : 0);
  return BENCHMARK_GROUPS.filter((g) => (mine.get(g) ?? 0) > 0).map((g) => ({
    label: BENCHMARK_LABEL[g],
    youCents: mine.get(g) ?? 0,
    avgCents: band.monthlyCents[g],
    youShareBp: bp(mine.get(g) ?? 0, totalSpentCents),
    avgShareBp: bp(band.monthlyCents[g], band.totalMonthlyCents),
  }));
}

export interface BridgeInput {
  startCents: number;
  endCents: number;
  investStartCents: number;
  investEndCents: number;
  /** Net money moved into investment accounts during the month. */
  investContributionCents: number;
  /** Credit and loan balances (negative) at the start and end. */
  debtStartCents: number;
  debtEndCents: number;
}

/**
 * Where the net worth change came from. Contributions are money the owner moved in; market is
 * what the investment accounts did beyond that; debt paydown is liabilities shrinking; other
 * is whatever is left (cash, home value, anything else), so the four always add up to the
 * change exactly.
 */
export function bridgeNetWorth(i: BridgeInput): { changeCents: number; bridge: ReportBridge } {
  const changeCents = i.endCents - i.startCents;
  const contributionsCents = i.investContributionCents;
  const marketCents = i.investEndCents - i.investStartCents - contributionsCents;
  const debtPaydownCents = i.debtEndCents - i.debtStartCents;
  const otherCents = changeCents - contributionsCents - marketCents - debtPaydownCents;
  return {
    changeCents,
    bridge: { contributionsCents, marketCents, debtPaydownCents, otherCents },
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
  const net = d.cash.netCents;
  out.push(
    d.cash.status === 'even'
      ? 'Income and spending roughly matched.'
      : `${d.cash.status === 'surplus' ? 'Surplus' : 'Deficit'} of ${fmt(Math.abs(net))}: ${fmt(d.cash.incomeCents)} in, ${fmt(d.cash.spentCents)} out.`,
  );
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

export const REPORT_SYSTEM = `You write the narrative for one month of a household budget report. You are given computed figures; never recompute or invent any.

Voice: plain, specific, calm. Give context and insight, never advice, suggestions, warnings to act, or "consider". Do not tell the owner what to do.
Numbers: every dollar amount in the data is given as both cents and a formatted string; quote the formatted string. Never round differently or add figures that are not given.
Overspending is a debt carried forward, not a failure: never use alarming or scolding language.
Transfers and credit-card payments are already excluded from spending; do not mention them.
If prevSparse is true, the previous month has far fewer transactions, so say the comparison is rough instead of presenting big swings as real changes.
If partial is true, the month is not over: say "so far".
Seasonal context: use the month's dates and the lastYearCents values to point out holidays, seasons, school terms, annual bills or other recurring effects. Only state a seasonal link when the data supports it.
Net worth: the bridge is already computed. When contributionsTracked is false, deposits into investments are not recorded separately, so say the market figure includes any deposits and may overstate market moves. Explain it using the index returns when present; investmentGrowthBp is the owner's investments excluding contributions. If an index return is null, do not guess one.
Benchmarks: comparisons are shares of total spending against U.S. all-household averages (BLS Consumer Expenditure Survey); describe differences neutrally.
Each section: 1 to 3 short sentences. Headlines: 3 to 5 bullets, each under 110 characters, covering surplus or deficit status, net worth change, notable movers and goals when they exist. Chips: up to 5 very short callouts (under 40 characters) with tone good, note or watch (watch is for a fact worth noticing, not a command). If a section has no data, say so in one short sentence.
Never mention merchants, account names or numbers.`;

/** JSON Schema for `output_config.format`, kept in step with `ReportNarrative`. */
export const REPORT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'headlines',
    'chips',
    'seasonal',
    'where',
    'monthOverMonth',
    'benchmarks',
    'netWorth',
    'goals',
    'whatsNew',
  ],
  properties: {
    headlines: { type: 'array', items: { type: 'string' } },
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
    where: { type: 'string' },
    monthOverMonth: { type: 'string' },
    benchmarks: { type: 'string' },
    netWorth: { type: 'string' },
    goals: { type: 'string' },
    whatsNew: { type: 'string' },
  },
} as const;

/** The user message: the computed aggregates, with every amount also pre-formatted. */
export function buildReportPrompt(d: ReportData, fmt: (cents: number) => string): string {
  const withUsd = <T extends Record<string, unknown>>(o: T): T & Record<string, string> => {
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(o))
      if (k.endsWith('Cents') && typeof v === 'number') extra[`${k.slice(0, -5)}Usd`] = fmt(v);
    return { ...o, ...extra };
  };
  const body = {
    month: d.month,
    partial: d.partial,
    prevMonth: d.prevMonth,
    prevSparse: d.prevSparse,
    cash: withUsd(d.cash),
    categories: d.categories.map(withUsd),
    movers: { up: d.movers.up.map(withUsd), down: d.movers.down.map(withUsd) },
    benchmarks: { year: d.benchmarks.year, rows: d.benchmarks.rows.map(withUsd) },
    netWorth: {
      ...withUsd({
        startCents: d.netWorth.startCents,
        endCents: d.netWorth.endCents,
        changeCents: d.netWorth.changeCents,
      }),
      bridge: withUsd(d.netWorth.bridge),
      contributionsTracked: d.netWorth.contributionsTracked,
      sp500Bp: d.netWorth.sp500Bp,
      bondsBp: d.netWorth.bondsBp,
      investmentGrowthBp: d.netWorth.investmentGrowthBp,
    },
    goals: d.goals.map(withUsd),
    whatsNew: d.whatsNew,
  };
  return `Write the narrative for this month. Data (JSON):\n${JSON.stringify(body)}`;
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
      ['seasonal', 220],
      ['where', 360],
      ['monthOverMonth', 360],
      ['benchmarks', 360],
      ['netWorth', 360],
      ['goals', 360],
      ['whatsNew', 260],
    ] as const)
      o[k] = clip(o[k], n);
    if (Array.isArray(o['headlines']))
      o['headlines'] = o['headlines'].slice(0, 5).map((h) => clip(h, 160));
    if (Array.isArray(o['chips']))
      o['chips'] = o['chips'].slice(0, 5).map((c) => {
        if (c && typeof c === 'object')
          (c as Record<string, unknown>)['text'] = clip((c as Record<string, unknown>)['text'], 48);
        return c;
      });
  }
  const r = ReportNarrative.safeParse(json);
  return r.success ? r.data : null;
}
