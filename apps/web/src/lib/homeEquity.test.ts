import { describe, expect, it } from 'vitest';
import { equityCents } from './homeEquity';

describe('home equity', () => {
  it('is value minus the amount owed', () => {
    expect(equityCents(50_000_000, -20_000_000)).toBe(30_000_000);
  });
  it('is underwater when the loan exceeds the value', () => {
    expect(equityCents(10_000_000, -12_000_000)).toBe(-2_000_000);
  });
  it('ignores a loan balance reported above zero', () => {
    expect(equityCents(10_000_000, 500)).toBe(10_000_000);
  });
});
