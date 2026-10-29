import type { RecurringSeries } from '@rise/shared/schemas';
import { describe, expect, it } from 'vitest';
import { flagText, radarNotes, yearlyCost } from './alerts';

const series = (p: Partial<RecurringSeries>): RecurringSeries => ({
  id: 'u|X',
  merchantNormalized: 'X',
  categoryId: null,
  cadence: 'monthly',
  expectedAmountCents: 1_799,
  nextExpectedDate: '2026-11-03',
  status: 'active',
  updatedAt: '2026-10-01T00:00:00.000Z',
  source: 'detected',
  previousAmountCents: null,
  priceChangedOn: null,
  doubleChargedOn: null,
  ...p,
});

const off = {
  priceUp: false,
  doubleCharge: false,
  duplicate: false,
  unusual: false,
  firstTime: false,
};

describe('alerts', () => {
  it('words the radar, and stays silent when turned off', () => {
    const s = series({
      previousAmountCents: 1_599,
      priceChangedOn: '2026-09-03',
      doubleChargedOn: '2026-09-05',
    });
    expect(radarNotes(s)).toEqual(['Up from $15.99 on Sep 3', 'Charged twice, Sep 5']);
    expect(radarNotes(s, off)).toEqual([]);
    expect(radarNotes(series({}))).toEqual([]);
  });

  it('words a charge flag unless it is off', () => {
    expect(flagText('duplicate')).toBe('Possible duplicate');
    expect(flagText('unusual')).toBe('More than usual here');
    expect(flagText('first_time', { ...off, firstTime: true })).toBe('First charge here');
    expect(flagText('duplicate', off)).toBeNull();
    expect(flagText(null)).toBeNull();
  });

  it('adds up a year of live charges, money out only', () => {
    expect(
      yearlyCost([
        series({}),
        series({ cadence: 'annual', expectedAmountCents: 9_900 }),
        series({ expectedAmountCents: -250_000 }),
        series({ status: 'ended' }),
      ]),
    ).toBe(1_799 * 12 + 9_900);
  });
});
