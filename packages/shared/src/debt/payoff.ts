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

/**
 * One-time extra principal. Month 0 is today, before any payment; month n lands after that
 * month's payments. It goes to `ids` first, in order, then whatever is left to the rest by
 * strategy (the lump's own, else the plan's).
 */
export interface Lump {
  month: number;
  cents: number;
  ids?: string[];
  strategy?: Strategy;
}

export interface PayoffOptions {
  extraCents: number;
  strategy: Strategy;
  rollForward: boolean;
  lumps?: Lump[];
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

const targetOrder = (open: State[], strategy: Strategy): State[] =>
  [...open].sort((a, b) => {
    const byBalance = a.owed - b.owed;
    const first =
      strategy === 'snowball' ? byBalance : b.loan.aprMilliPct - a.loan.aprMilliPct || byBalance;
    return first || a.loan.id.localeCompare(b.loan.id);
  });

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

  const applyLumps = (at: number) => {
    for (const lump of opts.lumps ?? []) {
      if (lump.month !== at) continue;
      const open = states.filter((s) => s.owed > 0);
      const named = (lump.ids ?? []).flatMap((id) => open.filter((s) => s.loan.id === id));
      const rest = targetOrder(
        open.filter((s) => !named.includes(s)),
        lump.strategy ?? opts.strategy,
      );
      let left = lump.cents;
      for (const s of [...named, ...rest]) {
        const paid = Math.min(left, s.owed);
        s.owed -= paid;
        left -= paid;
        if (s.owed === 0) s.payoffMonth = at;
      }
    }
  };
  applyLumps(0);
  totalOwedByMonth[0] = totalOwed();

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
    const order = targetOrder(
      active.filter((s) => s.owed > 0),
      opts.strategy,
    );
    for (const s of order) {
      const paid = Math.min(Math.max(spare, 0), s.owed);
      s.owed -= paid;
      spare -= paid;
    }
    for (const s of active) if (s.owed === 0) s.payoffMonth = month;
    applyLumps(month);
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
