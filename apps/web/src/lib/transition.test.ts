import { describe, expect, it } from 'vitest';
import { isPushRoute, isTabRoot } from './transition';

describe('isTabRoot', () => {
  it('is true for the four tab landing screens only', () => {
    for (const p of ['/', '/accounts', '/transactions', '/budget', '/budget/', '/budget?m=2026-10'])
      expect(isTabRoot(p)).toBe(true);
    for (const p of ['/accounts/abc', '/settings', '/budget/xyz', '/cash-to-payday'])
      expect(isTabRoot(p)).toBe(false);
  });
});

describe('isPushRoute', () => {
  it('ignores a query or a hash', () => {
    for (const p of ['/review', '/cash-to-payday?x=1', '/cash-to-payday#review'])
      expect(isPushRoute(p)).toBe(true);
  });
});
