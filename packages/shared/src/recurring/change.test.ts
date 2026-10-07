import { describe, expect, it } from 'vitest';
import { amountOn, withAmountChange } from './change';

describe('amount change', () => {
  const change = { amountCents: -150_000, on: '2026-11-05' };

  it('keeps the old amount before the date and uses the new one from it', () => {
    expect(amountOn(-200_000, change, '2026-11-04')).toBe(-200_000);
    expect(amountOn(-200_000, change, '2026-11-05')).toBe(-150_000);
    expect(amountOn(-200_000, null, '2026-12-05')).toBe(-200_000);
  });

  it('applies to projected paychecks from the date on', () => {
    expect(
      withAmountChange(
        [
          { date: '2026-10-20', amountCents: -200_000 },
          { date: '2026-11-05', amountCents: -200_000 },
          { date: '2026-11-20', amountCents: -200_000 },
        ],
        change,
      ).map((o) => o.amountCents),
    ).toEqual([-200_000, -150_000, -150_000]);
  });
});
