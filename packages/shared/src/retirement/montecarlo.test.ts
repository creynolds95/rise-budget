import { describe, expect, it } from 'vitest';
import { projectBalance } from './project';
import { MC_RUNS, percentile, seededRandom, simulateRetirement, successRate } from './montecarlo';

const base = {
  startCents: 10_000_000,
  monthlyContributionCents: 100_000,
  years: 30,
  realGrowthBps: 400,
  volatilityBps: 1500,
};

describe('seeded random', () => {
  it('repeats for the same seed and differs for another', () => {
    const a = seededRandom(1);
    const b = seededRandom(1);
    const c = seededRandom(2);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    xs.forEach((x) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    });
  });
});

describe('percentile', () => {
  it('uses nearest rank and clamps to the ends', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(s, 50)).toBe(5);
    expect(percentile(s, 90)).toBe(9);
    expect(percentile(s, 0)).toBe(1);
    expect(percentile(s, 100)).toBe(10);
  });
});

describe('simulateRetirement', () => {
  it('is deterministic for a seed', () => {
    expect(simulateRetirement({ ...base, runs: 200 })).toEqual(
      simulateRetirement({ ...base, runs: 200 }),
    );
    expect(simulateRetirement({ ...base, runs: 200, seed: 7 }).finals).not.toEqual(
      simulateRetirement({ ...base, runs: 200 }).finals,
    );
  });

  it('with zero volatility every run equals the plain projection', () => {
    const r = simulateRetirement({ ...base, volatilityBps: 0, runs: 20 });
    const expected = projectBalance(base.startCents, base.monthlyContributionCents, 30, 400);
    expect(r.finals.every((f) => f === expected)).toBe(true);
    expect(r.fan[r.fan.length - 1]).toEqual({
      year: 30,
      p10: expected,
      p25: expected,
      p50: expected,
      p75: expected,
      p90: expected,
    });
  });

  it('starts at the current balance and the bands are ordered', () => {
    const { fan, finals } = simulateRetirement(base);
    expect(fan).toHaveLength(31);
    expect(fan[0]).toEqual({
      year: 0,
      p10: base.startCents,
      p25: base.startCents,
      p50: base.startCents,
      p75: base.startCents,
      p90: base.startCents,
    });
    for (const p of fan) {
      expect(p.p10).toBeLessThanOrEqual(p.p25);
      expect(p.p25).toBeLessThanOrEqual(p.p50);
      expect(p.p50).toBeLessThanOrEqual(p.p75);
      expect(p.p75).toBeLessThanOrEqual(p.p90);
    }
    expect(finals).toHaveLength(MC_RUNS);
    expect(fan[30]?.p90).toBeGreaterThan(fan[30]?.p10 ?? 0);
  });

  it('the median tracks the straight-line projection instead of sagging under it', () => {
    const straight = projectBalance(base.startCents, base.monthlyContributionCents, 30, 400);
    const median = simulateRetirement(base).fan[30]?.p50 ?? 0;
    expect(Math.abs(median / straight - 1)).toBeLessThan(0.05);
  });

  it('more volatility widens the fan', () => {
    const spread = (volatilityBps: number) => {
      const { fan } = simulateRetirement({ ...base, volatilityBps });
      const last = fan[fan.length - 1];
      return (last?.p90 ?? 0) - (last?.p10 ?? 0);
    };
    expect(spread(2500)).toBeGreaterThan(spread(500));
  });

  it('a month never loses more than the whole balance', () => {
    const r = simulateRetirement({
      ...base,
      monthlyContributionCents: 0,
      volatilityBps: 20_000,
      runs: 50,
      years: 5,
    });
    expect(r.finals.every((f) => f >= 0)).toBe(true);
  });

  it('works with no years and no runs', () => {
    expect(simulateRetirement({ ...base, years: 0, runs: 5 }).fan).toHaveLength(1);
    expect(simulateRetirement({ ...base, runs: 0 }).finals).toEqual([]);
  });
});

describe('successRate', () => {
  it('is the whole percent of runs at or above the target', () => {
    expect(successRate([1, 2, 3, 4], 3)).toBe(50);
    expect(successRate([1, 2, 3], 1)).toBe(100);
    expect(successRate([1, 2, 3], 4)).toBe(0);
    expect(successRate([], 1)).toBe(0);
  });
});
