import { describe, expect, it } from 'vitest';
import { TAX_KINDS, defaultTaxYear, taxLabel } from './tax';

describe('tax helpers', () => {
  it('opens on last year through April, this year after', () => {
    expect(defaultTaxYear('2027-02-10')).toBe(2026);
    expect(defaultTaxYear('2027-04-30')).toBe(2026);
    expect(defaultTaxYear('2027-05-01')).toBe(2027);
  });

  it('labels every heading', () => {
    for (const { kind } of TAX_KINDS) expect(taxLabel(kind)).not.toBe(kind);
    expect(taxLabel('income_1099')).toBe('1099 income');
  });
});
