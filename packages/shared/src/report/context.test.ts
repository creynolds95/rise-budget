import { describe, expect, it } from 'vitest';
import {
  allowedNumbers,
  formatPct,
  gasRegionOf,
  groundNarrative,
  isGrounded,
  monthGasCents,
  monthWeather,
  moveKind,
  spikeOf,
  priceToCents,
  yoyNotes,
  tidyNarrative,
  type ReportNarrative,
} from './index';

// Every figure below is invented.
describe('yoyNotes', () => {
  it('keeps new, gone and big swings; skips small ones and no history', () => {
    const cur = [
      { name: 'Tuition', cents: 90_000 },
      { name: 'Groceries', cents: 52_000 },
      { name: 'Water', cents: 6_000 },
    ];
    const ly = [
      { name: 'Groceries', cents: 50_000 },
      { name: 'Camp', cents: 40_000 },
      { name: 'Water', cents: 3_000 },
    ];
    const n = yoyNotes(cur, ly);
    expect(n.map((x) => [x.name, x.kind])).toEqual([
      ['Tuition', 'new'],
      ['Camp', 'gone'],
    ]);
    expect(yoyNotes(cur, null)).toEqual([]);
    expect(yoyNotes(cur, [])).toEqual([]);
  });
});

describe('moveKind', () => {
  it('calls net refunds a drop, not a vanished category', () => {
    expect(moveKind(-30_000, 10_000, 5_000, 2_500)).toBe('down');
    expect(moveKind(0, 10_000, 5_000, 2_500)).toBe('gone');
    expect(moveKind(10_000, -1_000, 5_000, 2_500)).toBe('new');
  });
});

describe('weather and gas', () => {
  it('summarises a month and ignores the others', () => {
    const days = [
      { date: '2026-10-01', highF: 80, lowF: 60 },
      { date: '2026-10-02', highF: 70, lowF: 48.4 },
      { date: '2026-09-30', highF: 99, lowF: 99 },
    ];
    expect(monthWeather(days, '2026-10')).toEqual({
      avgHighF: 75,
      avgLowF: 54,
      maxF: 80,
      minF: 48,
      days: 2,
    });
    expect(monthWeather(days, '2026-08')).toBeNull();
  });
  it('averages weekly gas in whole cents', () => {
    const pts = [
      { date: '2026-10-05', cents: 300 },
      { date: '2026-10-12', cents: 305 },
      { date: '2026-11-02', cents: 400 },
    ];
    expect(monthGasCents(pts, '2026-10')).toBe(303);
    expect(monthGasCents(pts, '2026-09')).toBeNull();
  });
  it('turns price text into cents without floats', () => {
    expect(priceToCents('3.012')).toBe(301);
    expect(priceToCents('3.019')).toBe(302);
    expect(priceToCents('3')).toBe(300);
    expect(priceToCents('x')).toBeNull();
  });
  it('finds the EIA region for a state', () => {
    expect(gasRegionOf('tx')).toEqual({ code: 'R30', label: 'Gulf Coast' });
    expect(gasRegionOf('CA')?.code).toBe('R50');
    expect(gasRegionOf('ZZ')).toBeNull();
  });
  it('formats basis points', () => {
    expect(formatPct(2_500)).toBe('25%');
    expect(formatPct(184)).toBe('1.8%');
    expect(formatPct(-1_000)).toBe('-10%');
    expect(formatPct(996)).toBe('10%');
  });
});

describe('tidyNarrative', () => {
  it('cuts a chip that repeats a headline figure, and keeps two at most', () => {
    const n = {
      summary: 'Groceries up $221.50.',
      chips: [
        { text: '$221.50 more', tone: 'note' as const },
        { text: 'Heating season', tone: 'note' as const },
        { text: 'Gas $3.01', tone: 'watch' as const },
        { text: 'Quiet month', tone: 'good' as const },
      ],
      seasonal: '',
      movers: '',
      budget: '',
      yoy: '',
      benchmarks: '',
      netWorth: '',
      savings: '',
      goals: '',
      whatsNew: '',
      lifeNote: '',
    };
    expect(tidyNarrative(n).chips.map((c) => c.text)).toEqual(['Heating season', 'Gas $3.01']);
  });
});

describe('grounding', () => {
  const input =
    '{"deltaUsd":"$300","pct":"25%","avgHigh":"62°F","month":"2026-10","usd":"$1,234.56"}';
  const allowed = allowedNumbers(input);
  it('accepts numbers that were given, with the same unit', () => {
    expect(isGrounded('Up $300, about 25% on a 62°F month.', allowed)).toBe(true);
    expect(isGrounded('Spending was $1,234.56, or $1,235 round.', allowed)).toBe(true);
  });
  it('rejects numbers that were not, or in another unit', () => {
    expect(isGrounded('Up $310.', allowed)).toBe(false);
    expect(isGrounded('Up 300%.', allowed)).toBe(false);
    expect(isGrounded('It hit 70°F.', allowed)).toBe(false);
    expect(isGrounded('Up $1.2k.', allowed)).toBe(false);
  });
  it('lets days, years and plain given numbers through', () => {
    expect(isGrounded('On the 14th of 2026 it cooled.', allowed)).toBe(true);
    expect(isGrounded('Over 400 days.', allowed)).toBe(false);
  });
  it('drops only the sentences that fail and counts them', () => {
    const n: ReportNarrative = {
      summary: 'Up $300. Up $999.',
      chips: [
        { text: '$300 more', tone: 'note' },
        { text: '$9 more', tone: 'note' },
      ],
      seasonal: 'Cooler month. Bills ran $777 higher.',
      movers: '',
      budget: '',
      yoy: '',
      benchmarks: '',
      netWorth: '',
      savings: '',
      goals: '',
      whatsNew: '',
      lifeNote: 'Income was $5.',
    };
    const g = groundNarrative(n, input);
    expect(g.dropped).toBe(4);
    expect(g.narrative.summary).toBe('Up $300.');
    // The surviving chip only repeats the surviving headline, so the tidy-up cuts it too.
    expect(g.narrative.chips).toEqual([]);
    expect(g.narrative.seasonal).toBe('Cooler month.');
    expect(g.narrative.lifeNote).toBe('');
  });
});

describe('spikeOf', () => {
  const cat = (name: string, cents: number, trend: number[]) => ({
    name,
    cents,
    prevCents: 0,
    deltaCents: 0,
    lastYearCents: null,
    plannedCents: null,
    trend,
  });
  it('flags a month at least double the usual by enough dollars', () => {
    expect(spikeOf(cat('Repairs', 40_000, [5_000, 0, 10_000, 40_000]))).toEqual({
      usualCents: 5_000,
    });
  });
  it('needs three prior months, enough dollars, and skips Everything else', () => {
    expect(spikeOf(cat('Repairs', 40_000, [0, 40_000]))).toBeNull();
    expect(spikeOf(cat('Snacks', 4_000, [1_000, 1_000, 1_000, 4_000]))).toBeNull();
    expect(spikeOf(cat('Everything else', 40_000, [5_000, 5_000, 5_000, 40_000]))).toBeNull();
    expect(spikeOf(cat('Steady', 12_000, [10_000, 10_000, 10_000, 12_000]))).toBeNull();
  });
});
