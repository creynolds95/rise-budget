/**
 * Debt payoff. Pure, integer cents. One month at a time: interest accrues, every loan gets its
 * minimum, and whatever is left of the monthly budget goes to one target loan at a time by
 * strategy. The budget is the sum of the payments plus the extra; when a loan finishes, its
 * payment either stays in the budget (carrying forward) or drops out.
 */
export type Strategy = 'snowball' | 'avalanche';

export interface DebtLoan {
  id: string;
  /** What is owed, positive. */
  balanceCents: number;
  /** Annual rate in thousandths of a percent: 5.875% is 5875. */
  aprMilliPct: number;
  paymentCents: number;
}

export interface PayoffOptions {
  extraCents: number;
  strategy: Strategy;
  rollForward: boolean;
}

export interface LoanPayoff {
  id: string;
  /** Payments from now until it hits zero (0 if already done); null if it never does. */
  payoffMonth: number | null;
  interestCents: number;
}

export interface PayoffResult {
  loans: LoanPayoff[];
  /** The month the last loan finishes; null if any never does. */
  debtFreeMonth: number | null;
  totalInterestCents: number;
  /** Total still owed after each month; index 0 is today. */
  totalOwedByMonth: number[];
}

/** Stop here: a payment that can't beat its interest would otherwise run forever. */
export const MAX_MONTHS = 1200;

export const monthlyInterest = (balanceCents: number, aprMilliPct: number): number =>
  Math.round((balanceCents * aprMilliPct) / 1_200_000);

/** Where a balance lands after one month's interest and one payment. */
export const stepBalance = (
  balanceCents: number,
  aprMilliPct: number,
  paymentCents: number,
): number => Math.max(0, balanceCents + monthlyInterest(balanceCents, aprMilliPct) - paymentCents);

interface State {
  loan: DebtLoan;
  owed: number;
  payoffMonth: number | null;
  interest: number;
}

export function simulatePayoff(loans: DebtLoan[], opts: PayoffOptions): PayoffResult {
  const states: State[] = loans.map((loan) => ({
    loan,
    owed: loan.balanceCents,
    payoffMonth: loan.balanceCents > 0 ? null : 0,
    interest: 0,
  }));
  const carried =
    states.filter((s) => s.owed > 0).reduce((n, s) => n + s.loan.paymentCents, 0) + opts.extraCents;
  const totalOwed = () => states.reduce((n, s) => n + s.owed, 0);
  const totalOwedByMonth = [totalOwed()];

  let month = 0;
  while (totalOwed() > 0 && month < MAX_MONTHS) {
    month++;
    const active = states.filter((s) => s.owed > 0);
    let spare = opts.rollForward
      ? carried
      : active.reduce((n, s) => n + s.loan.paymentCents, 0) + opts.extraCents;
    for (const s of active) {
      const accrued = monthlyInterest(s.owed, s.loan.aprMilliPct);
      s.owed += accrued;
      s.interest += accrued;
    }
    for (const s of active) {
      const paid = Math.min(s.loan.paymentCents, s.owed);
      s.owed -= paid;
      spare -= paid;
    }
    const order = active
      .filter((s) => s.owed > 0)
      .sort((a, b) => {
        const byBalance = a.owed - b.owed;
        const first =
          opts.strategy === 'snowball'
            ? byBalance
            : b.loan.aprMilliPct - a.loan.aprMilliPct || byBalance;
        return first || a.loan.id.localeCompare(b.loan.id);
      });
    for (const s of order) {
      const paid = Math.min(Math.max(spare, 0), s.owed);
      s.owed -= paid;
      spare -= paid;
    }
    for (const s of active) if (s.owed === 0) s.payoffMonth = month;
    totalOwedByMonth.push(totalOwed());
  }

  const results = states.map((s) => ({
    id: s.loan.id,
    payoffMonth: s.payoffMonth,
    interestCents: s.interest,
  }));
  const open = results.some((r) => r.payoffMonth === null);
  return {
    loans: results,
    debtFreeMonth: open ? null : Math.max(0, ...results.map((r) => r.payoffMonth as number)),
    totalInterestCents: results.reduce((n, r) => n + r.interestCents, 0),
    totalOwedByMonth,
  };
}
