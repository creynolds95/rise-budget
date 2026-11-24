import { describe, expect, it } from 'vitest';
import {
  BENCHMARKS,
  benchmarkGroupOf,
  bridgeNetWorth,
  buildBenchmarks,
  buildCategories,
  buildReportPrompt,
  cashStatus,
  changelogFor,
  fallbackHeadlines,
  formatUsd,
  growthBp,
  isPrevSparse,
  monthReturnBp,
  parseNarrative,
  topMovers,
  type ReportData,
} from './index';

// Every figure below is invented.
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

describe('cashStatus', () => {
  it('calls within a dollar even', () => {
    expect(cashStatus(99)).toBe('even');
    expect(cashStatus(-99)).toBe('even');
    expect(cashStatus(100)).toBe('surplus');
    expect(cashStatus(-100)).toBe('deficit');
  });
});

describe('buildCategories', () => {
  it('joins months by name, sorts by size and folds the tail', () => {
    const cur = [
      { name: 'Groceries', cents: 50_000 },
      { name: 'Childcare', cents: 90_000 },
      { name: 'Water', cents: 7_000 },
    ];
    const prev = [
      { name: 'Groceries', cents: 40_000 },
      { name: 'Childcare', cents: 120_000 },
      { name: 'Gym', cents: 3_000 },
    ];
    const rows = buildCategories(cur, prev, null, 2);
    expect(rows.map((r) => r.name)).toEqual(['Childcare', 'Groceries', 'Everything else']);
    expect(rows[0]).toMatchObject({ deltaCents: -30_000, lastYearCents: null });
    expect(rows[2]).toMatchObject({ cents: 7_000, prevCents: 3_000, deltaCents: 4_000 });
  });
  it('carries last year by name, zero when absent', () => {
    const rows = buildCategories(
      [{ name: 'Gifts', cents: 30_000 }],
      [],
      [{ name: 'Gifts', cents: 20_000 }],
    );
    expect(rows[0]?.lastYearCents).toBe(20_000);
    expect(buildCategories([{ name: 'New', cents: 1 }], [], [])[0]?.lastYearCents).toBe(0);
  });
  it('folds last year into the tail row too', () => {
    const rows = buildCategories(
      [
        { name: 'A', cents: 3 },
        { name: 'B', cents: 2 },
      ],
      [],
      [{ name: 'B', cents: 7 }],
      1,
    );
    expect(rows[1]).toMatchObject({ name: 'Everything else', lastYearCents: 7 });
  });
});

describe('topMovers', () => {
  it('ignores swings under the floor and the folded row', () => {
    const rows = buildCategories(
      [
        { name: 'A', cents: 100_000 },
        { name: 'B', cents: 10_000 },
        { name: 'C', cents: 5_000 },
      ],
      [
        { name: 'A', cents: 50_000 },
        { name: 'B', cents: 30_000 },
        { name: 'C', cents: 4_000 },
      ],
      null,
    );
    const m = topMovers(rows);
    expect(m.up.map((r) => r.name)).toEqual(['A']);
    expect(m.down.map((r) => r.name)).toEqual(['B']);
  });
  it('needs the dollars AND the percent, fixed lines included', () => {
    const rows = buildCategories(
      [
        { name: 'Mortgage', cents: 210_000 },
        { name: 'Cable', cents: 9_000 },
        { name: 'Power', cents: 30_000 },
        { name: 'Gym', cents: 0 },
        { name: 'Pets', cents: 8_000 },
      ],
      [
        { name: 'Mortgage', cents: 200_000 },
        { name: 'Cable', cents: 6_000 },
        { name: 'Power', cents: 12_000 },
        { name: 'Gym', cents: 6_000 },
      ],
      null,
      50,
    );
    const m = topMovers(rows);
    expect(m.up.map((r) => r.name)).toEqual(['Power', 'Pets']);
    expect(m.down.map((r) => r.name)).toEqual(['Gym']);
  });
});

describe('benchmarks', () => {
  it('maps category names to BLS groups and leaves others out', () => {
    expect(benchmarkGroupOf('Groceries')).toBe('food-home');
    expect(benchmarkGroupOf('Restaurants & Bars')).toBe('food-away');
    expect(benchmarkGroupOf('Mortgage')).toBe('housing');
    expect(benchmarkGroupOf('Auto Insurance')).toBe('transportation');
    expect(benchmarkGroupOf('Student Loans')).toBeNull();
    expect(benchmarkGroupOf('Childcare')).toBeNull();
  });
  it('shares are of everything spent, in integer basis points', () => {
    const rows = buildBenchmarks(
      [
        { name: 'Mortgage', cents: 200_000 },
        { name: 'Childcare', cents: 100_000 },
      ],
      400_000,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Housing', youShareBp: 5_000 });
    expect(rows[0]?.avgShareBp).toBe(Math.round((26_266 / 78_535) * 10_000));
    expect(Number.isInteger(rows[0]?.avgCents)).toBe(true);
  });
  it('has no rows for an empty month', () => {
    expect(buildBenchmarks([], 0)).toEqual([]);
    expect(buildBenchmarks([{ name: 'Mortgage', cents: 100 }], 0)[0]?.youShareBp).toBe(0);
    expect(BENCHMARKS.all.totalMonthlyCents).toBeGreaterThan(0);
  });
});

describe('bridgeNetWorth', () => {
  it('always adds up to the change', () => {
    const { changeCents, bridge } = bridgeNetWorth({
      startCents: 5_000_000,
      endCents: 5_300_000,
      investStartCents: 2_000_000,
      investEndCents: 2_200_000,
      investContributionCents: 60_000,
      loanStartCents: -9_000_000,
      loanEndCents: -8_950_000,
      savingsStartCents: 300_000,
      savingsEndCents: 330_000,
      otherStartCents: 20_000_000,
      otherEndCents: 20_010_000,
    });
    expect(bridge).toEqual({
      contributionsCents: 60_000,
      marketCents: 140_000,
      debtPaydownCents: 50_000,
      savingsCents: 30_000,
      cashCents: 10_000,
      otherCents: 10_000,
    });
    expect(Object.values(bridge).reduce((a, b) => a + b, 0)).toBe(changeCents);
  });
});

describe('monthReturnBp', () => {
  const pts = [
    { date: '2026-09-30', level: 100_000 },
    { date: '2026-10-15', level: 104_000 },
    { date: '2026-10-31', level: 102_000 },
    { date: '2026-11-03', level: 110_000 },
  ];
  it('uses the last close before the month against the last close in it', () => {
    expect(monthReturnBp(pts, '2026-10')).toBe(200);
  });
  it('is null when an end is missing', () => {
    expect(monthReturnBp(pts, '2026-08')).toBeNull();
    expect(monthReturnBp(pts.slice(1), '2026-10')).toBeNull();
  });
  it('growthBp needs a positive base', () => {
    expect(growthBp(0, 5)).toBeNull();
    expect(growthBp(1_000, 25)).toBe(250);
  });
});

describe('isPrevSparse', () => {
  it('flags a month under three quarters of this one', () => {
    expect(isPrevSparse(82, 135)).toBe(true);
    expect(isPrevSparse(101, 135)).toBe(true);
    expect(isPrevSparse(102, 135)).toBe(false);
    expect(isPrevSparse(0, 0)).toBe(false);
  });
});

describe('formatUsd', () => {
  it('groups thousands and shows cents only when present', () => {
    expect(formatUsd(138_800)).toBe('$1,388');
    expect(formatUsd(1_234_567)).toBe('$12,345.67');
    expect(formatUsd(-5)).toBe('-$0.05');
    expect(formatUsd(0)).toBe('$0');
  });
});

describe('narrative', () => {
  const ok = {
    summary: 'a',
    chips: [{ text: 'x', tone: 'good' }],
    seasonal: '',
    movers: 'm',
    budget: '',
    yoy: '',
    benchmarks: 'b',
    netWorth: 'n',
    savings: '',
    goals: 'g',
    whatsNew: 'k',
    lifeNote: '',
  };
  it('accepts a valid object and trims long strings', () => {
    expect(parseNarrative(JSON.stringify(ok))).toEqual(ok);
    const long = parseNarrative(
      JSON.stringify({
        ...ok,
        movers: 'x'.repeat(900),
        summary: 's'.repeat(900),
        chips: [{ text: 't'.repeat(90), tone: 'note' }],
      }),
    );
    expect(long?.movers).toHaveLength(420);
    expect(long?.summary).toHaveLength(360);
    expect(long?.chips[0]?.text).toHaveLength(48);
  });
  it('rejects junk', () => {
    expect(parseNarrative('nope')).toBeNull();
    expect(parseNarrative(JSON.stringify({ ...ok, summary: '' }))).not.toBeNull();
    expect(parseNarrative(JSON.stringify({ ...ok, lifeNote: undefined }))).toBeNull();
    expect(
      parseNarrative(JSON.stringify({ ...ok, chips: [{ text: 'x', tone: 'bad' }] })),
    ).toBeNull();
    expect(parseNarrative('null')).toBeNull();
    expect(parseNarrative(JSON.stringify({ ...ok, chips: ['x'] }))).toBeNull();
  });
});

const data: ReportData = {
  month: '2026-10',
  partial: false,
  prevMonth: '2026-09',
  prevSparse: true,
  cash: {
    incomeCents: 600_000,
    spentCents: 500_000,
    netCents: 100_000,
    prevIncomeCents: 0,
    prevSpentCents: 0,
    status: 'surplus',
  },
  categories: buildCategories(
    [{ name: 'Groceries', cents: 50_000 }],
    [{ name: 'Groceries', cents: 40_000 }],
    null,
  ),
  movers: { up: [], down: [] },
  benchmarks: { year: 2024, rows: [] },
  netWorth: {
    startCents: 0,
    endCents: 0,
    changeCents: 0,
    bridge: {
      contributionsCents: 0,
      marketCents: 0,
      debtPaydownCents: 0,
      savingsCents: 0,
      cashCents: 0,
      otherCents: 0,
    },
    trendCents: [],
    contributionsTracked: false,
    sp500Bp: null,
    bondsBp: null,
    investmentGrowthBp: null,
  },
  goals: [],
  whatsNew: [],
  split: { spendingCents: 500_000, debtPaymentCents: 0, savingsCents: 0, retirementCents: 0 },
  budget: null,
  savings: null,
  progress: null,
  yoy: [],
  weather: null,
  gas: null,
  lifeNotes: [],
};

describe('prompt and fallback', () => {
  const firstCategory = data.categories[0] as ReportData['categories'][number];
  it('pre-formats every cents field so the model quotes, not computes', () => {
    const p = buildReportPrompt(data, usd);
    expect(p).toContain('"leftAfterSpendingUsd":"$1000.00"');
    expect(p).toContain('"deltaUsd":"$100.00"');
    expect(p).toContain('"prevSparse":true');
  });
  it('gives the model formatted strings only, including plain cents fields', () => {
    const p = buildReportPrompt(data, usd);
    expect(p).toContain('"usd":"$500.00"');
    expect(p).not.toMatch(/Cents"|"cents"|Bp"/);
  });
  it('gives weather and gas as comparisons to attach to the category they explain', () => {
    const temps = (hi: number, lo: number) => ({
      avgHighF: hi,
      avgLowF: lo,
      maxF: hi + 9,
      minF: lo - 9,
      days: 30,
    });
    const p = buildReportPrompt(
      {
        ...data,
        weather: { month: temps(52, 33), prev: temps(60, 41), lastYear: temps(60, 40) },
        gas: { region: 'Gulf Coast', monthCents: 301, prevCents: 289, lastYearCents: 330 },
      },
      usd,
    );
    expect(p).toContain('"highsVsLastYear":"8°F colder"');
    expect(p).toContain('"vsLastMonth":"$0.12 a gallon higher"');
    expect(p).toContain('"vsLastYear":"$0.29 a gallon lower"');
  });
  it('carries only category names and aggregates', () => {
    expect(buildReportPrompt(data, usd)).not.toMatch(/merchant|account|email/i);
  });
  it('falls back to deterministic bullets', () => {
    expect(fallbackHeadlines(data, usd)[0]).toBe('$6000.00 in, $5000.00 spent.');
    expect(
      fallbackHeadlines(
        {
          ...data,
          savings: {
            savingsCents: 0,
            debtPrincipalCents: 0,
            retirementCents: 0,
            retirementEstimated: false,
            totalCents: 0,
            rateBp: 1_840,
            avgRateBp: null,
            basis: 'balances',
          },
        },
        usd,
      )[1],
    ).toBe('Savings rate 18.4% of income.');
    const d: ReportData = {
      ...data,
      cash: { ...data.cash, status: 'deficit', netCents: -500 },
      movers: { up: [], down: [{ ...firstCategory, deltaCents: -9_000 }] },
      netWorth: { ...data.netWorth, changeCents: -100 },
    };
    const hs = fallbackHeadlines(d, usd);
    expect(hs.some((x) => x.includes('Net worth down'))).toBe(true);
    expect(hs.some((x) => x.includes('down $90.00'))).toBe(true);
    const up = fallbackHeadlines(
      { ...data, movers: { up: [{ ...firstCategory, deltaCents: 9_000 }], down: [] } },
      usd,
    );
    expect(up.some((x) => x.includes('up $90.00'))).toBe(true);
  });
  it('changelog filters by month', () => {
    expect(changelogFor('2026-11').length).toBeGreaterThan(0);
    expect(changelogFor('1999-01')).toEqual([]);
  });
});
