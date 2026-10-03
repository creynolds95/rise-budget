import { describe, expect, it } from 'vitest';
import type { Account, SavingsGoal } from '@rise/shared/schemas';
import { goalView } from './savings';

const acct = (id: string, balanceCents: number) =>
  ({ id, name: `Acct ${id}`, balanceCents }) as Account;
const goal = (over: Partial<SavingsGoal>): SavingsGoal => ({
  id: 'g',
  name: 'Trip',
  accountId: 'a',
  targetCents: 100_000,
  monthlyCents: 10_000,
  savedCents: null,
  kind: 'goal',
  months: 6,
  monthlyExpenseCents: 0,
  ...over,
});

describe('goal view', () => {
  it('saved is the whole account balance by default, and the date counts from this month', () => {
    const v = goalView(goal({}), [acct('a', 40_000)], '2026-10');
    expect(v.savedCents).toBe(40_000);
    expect(v.pct).toBe(40);
    expect(v.period).toBe('2027-04');
  });

  it('a claimed share is capped at the balance', () => {
    expect(goalView(goal({ savedCents: 25_000 }), [acct('a', 40_000)], '2026-10').savedCents).toBe(
      25_000,
    );
    expect(goalView(goal({ savedCents: 90_000 }), [acct('a', 40_000)], '2026-10').savedCents).toBe(
      40_000,
    );
  });

  it('an emergency fund derives its target and months covered from expenses', () => {
    const v = goalView(
      goal({ kind: 'emergency', months: 6, monthlyExpenseCents: 400_000 }),
      [acct('a', 1_000_000)],
      '2026-10',
    );
    expect(v.targetCents).toBe(2_400_000);
    expect(v.covered).toBe(2.5);
  });

  it('no pace means no date; a missing account reads as nothing saved', () => {
    const v = goalView(goal({ monthlyCents: 0 }), [], '2026-10');
    expect(v.period).toBeNull();
    expect(v.accountName).toBe('Missing account');
    expect(v.savedCents).toBe(0);
  });
});
