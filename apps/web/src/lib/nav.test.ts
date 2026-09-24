import { describe, expect, it } from 'vitest';
import { backFrom } from './nav';

describe('backFrom', () => {
  it('reads Label|path', () =>
    expect(backFrom('Review|/review')).toEqual({ label: 'Review', to: '/review' }));
  it('falls back when missing or malformed', () => {
    for (const raw of [null, '', 'Review', '|/review', 'Evil|https://x.test', 'Evil|//x.test']) {
      expect(backFrom(raw)).toEqual({ label: 'Transactions', to: '/transactions' });
    }
  });
});
