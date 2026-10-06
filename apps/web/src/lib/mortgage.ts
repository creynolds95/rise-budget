import { amortize, paidSoFar, type Amortization } from '@rise/shared/debt';
import type { DebtLoanPlan, DebtPlan } from '@rise/shared/schemas';
import { addMonths } from './dates';

export interface MortgageView {
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

/** The first payment is next month, so the month index maps to periods from there. */
export function mortgageView(
  loan: DebtLoanPlan,
  owedCents: number,
  settings: Pick<DebtPlan, 'mortgageExtraCents' | 'mortgageLumps' | 'mortgageTermMonths'>,
  period: string,
): MortgageView {
  const input = {
    balanceCents: owedCents,
    aprMilliPct: loan.aprMilliPct,
    paymentCents: loan.paymentCents,
  };
  const base = amortize({ ...input, extraMonthlyCents: 0, lumps: [] });
  const plan = amortize({
    ...input,
    extraMonthlyCents: settings.mortgageExtraCents,
    lumps: settings.mortgageLumps.map((l) => ({
      month: Math.max(1, monthsFrom(period, l.period)),
      cents: l.cents,
    })),
  });
  const at = (a: Amortization) =>
    a.payoffMonth === null ? null : addMonths(period, a.payoffMonth);
  const paidCount =
    base.payoffMonth === null ? 0 : Math.max(0, settings.mortgageTermMonths - base.payoffMonth);
  const thisYear = Math.min(paidCount, Number(period.slice(5, 7)));
  const sooner =
    base.payoffMonth !== null && plan.payoffMonth !== null
      ? base.payoffMonth - plan.payoffMonth
      : null;
  return {
    plan,
    base,
    payoffPeriod: at(plan),
    basePayoffPeriod: at(base),
    monthsSooner: sooner !== null && sooner > 0 ? sooner : null,
    interestSavedCents:
      sooner !== null && sooner > 0 ? base.totalInterestCents - plan.totalInterestCents : null,
    paidCount,
    ytd: thisYear > 0 ? paidSoFar(owedCents, loan.aprMilliPct, loan.paymentCents, thisYear) : null,
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
