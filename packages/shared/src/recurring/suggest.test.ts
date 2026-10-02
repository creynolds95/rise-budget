import { describe, expect, it } from 'vitest';
import { surplusSuggestions, type AccountOccurrence } from './suggest';

const o = (date: string, amountCents: number, accountId = 'chk'): AccountOccurrence => ({
  date,
  amountCents,
  categoryId: null,
  accountId,
});

const pay = [
  o('2026-07-05', -310_000),
  o('2026-07-20', -310_000),
  o('2026-08-05', -310_000),
  o('2026-08-20', -310_000),
];
const rent = [o('2026-06-27', 180_000), o('2026-07-27', 180_000), o('2026-08-27', 180_000)];
const cash = new Set(['chk']);

describe('surplusSuggestions', () => {
  it('suggests active series from cash accounts, income and expense alike', () => {
    const out = surplusSuggestions(
      new Map([
        ['ACME PAYROLL', pay],
        ['MORTGAGE', rent],
      ]),
      cash,
      new Set(),
      '2026-09-01',
    );
    expect(out).toEqual([
      {
        merchant: 'ACME PAYROLL',
        accountId: 'chk',
        series: expect.objectContaining({ cadence: 'semimonthly', anchorDays: [5, 20] }),
      },
      {
        merchant: 'MORTGAGE',
        accountId: 'chk',
        series: expect.objectContaining({ cadence: 'monthly', expectedAmountCents: 180_000 }),
      },
    ]);
  });

  it('skips a merchant already in Surplus or dismissed', () => {
    const out = surplusSuggestions(
      new Map([['MORTGAGE', rent]]),
      cash,
      new Set(['MORTGAGE']),
      '2026-09-01',
    );
    expect(out).toEqual([]);
  });

  it('only counts transactions in the cash accounts', () => {
    const onCard = rent.map((r) => ({ ...r, accountId: 'card' }));
    const mixed = [o('2026-06-27', 180_000, 'card'), ...rent.slice(1)];
    expect(
      surplusSuggestions(
        new Map([
          ['NETFLIX', onCard],
          ['MORTGAGE', mixed],
        ]),
        cash,
        new Set(),
        '2026-09-01',
      ),
    ).toEqual([]);
  });

  it('names the account of the latest occurrence', () => {
    const moved = [...rent, o('2026-09-27', 180_000, 'sav')];
    const [s] = surplusSuggestions(
      new Map([['MORTGAGE', moved]]),
      new Set(['chk', 'sav']),
      new Set(),
      '2026-10-01',
    );
    expect(s?.accountId).toBe('sav');
  });

  it('never suggests a series that has stopped', () => {
    expect(
      surplusSuggestions(new Map([['MORTGAGE', rent]]), cash, new Set(), '2027-01-01'),
    ).toEqual([]);
  });
});
