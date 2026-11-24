import { z } from 'zod';
import { mulDiv } from '../budget/money';

/**
 * Savings, debt payoff and budget context for the monthly report (SPEC §12.6). Pure.
 * Savings is good, not spending: money set aside never counts as spent, and a month's "room"
 * is a prompt to add to savings or pay off debt, not a surplus or deficit to judge.
 */

export type CategoryClass = 'spending' | 'debt' | 'savings' | 'retirement';

/** By name: the owner's own categories are all there is to go on. Debt payments stay in the
 * spending list (they are bills) but are counted apart; savings and retirement are not spent. */
export function classifyCategory(name: string): CategoryClass {
  if (/\b(401\s?k|403\s?b|ira|roth|retirement|pension)\b/i.test(name)) return 'retirement';
  if (/\b(savings?|emergency fund|rainy day|sinking fund)\b/i.test(name)) return 'savings';
  if (/\b(mortgage|loans?|debt)\b/i.test(name)) return 'debt';
  return 'spending';
}

export const ReportSplit = z.object({
  /** Spending other than debt payments. */
  spendingCents: z.int(),
  debtPaymentCents: z.int(),
  /** Categories that move money into savings and retirement; not spending. */
  savingsCents: z.int(),
  retirementCents: z.int(),
});
export type ReportSplit = z.infer<typeof ReportSplit>;

export function splitRows(rows: readonly { name: string; cents: number }[]): ReportSplit {
  const s = { spendingCents: 0, debtPaymentCents: 0, savingsCents: 0, retirementCents: 0 };
  for (const r of rows) {
    const c = classifyCategory(r.name);
    if (c === 'debt') s.debtPaymentCents += r.cents;
    else if (c === 'savings') s.savingsCents += r.cents;
    else if (c === 'retirement') s.retirementCents += r.cents;
    else s.spendingCents += r.cents;
  }
  return s;
}

/** What the month's money went toward beyond spending, and the rate it makes of income. */
export const ReportSavings = z.object({
  /** Net money added to savings accounts (their balance change). */
  savingsCents: z.int(),
  /** Loan principal paid down (loan balance change toward zero). */
  debtPrincipalCents: z.int(),
  /** Deposits into retirement and investment accounts. */
  retirementCents: z.int(),
  /** The retirement figure is the plan's monthly amount: no deposits were recorded. */
  retirementEstimated: z.boolean(),
  totalCents: z.int(),
  /** (savings + principal + retirement) / income, basis points; null with no income. */
  rateBp: z.int().nullable(),
  /** The same over the three months before, summed; null with no earlier data. */
  avgRateBp: z.int().nullable(),
  /** 'balances': from account balances. 'categories': from category names (a CSV has no balances). */
  basis: z.enum(['balances', 'categories']),
});
export type ReportSavings = z.infer<typeof ReportSavings>;

export function rateBp(totalCents: number, incomeCents: number): number | null {
  return incomeCents > 0 ? mulDiv(totalCents, 10_000, incomeCents) : null;
}

/** Trailing average as total over total (not a mean of rates), so a thin month cannot swing it. */
export function trailingRateBp(
  months: readonly { totalCents: number; incomeCents: number }[],
): number | null {
  const income = months.reduce((n, m) => n + m.incomeCents, 0);
  return rateBp(
    months.reduce((n, m) => n + m.totalCents, 0),
    income,
  );
}

export const ReportDebtRow = z.object({
  label: z.string(),
  owedCents: z.int(),
  paidCents: z.int(),
});
export type ReportDebtRow = z.infer<typeof ReportDebtRow>;

export const ReportProgress = z.object({
  debt: z.array(ReportDebtRow),
  retirement: z.object({
    balanceCents: z.int(),
    contributedCents: z.int(),
    plannedCents: z.int(),
    estimated: z.boolean(),
  }),
  /** Balance of the savings accounts at month end. */
  savingsBalanceCents: z.int(),
});
export type ReportProgress = z.infer<typeof ReportProgress>;

/**
 * Variable categories against the month's plan. Fixed bills are left out: the owner edits their
 * plan to the exact amount once it posts, so they are always on budget.
 */
export const ReportBudget = z.object({
  plannedCents: z.int(),
  spentCents: z.int(),
  /** Categories over their plan by enough to mention, biggest first. */
  over: z.array(z.object({ name: z.string(), plannedCents: z.int(), spentCents: z.int() })),
});
export type ReportBudget = z.infer<typeof ReportBudget>;

export const BUDGET_OVER_MIN_CENTS = 2_500;
export const BUDGET_OVER_MIN_BP = 1_000;

export function compareBudget(
  rows: readonly { name: string; plannedCents: number; spentCents: number }[],
): ReportBudget {
  const real = rows.filter((r) => r.plannedCents > 0);
  const over = real
    .filter((r) => {
      const by = r.spentCents - r.plannedCents;
      return (
        by >= BUDGET_OVER_MIN_CENTS && mulDiv(by, 10_000, r.plannedCents) >= BUDGET_OVER_MIN_BP
      );
    })
    .sort((a, b) => b.spentCents - b.plannedCents - (a.spentCents - a.plannedCents))
    .slice(0, 5);
  return {
    plannedCents: real.reduce((n, r) => n + r.plannedCents, 0),
    spentCents: real.reduce((n, r) => n + r.spentCents, 0),
    over,
  };
}
