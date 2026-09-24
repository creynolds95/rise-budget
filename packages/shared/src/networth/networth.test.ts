import { describe, expect, it } from 'vitest';
import { balanceAt, dateFromDayNumber, dayNumber, netWorthSeries } from './index';

describe('day numbers', () => {
  it('round-trips across leap years and eras', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('2000-03-01') - dayNumber('2000-02-28')).toBe(2);
    expect(dayNumber('2100-03-01') - dayNumber('2100-02-28')).toBe(1);
    for (const d of ['1969-12-31', '2024-02-29', '2026-09-23', '2400-12-31', '0001-01-01']) {
      expect(dateFromDayNumber(dayNumber(d))).toBe(d);
    }
  });
});

describe('balanceAt', () => {
  const snaps = [
    { asOf: '2026-09-11', balanceCents: 20_000 },
    { asOf: '2026-09-01', balanceCents: 10_000 },
  ];
  it('is null before the first snapshot', () => {
    expect(balanceAt(snaps, '2026-08-31')).toBeNull();
    expect(balanceAt([], '2026-08-31')).toBeNull();
  });
  it('is measured on a snapshot day', () => {
    expect(balanceAt(snaps, '2026-09-01')).toEqual({ balanceCents: 10_000, kind: 'measured' });
  });
  it('interpolates linearly between snapshots', () => {
    expect(balanceAt(snaps, '2026-09-06')).toEqual({ balanceCents: 15_000, kind: 'interpolated' });
    expect(balanceAt(snaps, '2026-09-04')).toEqual({ balanceCents: 13_000, kind: 'interpolated' });
  });
  it('holds the last value afterwards, flagged', () => {
    expect(balanceAt(snaps, '2026-09-30')).toEqual({ balanceCents: 20_000, kind: 'held' });
  });
  it('sorts equal dates stably', () => {
    expect(
      balanceAt(
        [
          { asOf: '2026-09-01', balanceCents: 1 },
          { asOf: '2026-09-01', balanceCents: 1 },
        ],
        '2026-09-01',
      )?.kind,
    ).toBe('measured');
  });
});

describe('netWorthSeries', () => {
  it('credit and loan balances reduce net worth; excluded accounts are ignored', () => {
    const series = netWorthSeries(
      [
        {
          accountId: 'checking',
          includeInNetWorth: true,
          snapshots: [{ asOf: '2026-09-01', balanceCents: 500_000 }],
        },
        {
          accountId: 'apple-card',
          includeInNetWorth: true,
          snapshots: [{ asOf: '2026-09-01', balanceCents: -120_000 }],
        },
        {
          accountId: 'car-loan',
          includeInNetWorth: true,
          snapshots: [{ asOf: '2026-09-01', balanceCents: -900_000 }],
        },
        {
          accountId: 'hidden',
          includeInNetWorth: false,
          snapshots: [{ asOf: '2026-09-01', balanceCents: 1 }],
        },
      ],
      '2026-09-01',
      '2026-09-02',
    );
    expect(series).toEqual([
      { date: '2026-09-01', netWorthCents: -520_000, inferred: false },
      { date: '2026-09-02', netWorthCents: -520_000, inferred: true },
    ]);
  });

  it('flags interpolated points', () => {
    const series = netWorthSeries(
      [
        {
          accountId: 'house',
          includeInNetWorth: true,
          snapshots: [
            { asOf: '2026-01-01', balanceCents: 0 },
            { asOf: '2026-01-03', balanceCents: 1_000 },
          ],
        },
      ],
      '2026-01-01',
      '2026-01-03',
    );
    expect(series.map((p) => [p.netWorthCents, p.inferred])).toEqual([
      [0, false],
      [500, true],
      [1_000, false],
    ]);
  });
});
