import { describe, expect, it } from 'vitest';
import { taxCsv, taxLines, taxSummary, type TaxRowInput } from './tax';

const row = (over: Partial<TaxRowInput>): TaxRowInput => ({
  txnId: 't1',
  postedAt: '2026-03-02',
  merchant: 'Riverside Daycare',
  accountId: 'a1',
  amountCents: 30_000,
  kind: 'dependent_care',
  source: 'Daycare',
  ...over,
});

describe('taxLines', () => {
  it('counts a transaction once per heading when its category and a tag both mark it', () => {
    const lines = taxLines([row({})], [row({ source: 'Kid stuff' })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.source).toBe('Daycare');
  });

  it('keeps a tag line under a different heading, and dedupes repeated tags', () => {
    const lines = taxLines(
      [row({})],
      [
        row({ kind: 'medical', source: 'Health' }),
        row({ kind: 'medical', source: 'Other tag' }),
        row({ txnId: 't0', postedAt: '2026-03-02', kind: 'charity', source: 'Giving' }),
      ],
    );
    expect(lines.map((l) => `${l.txnId}:${l.kind}`)).toEqual([
      't0:charity',
      't1:dependent_care',
      't1:medical',
    ]);
  });

  it('orders by date first', () => {
    const lines = taxLines(
      [row({ txnId: 'b', postedAt: '2026-05-01' })],
      [row({ txnId: 'a', postedAt: '2026-06-01', kind: 'charity' })],
    );
    expect(lines.map((l) => l.txnId)).toEqual(['b', 'a']);
  });
});

describe('taxSummary', () => {
  it('shows income as earned and sorts headings and sources by size', () => {
    const heads = taxSummary([
      row({}),
      row({ txnId: 't2', source: 'Summer camp', amountCents: 50_000 }),
      row({ txnId: 't3', kind: 'income_1099', source: 'Side gig', amountCents: -120_000 }),
      row({ txnId: 't4', source: 'Daycare', amountCents: 10_000 }),
    ]);
    expect(heads.map((h) => [h.kind, h.totalCents, h.count])).toEqual([
      ['income_1099', 120_000, 1],
      ['dependent_care', 90_000, 3],
    ]);
    expect(heads[1]?.sources).toEqual([
      { source: 'Summer camp', totalCents: 50_000, count: 1 },
      { source: 'Daycare', totalCents: 40_000, count: 2 },
    ]);
  });

  it('is empty with nothing marked', () => {
    expect(taxSummary([])).toEqual([]);
  });
});

describe('taxCsv', () => {
  it('writes dollars the way the heading means them and defuses formulas', () => {
    const csv = taxCsv(
      [
        row({ merchant: '=HYPERLINK("x")', amountCents: 30_005 }),
        row({ txnId: 't9', kind: 'income_1099', source: 'Side gig', amountCents: -120_050 }),
        row({ txnId: 't8', kind: 'charity', source: 'Giving', amountCents: -2_500 }),
      ],
      { kind: (k) => k.toUpperCase(), account: () => 'Checking' },
    );
    expect(csv.split('\n')).toEqual([
      'Date,Heading,Category or tag,Merchant,Account,Amount',
      `2026-03-02,"DEPENDENT_CARE","Daycare","'=HYPERLINK(""x"")","Checking",300.05`,
      '2026-03-02,"INCOME_1099","Side gig","Riverside Daycare","Checking",1200.50',
      '2026-03-02,"CHARITY","Giving","Riverside Daycare","Checking",-25.00',
      '',
    ]);
  });
});
