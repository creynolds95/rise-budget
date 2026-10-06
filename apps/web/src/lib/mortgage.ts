import {
  amortize,
  levelPayment,
  paidSoFar,
  monthlyInterest,
  type Amortization,
} from '@rise/shared/debt';
import type { DebtLoanPlan, DebtPlan } from '@rise/shared/schemas';
import { addMonths } from './dates';

export interface MortgageView {
  /** The payment the schedule runs on. */
  paymentCents: number;
  /** The saved payment can't beat the interest, so a full-term payment stands in for the date. */
  estimated: boolean;
  /** With the extra payments in the plan. */
  plan: Amortization;
  /** The scheduled payment alone. */
  base: Amortization;
  payoffPeriod: string | null;
  basePayoffPeriod: string | null;
  monthsSooner: number | null;
  interestSavedCents: number | null;
  /** Payments already made, from the term less what the schedule has left. */
  paidCount: number;
  /** This calendar year's payments, split; null before the first. */
  ytd: { principalCents: number; interestCents: number } | null;
}

/** The first payment is next month (this month's if `pending`), so month indexes map from there. */
export function mortgageView(
  loan: DebtLoanPlan,
  owedCents: number,
  settings: Pick<DebtPlan, 'mortgageExtraCents' | 'mortgageLumps' | 'mortgageTermMonths'>,
  period: string,
  /** This month's payment is due but not in the balance yet, so it is the first one ahead. */
  pending = false,
): MortgageView {
  const lead = pending ? 1 : 0;
  // A payment at or under the interest never pays off; show the full-term date until it's fixed.
  const estimated =
    owedCents > 0 && loan.paymentCents <= monthlyInterest(owedCents, loan.aprMilliPct);
  const paymentCents = estimated
    ? levelPayment(owedCents, loan.aprMilliPct, settings.mortgageTermMonths)
    : loan.paymentCents;
  const input = { balanceCents: owedCents, aprMilliPct: loan.aprMilliPct, paymentCents };
  const base = amortize({ ...input, extraMonthlyCents: 0, lumps: [] });
  const plan = amortize({
    ...input,
    extraMonthlyCents: settings.mortgageExtraCents,
    lumps: settings.mortgageLumps.map((l) => ({
      month: Math.max(1, monthsFrom(period, l.period) + lead),
      cents: l.cents,
    })),
  });
  const at = (a: Amortization) =>
    a.payoffMonth === null ? null : addMonths(period, a.payoffMonth - lead);
  const paidCount =
    base.payoffMonth === null ? 0 : Math.max(0, settings.mortgageTermMonths - base.payoffMonth);
  const thisYear = Math.min(paidCount, Number(period.slice(5, 7)));
  const sooner =
    base.payoffMonth !== null && plan.payoffMonth !== null
      ? base.payoffMonth - plan.payoffMonth
      : null;
  return {
    paymentCents,
    estimated,
    plan,
    base,
    payoffPeriod: at(plan),
    basePayoffPeriod: at(base),
    monthsSooner: sooner !== null && sooner > 0 ? sooner : null,
    interestSavedCents:
      sooner !== null && sooner > 0 ? base.totalInterestCents - plan.totalInterestCents : null,
    paidCount,
    ytd: thisYear > 0 ? paidSoFar(owedCents, loan.aprMilliPct, paymentCents, thisYear) : null,
  };
}

/** Months from `period` to `target`; a payment in the current month counts as the next one. */
export const monthsFrom = (period: string, target: string): number =>
  (Number(target.slice(0, 4)) - Number(period.slice(0, 4))) * 12 +
  Number(target.slice(5, 7)) -
  Number(period.slice(5, 7));

/** Up to ~60 evenly spaced months, always ending at the last, for the three amortization lines. */
export function lineSeries(a: Amortization, balanceCents: number) {
  const n = a.rows.length;
  const step = Math.max(1, Math.ceil(n / 60));
  const idx: number[] = [];
  for (let i = step; i < n; i += step) idx.push(i - 1);
  if (n > 0) idx.push(n - 1);
  const pick = (f: (r: Amortization['rows'][number]) => number, start: number) => [
    start,
    ...idx.map((i) => f(a.rows[i] as Amortization['rows'][number])),
  ];
  return {
    balance: pick((r) => r.balanceCents, balanceCents),
    principal: pick((r) => r.principalToDateCents, 0),
    interest: pick((r) => r.interestToDateCents, 0),
    months: [0, ...idx.map((i) => i + 1)],
  };
}
