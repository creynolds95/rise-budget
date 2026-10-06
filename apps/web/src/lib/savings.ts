import {
  coveredMonths,
  emergencyTargetCents,
  goalProgress,
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

/** Saved is the whole account balance unless the goal claims a share of it. */
export function goalView(goal: SavingsGoal, accounts: Account[], period: string): GoalView {
  const account = accounts.find((a) => a.id === goal.accountId);
  const balance = Math.max(0, account?.balanceCents ?? 0);
  const savedCents = goal.savedCents === null ? balance : Math.min(goal.savedCents, balance);
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
