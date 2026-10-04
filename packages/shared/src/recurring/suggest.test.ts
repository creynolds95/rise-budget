import { describe, expect, it } from 'vitest';
import { cashMovements, surplusSuggestions, type AccountOccurrence } from './suggest';

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

describe('cashMovements', () => {
  const t = (date: string, cents: number, pair: string | null, accountId = 'chk') => ({
    ...o(date, cents, accountId),
    isTransfer: true,
    pairAccountId: pair,
  });
  const cashIds = new Set(['chk', 'sav']);
  const cards = new Set(['citi']);

  it('keeps transfers out to a loan, outside savings, or an unlinked leg', () => {
    const moves = cashMovements(
      new Map([
        ['THECB', [t('2026-09-14', 106_054, 'loan')]],
        ['APPLE SAVINGS', [t('2026-09-15', 50_000, null)]],
        ['ACME PAYROLL', [o('2026-09-05', -310_000)]],
      ]),
      new Set(['chk']),
      cards,
    );
    expect([...moves.keys()]).toEqual(['THECB', 'APPLE SAVINGS', 'ACME PAYROLL']);
  });

  it('drops card payments, moves between cash accounts, and rows outside cash', () => {
    const moves = cashMovements(
      new Map([
        ['CITI PAYMENT', [t('2026-09-10', 80_000, 'citi')]],
        ['TO SAVINGS', [t('2026-09-10', 20_000, 'sav')]],
        ['NETFLIX', [o('2026-09-10', 1_599, 'citi')]],
      ]),
      cashIds,
      cards,
    );
    expect(moves.size).toBe(0);
  });

  it('a savings transfer from checking forms a suggestion once savings is not cash', () => {
    const saving = ['2026-07-15', '2026-08-15', '2026-09-15'].map((d) => t(d, 25_000, 'usaa-sav'));
    const out = surplusSuggestions(
      cashMovements(new Map([['USAA FUNDS TRANSFER', saving]]), new Set(['chk']), cards),
      new Set(['chk']),
      new Set(),
      '2026-09-20',
    );
    expect(out.map((x) => x.merchant)).toEqual(['USAA FUNDS TRANSFER']);
  });
});
