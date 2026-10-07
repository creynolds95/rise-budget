import {
  coveredMonths,
  emergencyTargetCents,
  goalProgress,
  shareAccountBalance,
  type GoalProgress,
} from '@rise/shared/savings';
import type { Account, SavingsGoal } from '@rise/shared/schemas';
import { addMonths } from './dates';

export const newGoalId = (): string => crypto.randomUUID();

export interface GoalView extends GoalProgress {
  goal: SavingsGoal;
  accountName: string;
  savedCents: number;
  targetCents: number;
  /** "2027-03" when a pace is set; null otherwise. */
  period: string | null;
  /** Emergency fund: months of expenses covered today. */
  covered: number | null;
}

/**
 * Saved is the goal's part of its account's balance: its claimed share if it has one, else an
 * even split of what the account's other goals (`goals`, every goal) haven't claimed. Two goals
 * on one account never both count the whole of it (`shareAccountBalance`).
 */
export function goalView(
  goal: SavingsGoal,
  accounts: Account[],
  period: string,
  goals: readonly SavingsGoal[] = [goal],
): GoalView {
  const account = accounts.find((a) => a.id === goal.accountId);
  const siblings = goals.filter((g) => g.accountId === goal.accountId && g.id !== goal.id);
  const shared = [goal, ...siblings];
  // Shares follow the saved order of the goals, so every view of the plan agrees.
  const order = (g: SavingsGoal) => {
    const i = goals.findIndex((x) => x.id === g.id);
    return i === -1 ? goals.length : i;
  };
  shared.sort((a, b) => order(a) - order(b));
  const shares = shareAccountBalance(
    account?.balanceCents ?? 0,
    shared.map((g) => g.savedCents),
  );
  const savedCents = shares[shared.indexOf(goal)] as number;
  const targetCents =
    goal.kind === 'emergency'
      ? emergencyTargetCents(goal.months, goal.monthlyExpenseCents)
      : goal.targetCents;
  const p = goalProgress({ savedCents, targetCents, monthlyCents: goal.monthlyCents });
  return {
    ...p,
    goal,
    accountName: account?.name ?? 'Missing account',
    savedCents,
    targetCents,
    period: p.monthsToGo === null ? null : addMonths(period, p.monthsToGo),
    covered: goal.kind === 'emergency' ? coveredMonths(savedCents, goal.monthlyExpenseCents) : null,
  };
}
