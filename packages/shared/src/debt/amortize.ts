/**
 * One fixed-rate loan, month by month. Pure, integer cents. Interest accrues on the balance,
 * the scheduled payment covers it and the rest is principal, then any extra goes straight to
 * principal. The last payment is whatever is left.
 */
import { MAX_MONTHS, monthlyInterest, SUB } from './payoff';

/**
 * Balances run in hundredths of a cent (`SUB`), as servicers do, and as `simulatePayoff`
 * does; everything reported is whole cents.
 */
const toCents = (sub: number): number => Math.round(sub / SUB);

export interface AmortizeInput {
  /** What is owed now, positive. */
  balanceCents: number;
  aprMilliPct: number;
  /** Principal + interest, no escrow. */
  paymentCents: number;
  /** Extra principal every month. */
  extraMonthlyCents: number;
  /** One-time extra principal; month 1 is the next payment. */
  lumps: { month: number; cents: number }[];
}

export interface AmortRow {
  month: number;
  interestCents: number;
  /** All principal paid this month, extra included. */
  principalCents: number;
  extraCents: number;
  balanceCents: number;
  principalToDateCents: number;
  interestToDateCents: number;
}

export interface Amortization {
  rows: AmortRow[];
  /** Payments until it hits zero (0 if already paid); null if it never does. */
  payoffMonth: number | null;
  totalInterestCents: number;
}

export function amortize(input: AmortizeInput): Amortization {
  const lumpAt = new Map<number, number>();
  for (const l of input.lumps) lumpAt.set(l.month, (lumpAt.get(l.month) ?? 0) + l.cents);
  const rows: AmortRow[] = [];
  const payment = input.paymentCents * SUB;
  let owed = input.balanceCents * SUB;
  let principalToDate = 0;
  let interestToDate = 0;
  let month = 0;
  while (owed > 0 && month < MAX_MONTHS) {
    month++;
    const accrued = monthlyInterest(owed, input.aprMilliPct);
    // A payment under the interest leaves the gap owed, like the bank would.
    const unpaid = Math.max(accrued - payment, 0);
    const interest = accrued - unpaid;
    const scheduled = Math.min(payment - interest, owed);
    const wanted = (input.extraMonthlyCents + (lumpAt.get(month) ?? 0)) * SUB;
    const extra = Math.min(wanted, owed - scheduled);
    const principal = scheduled + extra;
    owed = owed - principal + unpaid;
    principalToDate += principal;
    interestToDate += interest;
    rows.push({
      month,
      interestCents: toCents(interest),
      principalCents: toCents(principal),
      extraCents: toCents(extra),
      balanceCents: toCents(owed),
      principalToDateCents: toCents(principalToDate),
      interestToDateCents: toCents(interestToDate),
    });
  }
  return {
    rows,
    payoffMonth: owed === 0 ? month : null,
    totalInterestCents: toCents(interestToDate),
  };
}

/**
 * What the last `months` payments split into, walked back from today's balance. An estimate: it
 * assumes each was the scheduled payment with no extra.
 */
export function paidSoFar(
  balanceCents: number,
  aprMilliPct: number,
  paymentCents: number,
  months: number,
): { principalCents: number; interestCents: number } {
  let owed = balanceCents;
  let principal = 0;
  let interest = 0;
  for (let i = 0; i < months; i++) {
    const before = Math.round(((owed + paymentCents) * 1_200_000) / (1_200_000 + aprMilliPct));
    const paidDown = Math.max(before - owed, 0);
    principal += paidDown;
    interest += paymentCents - paidDown;
    owed = before;
  }
  return { principalCents: principal, interestCents: interest };
}

/** The level payment that pays `balanceCents` off in exactly `months` payments. */
export function levelPayment(balanceCents: number, aprMilliPct: number, months: number): number {
  if (aprMilliPct === 0) return Math.ceil(balanceCents / months);
  const r = aprMilliPct / 1_200_000;
  return Math.round((balanceCents * r) / (1 - (1 + r) ** -months));
}
