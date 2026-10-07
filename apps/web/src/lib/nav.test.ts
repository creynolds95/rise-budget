import { describe, expect, it } from 'vitest';
import { backFrom, listOrigin } from './nav';

describe('backFrom', () => {
  it('reads Label|path', () =>
    expect(backFrom('Review|/review')).toEqual({ label: 'Review', to: '/review' }));
  it('keeps a nested path after the first bar', () =>
    expect(backFrom('Budget settings|/settings/budget?from=Budget%7C%2Fbudget')).toEqual({
      label: 'Budget settings',
      to: '/settings/budget?from=Budget%7C%2Fbudget',
    }));
  it('falls back when missing or malformed', () => {
    for (const raw of [null, '', 'Review', '|/review', 'Evil|https://x.test', 'Evil|//x.test']) {
      expect(backFrom(raw)).toEqual({ label: 'Transactions', to: '/transactions' });
    }
  });
});

describe('listOrigin', () => {
  it('reads a valid origin', () =>
    expect(listOrigin('Food|/budget/c1?m=2026-09')).toEqual({
      label: 'Food',
      to: '/budget/c1?m=2026-09',
    }));
  it('is null when missing or unsafe', () => {
    for (const raw of [null, '', 'Evil|https://x.test']) expect(listOrigin(raw)).toBeNull();
  });
});
