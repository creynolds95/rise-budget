import { describe, expect, it } from 'vitest';
import { amountOn, withAmountChange } from './change';

describe('amount change', () => {
  const change = { amountCents: -170025, on: '2026-11-05' };

  it('keeps the old amount before the date and uses the new one from it', () => {
    expect(amountOn(-207000, change, '2026-11-04')).toBe(-207000);
    expect(amountOn(-207000, change, '2026-11-05')).toBe(-170025);
    expect(amountOn(-207000, null, '2026-12-05')).toBe(-207000);
  });

  it('applies to projected paychecks from the date on', () => {
    expect(
      withAmountChange(
        [
          { date: '2026-10-20', amountCents: -207000 },
          { date: '2026-11-05', amountCents: -207000 },
          { date: '2026-11-20', amountCents: -207000 },
        ],
        change,
      ).map((o) => o.amountCents),
    ).toEqual([-207000, -170025, -170025]);
  });
});
