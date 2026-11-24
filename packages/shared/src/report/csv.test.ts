import { describe, expect, it } from 'vitest';
import { amountToCents, csvTxns, isTransferCategory, parseCsv, reportDataFromCsv } from './csv';

// Every row below is invented.
const csv = [
  'Date,Account,Merchant,Category,Amount,Status',
  '2026-10-01,"Acct A","Pay Co","Paychecks",3000.00,Posted',
  '2026-10-02,"Acct A","Landlord","Rent",-1200.00,Posted',
  '2026-10-03,"Acct A","Shop, Inc ""Main""","Groceries",-150.25,Posted',
  '2026-10-04,"Acct A","Bank","Credit Card Payment",-500.00,Posted',
  '2026-10-05,"Acct A","Bank","Transfer",-100.00,Posted',
  '2026-10-06,"Acct A","Shop","Groceries",20.00,Posted',
  '2026-09-02,"Acct A","Pay Co","Paychecks",2800.00,Posted',
  '2026-09-03,"Acct A","Landlord","Rent",-1200.00,Posted',
  '2025-10-03,"Acct A","Shop","Groceries",-100.00,Posted',
  'not-a-date,"Acct A","Shop","Groceries",-1.00,Posted',
  '2026-10-07,"Acct A","Shop","Groceries",abc,Posted',
].join('\r\n');

describe('csv parsing', () => {
  it('handles quotes, doubled quotes, commas and CRLF', () => {
    const rows = parseCsv(csv);
    expect(rows[3]?.[2]).toBe('Shop, Inc "Main"');
    expect(rows[0]).toHaveLength(6);
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\r\n\r\n')).toEqual([['a']]);
  });
  it('reads amounts in integer math', () => {
    expect(amountToCents('-1234.5')).toBe(-123_450);
    expect(amountToCents('0.07')).toBe(7);
    expect(amountToCents('12')).toBe(1_200);
    expect(amountToCents('x')).toBeNull();
  });
  it('skips rows it cannot read and needs the three columns', () => {
    expect(csvTxns(csv)).toHaveLength(9);
    expect(csvTxns('')).toEqual([]);
    expect(() => csvTxns('Date,Amount\n2026-01-01,1')).toThrow(/columns/);
  });
  it('knows transfer categories', () => {
    expect(isTransferCategory('Credit Card Payment')).toBe(true);
    expect(isTransferCategory(' transfer to savings')).toBe(true);
    expect(isTransferCategory('Groceries')).toBe(false);
  });
});

describe('reportDataFromCsv', () => {
  const d = reportDataFromCsv(csvTxns(csv), '2026-10');
  it('leaves transfers out and counts refunds against their category', () => {
    expect(d.cash).toMatchObject({
      incomeCents: 300_000,
      spentCents: 120_000 + 13_025,
      prevIncomeCents: 280_000,
      prevSpentCents: 120_000,
      status: 'surplus',
    });
    expect(d.categories.map((c) => [c.name, c.cents, c.lastYearCents])).toEqual([
      ['Rent', 120_000, 0],
      ['Groceries', 13_025, 10_000],
    ]);
  });
  it('flags a lighter previous month and carries no balances', () => {
    expect(d.prevSparse).toBe(true);
    expect(reportDataFromCsv(csvTxns(csv), '2026-11').prevSparse).toBe(false);
    expect(d.netWorth.startCents).toBe(0);
    expect(d.goals).toEqual([]);
  });
  it('does not turn a month of refunds into income', () => {
    const t = csvTxns(
      [
        'Date,Category,Amount',
        '2026-10-01,Fun,-50.00',
        '2026-11-01,Fun,5.00',
        '2026-11-02,Pay,100.00',
      ].join('\n'),
    );
    const nov = reportDataFromCsv(t, '2026-11');
    expect(nov.cash.incomeCents).toBe(10_000);
    expect(nov.cash.spentCents).toBe(-500);
  });
  it('is sparse when last month has well under this month', () => {
    const t = csvTxns(
      [
        'Date,Category,Amount',
        '2026-09-01,Pay,1.00',
        '2026-10-01,Pay,1.00',
        '2026-10-02,Pay,1.00',
        '2026-10-03,Pay,1.00',
      ].join('\n'),
    );
    expect(reportDataFromCsv(t, '2026-10').prevSparse).toBe(true);
  });
});
