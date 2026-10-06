import { describe, expect, it } from 'vitest';
import {
  normalDraw,
  seededRandom,
  simulateRetirement,
  type MonteCarloInput,
  type MonteCarloPoint,
} from './monte-carlo';

const base: MonteCarloInput = {
  startCents: 50_000_000,
  monthlyContributionCents: 100_000,
  monthlySpendCents: 300_000,
  yearsToRetire: 20,
  yearsToHorizon: 50,
  realGrowthBps: 400,
  volatilityBps: 1500,
  trials: 500,
  seed: 7,
};

describe('retirement Monte Carlo', () => {
  it('the seeded generator repeats and stays in [0, 1)', () => {
    const a = seededRandom(1);
    const b = seededRandom(1);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('normal draws center on zero with unit spread', () => {
    const r = seededRandom(3);
    const xs = Array.from({ length: 5000 }, () => normalDraw(r));
    const mean = xs.reduce((n, x) => n + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((n, x) => n + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(sd - 1)).toBeLessThan(0.05);
  });

  it('the same seed gives the same result', () => {
    expect(simulateRetirement(base)).toEqual(simulateRetirement(base));
  });

  it('with zero volatility every percentile is the deterministic path', () => {
    const res = simulateRetirement({ ...base, volatilityBps: 0, realGrowthBps: 0, trials: 10 });
    const at20 = res.series[20] as MonteCarloPoint;
    expect(at20.p10Cents).toBe(50_000_000 + 100_000 * 12 * 20);
    expect(at20.p50Cents).toBe(at20.p90Cents);
    expect(res.series[0]?.p50Cents).toBe(50_000_000);
    expect(res.series).toHaveLength(51);
  });

  it('percentiles are ordered and a spread opens up with volatility', () => {
    const res = simulateRetirement(base);
    for (const p of res.series) {
      expect(p.p10Cents).toBeLessThanOrEqual(p.p50Cents);
      expect(p.p50Cents).toBeLessThanOrEqual(p.p90Cents);
    }
    const last = res.series[20] as MonteCarloPoint;
    expect(last.p90Cents).toBeGreaterThan(last.p10Cents);
  });

  it('a plan that draws too much runs out and success is 0', () => {
    const res = simulateRetirement({
      ...base,
      volatilityBps: 0,
      monthlySpendCents: 5_000_000,
      trials: 20,
    });
    expect(res.successPct).toBe(0);
    expect(res.series[50]?.p50Cents).toBe(0);
  });

  it('a modest draw with zero volatility always lasts', () => {
    const res = simulateRetirement({
      ...base,
      volatilityBps: 0,
      monthlySpendCents: 10_000,
      trials: 20,
    });
    expect(res.successPct).toBe(100);
  });

  it('extreme volatility never produces a negative balance', () => {
    const res = simulateRetirement({ ...base, volatilityBps: 9000, trials: 200 });
    for (const p of res.series) expect(p.p10Cents).toBeGreaterThanOrEqual(0);
  });

  it('zero trials reports no success and does not crash', () => {
    const res = simulateRetirement({ ...base, trials: 0 });
    expect(res.successPct).toBe(0);
  });
});
