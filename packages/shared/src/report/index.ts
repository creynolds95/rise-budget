import { z } from 'zod';
import { mulDiv } from '../budget/money';
import { BENCHMARKS, BENCHMARK_GROUPS, BENCHMARK_LABEL, benchmarkGroupOf } from './benchmarks';
import type { BenchmarkGroup } from './benchmarks';
import {
  REPORT_CONFIG,
  ReportGas,
  ReportWeather,
  ReportYoy,
  changeBp,
  formatPct,
  kindOf,
  type MoveKind,
} from './context';

export * from './benchmarks';
export * from './changelog';
export * from './csv';
export * from './context';

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
  headlines: z.array(z.string().max(160)).max(4),
  chips: z
    .array(z.object({ text: z.string().max(48), tone: z.enum(['good', 'note', 'watch']) }))
    .max(5),
  seasonal: z.string().max(260),
  movers: z.string().max(360),
  weather: z.string().max(300),
  gas: z.string().max(260),
  yoy: z.string().max(300),
  benchmarks: z.string().max(300),
  netWorth: z.string().max(360),
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

export const REPORT_SYSTEM = `You write a short monthly note about one household's budget, in the voice of a morning newsletter: conversational, informative, a little light. It gives context for the month. It is not going to change anyone's life.

Facts: you are given figures and context in the input, and nothing else. Every number, amount, date, season, holiday and cause you write must come from the input or be plain calendar knowledge about that month. Quote the formatted strings (fields ending Usd, Pct, or temperatures) exactly as given: never round, convert, add, subtract or invent a figure. If the input does not show why something moved, say what moved and do not guess why.
Skip, don't pad: every field is a string you may leave empty (""). Leave a section empty when there is no real insight. An empty section is better than a filler one. Headlines may be an empty list.
Length: one or two sentences per section. Headlines: up to 4 bullets under 110 characters, only for what is actually worth a skim. Chips: up to 5 callouts under 40 characters, tone good, note or watch (watch is a fact worth noticing, never a command).
No lists of percentages. Use a percent only when it makes a point a dollar figure can't, and never two in a row.
Never remark that the biggest fixed costs (mortgage, rent, loans, insurance) are the biggest, or that they stayed the same. That is not news. A change in one of them is.
movers: the categories that moved against last month (each has kind up, down, new or gone). Lead with the ones that tell a story. Link a move to weather, gas prices, a holiday or the season only when the input supports it, for example power and water bills in a first heating month, or the gas category when the regional price moved.
weather: monthly average highs and lows for the owner's area, the hottest and coldest days, and the same for last month and a year ago. Tie to energy and water only when the weather clearly changed. Leave empty when weather is missing.
gas: the regional gas price against last month and last year, tied to a gas or fuel category only when one exists in the input. Leave empty when gas is missing.
yoy: only the notable differences listed against the same month last year (new, gone, or a big swing). Leave empty when the list is empty.
seasonal: holidays, school terms, annual bills or seasons that fit this month's dates and the categories. Only when the data supports it.
benchmarks: shares of total spending against U.S. all-household averages (BLS Consumer Expenditure Survey); neutral, never a verdict.
netWorth: the bridge is already computed. When contributionsTracked is false, deposits into investments are not recorded separately, so say the market figure includes any deposits. Use the index returns when present; if one is null, do not guess one.
goals, whatsNew: only when there is something to say.
If prevSparse is true, last month has far fewer transactions: say the comparison is rough rather than presenting swings as real. If partial is true, the month is not over: say "so far".
Overspending is a debt carried forward, not a failure. No scolding, no alarm, no advice, no "consider" or "should". Transfers and card payments are already excluded; do not mention them. Never mention merchants, account names or account numbers.
lifeNote: leave empty unless something unique shows up that the owner may want remembered for later months (income changed by 10% or more, or a major category changed by 30% or more with no seasonal or price explanation in the input). Then write one plain factual sentence from the input, such as "Income was $X, up from $Y." Never guess a cause. Facts in lifeNotes are already known: do not repeat them as news, but use them to explain a change they account for.`;

/** JSON Schema for `output_config.format`, kept in step with `ReportNarrative`. */
export const REPORT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'headlines',
    'chips',
    'seasonal',
    'movers',
    'weather',
    'gas',
    'yoy',
    'benchmarks',
    'netWorth',
    'goals',
    'whatsNew',
    'lifeNote',
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
    movers: { type: 'string' },
    weather: { type: 'string' },
    gas: { type: 'string' },
    yoy: { type: 'string' },
    benchmarks: { type: 'string' },
    netWorth: { type: 'string' },
    goals: { type: 'string' },
    whatsNew: { type: 'string' },
    lifeNote: { type: 'string' },
  },
} as const;

/**
 * The user message. Every amount is a formatted string and the raw cents and basis points are
 * left out, so the model has one form to quote and `groundNarrative` can check its numbers
 * against exactly what it was shown.
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
  const temps = (
    t: { avgHighF: number; avgLowF: number; maxF: number; minF: number; days: number } | null,
  ) =>
    t && {
      avgHigh: `${t.avgHighF}°F`,
      avgLow: `${t.avgLowF}°F`,
      hottestDay: `${t.maxF}°F`,
      coldestNight: `${t.minF}°F`,
      daysCounted: t.days,
    };
  const gal = (c: number | null) => (c === null ? null : `${fmt(c)} a gallon`);
  const body = {
    month: d.month,
    partial: d.partial,
    prevMonth: d.prevMonth,
    prevSparse: d.prevSparse,
    cash: view(d.cash),
    categories: d.categories.map(view),
    moves: [...d.movers.up, ...d.movers.down].flatMap((r) => {
      const k = kindOf(r);
      return k ? [move(r.name, k, r.cents, r.prevCents, 'prev')] : [];
    }),
    yoy: d.yoy.map((y) => move(y.name, y.kind, y.cents, y.lastYearCents, 'lastYear')),
    benchmarks: { year: d.benchmarks.year, rows: d.benchmarks.rows.map(view) },
    netWorth: {
      ...view({
        startCents: d.netWorth.startCents,
        endCents: d.netWorth.endCents,
        changeCents: d.netWorth.changeCents,
      }),
      bridge: view(d.netWorth.bridge),
      contributionsTracked: d.netWorth.contributionsTracked,
      ...view({
        sp500Bp: d.netWorth.sp500Bp,
        bondsBp: d.netWorth.bondsBp,
        investmentGrowthBp: d.netWorth.investmentGrowthBp,
      }),
    },
    weather: d.weather && {
      thisMonth: temps(d.weather.month),
      lastMonth: temps(d.weather.prev),
      sameMonthLastYear: temps(d.weather.lastYear),
    },
    gas: d.gas && {
      region: d.gas.region,
      thisMonth: gal(d.gas.monthCents),
      lastMonth: gal(d.gas.prevCents),
      sameMonthLastYear: gal(d.gas.lastYearCents),
    },
    goals: d.goals.map(view),
    whatsNew: d.whatsNew,
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
      ['seasonal', 260],
      ['movers', 360],
      ['weather', 300],
      ['gas', 260],
      ['yoy', 300],
      ['benchmarks', 300],
      ['netWorth', 360],
      ['goals', 300],
      ['whatsNew', 260],
      ['lifeNote', 160],
    ] as const)
      o[k] = clip(o[k], n);
    if (Array.isArray(o['headlines']))
      o['headlines'] = o['headlines'].slice(0, 4).map((h) => clip(h, 160));
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
