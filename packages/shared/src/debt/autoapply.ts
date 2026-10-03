import { dateFromDayNumber, dayNumber } from '../networth';
import { stepBalance } from './payoff';

/** How many days before the due date a payment may post and still count (weekend, holiday). */
export const EARLY_DAYS = 3;

export interface AutoLoan {
  accountId: string;
  aprMilliPct: number;
  paymentCents: number;
  dueDay: number;
  /** The last month ("2026-10") whose payment is already in the balance. */
  appliedThrough: string;
  owedCents: number;
}

/** An outflow already posted to a spending account (positive = money left). */
export interface AutoTxn {
  id: string;
  accountId: string;
  postedAt: string;
  amountCents: number;
}

export interface AutoApplication {
  accountId: string;
  beforeCents: number;
  afterCents: number;
  /** The day the matching debit posted. */
  asOf: string;
  txnId: string;
}

const daysIn = (period: string): number =>
  new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();

/** The loan's due date this month, clamped to short months. */
export const dueDateIn = (period: string, dueDay: number): string =>
  `${period}-${String(Math.min(dueDay, daysIn(period))).padStart(2, '0')}`;

/** Payment due this month (on or before today), not yet in the balance, and something owed. */
export const isDue = (
  l: Pick<AutoLoan, 'dueDay' | 'paymentCents' | 'appliedThrough' | 'owedCents'>,
  today: string,
): boolean => {
  const period = today.slice(0, 7);
  return (
    l.owedCents > 0 &&
    l.paymentCents > 0 &&
    l.appliedThrough < period &&
    dueDateIn(period, l.dueDay) <= today
  );
};

/**
 * Which due loans a real debit has paid. Loans sharing a due day are one cluster: a single
 * debit equal to the cluster's total pays them all (one servicer, one autopay); failing that,
 * each loan matches a debit of exactly its own payment. Every debit pays at most once and the
 * amount must match to the cent. Anything unmatched is left for the user to apply by hand.
 */
export function planAutoApply(
  loans: AutoLoan[],
  txns: AutoTxn[],
  today: string,
): AutoApplication[] {
  const period = today.slice(0, 7);
  const loanIds = new Set(loans.map((l) => l.accountId));
  const used = new Set<string>();
  const out: AutoApplication[] = [];
  const due = loans.filter((l) => isDue(l, today));
  for (const dueDay of [...new Set(due.map((l) => l.dueDay))]) {
    const cluster = due.filter((l) => l.dueDay === dueDay);
    const dueDate = dueDateIn(period, dueDay);
    const from = dateFromDayNumber(dayNumber(dueDate) - EARLY_DAYS);
    const pool = txns
      .filter(
        (t) =>
          t.amountCents > 0 &&
          t.postedAt >= from &&
          t.postedAt <= today &&
          !loanIds.has(t.accountId),
      )
      .sort((a, b) => `${a.postedAt}${a.id}`.localeCompare(`${b.postedAt}${b.id}`));
    const take = (cents: number) => {
      const t = pool.find((x) => !used.has(x.id) && x.amountCents === cents);
      if (t) used.add(t.id);
      return t;
    };
    const apply = (l: AutoLoan, t: AutoTxn) =>
      out.push({
        accountId: l.accountId,
        beforeCents: l.owedCents,
        afterCents: stepBalance(l.owedCents, l.aprMilliPct, l.paymentCents),
        asOf: t.postedAt,
        txnId: t.id,
      });
    const lump = take(cluster.reduce((n, l) => n + l.paymentCents, 0));
    for (const l of cluster) {
      const t = lump ?? take(l.paymentCents);
      if (t) apply(l, t);
    }
  }
  return out;
}
