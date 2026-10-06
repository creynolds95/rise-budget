import { describe, expect, it } from 'vitest';
import {
  deductionTotals,
  foldPaycheck,
  paycheckNet,
  paycheckNetAfter,
  type PaycheckBreakdown,
} from './paycheck';

const b: PaycheckBreakdown = {
  grossCents: 400000,
  lines: [
    { label: 'Federal', kind: 'tax', amountCents: 50000 },
    { label: 'State', kind: 'tax', amountCents: 10000 },
    { label: '401k', kind: 'retirement', amountCents: 40000, nextAmountCents: 60000 },
    { label: 'Medical', kind: 'health', amountCents: 20000 },
  ],
};

describe('paycheck breakdown', () => {
  it('nets gross minus every deduction', () => {
    expect(paycheckNet(b)).toBe(280000);
  });

  it('applies a pending change line by line', () => {
    expect(paycheckNetAfter(b)).toBe(260000);
  });

  it('carries unchanged fields over, and a new gross replaces the old', () => {
    expect(paycheckNetAfter({ ...b, nextGrossCents: 420000 })).toBe(280000);
    expect(paycheckNetAfter({ grossCents: 100, lines: [] })).toBe(100);
  });

  it('totals per kind, skipping empty kinds', () => {
    expect(deductionTotals(b)).toEqual([
      { kind: 'tax', amountCents: 60000 },
      { kind: 'retirement', amountCents: 40000 },
      { kind: 'health', amountCents: 20000 },
    ]);
  });

  it('folds the change in once it is current', () => {
    const f = foldPaycheck({ ...b, nextGrossCents: 420000 });
    expect(f.grossCents).toBe(420000);
    expect(paycheckNet(f)).toBe(paycheckNetAfter({ ...b, nextGrossCents: 420000 }));
    expect(foldPaycheck(b).grossCents).toBe(400000);
  });
});
