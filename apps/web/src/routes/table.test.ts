import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, ROUTES, TABS } from './table';

describe('navigation depth (DESIGN-SYSTEM.md §4)', () => {
  it('no route is more than two pushes from a tab', () => {
    for (const r of ROUTES) expect(r.depth, r.path).toBeLessThanOrEqual(MAX_DEPTH);
  });
  it('depth matches the path: one segment per push below a root, or one below its origin', () => {
    const depthOf = (path: string) => ROUTES.find((r) => r.path === path)?.depth;
    for (const r of ROUTES) {
      const expected =
        'from' in r
          ? (depthOf(r.from) ?? NaN) + 1
          : Math.max(r.path.split('/').filter(Boolean).length - 1, 0);
      expect(r.depth, r.path).toBe(expected);
    }
  });
  it('exactly five tabs, no drawer', () => {
    expect(TABS.map((t) => t.label)).toEqual([
      'Dashboard',
      'Accounts',
      'Transactions',
      'Budget',
      'Reports',
    ]);
  });
});
