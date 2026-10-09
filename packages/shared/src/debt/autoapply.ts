import { dateFromDayNumber, dayNumber } from '../networth';
import { stepBalance } from './payoff';

/** How many days before the due date a payment may post and still count (weekend, holiday). */
export const EARLY_DAYS = 3;

export interface AutoLoan {
  accountId: string;
  aprMilliPct: number;
  paymentCents: number;
  /** Part of the payment that never reduces the balance (taxes and insurance). */
  escrowCents?: number;
  dueDay: number;
  /** The last month ("2026-10") whose payment is already in the balance. */
  appliedThrough: string;
  owedCents: number;
  /** Lowercase text the debit's description contains ("mohela"); empty = match by amount. */
  merchant: string;
}

/** An outflow already posted to a spending account (positive = money left). */
export interface AutoTxn {
  id: string;
  accountId: string;
  postedAt: string;
  amountCents: number;
  /** Lowercase description, merchant and display name run together. */
  text: string;
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

export interface AutoPlan {
  applied: AutoApplication[];
  /** What the matched debits actually came to (each debit counted once). */
  debitCents: number;
}

/**
 * Which due loans a real debit has paid. Loans sharing a due day and a debit name are one
 * cluster. With a name, any debit whose description contains it pays the whole cluster, at
 * the plan's payments whatever the amount (the caller shows the difference). Without one, a
 * single debit equal to the cluster's total pays them all, or each loan matches a debit of
 * exactly its own payment. Every debit pays at most once. Anything unmatched is left for the
 * user to apply by hand.
 */
export function planAutoApply(loans: AutoLoan[], txns: AutoTxn[], today: string): AutoPlan {
  const period = today.slice(0, 7);
  const loanIds = new Set(loans.map((l) => l.accountId));
  const used = new Map<string, number>();
  const out: AutoApplication[] = [];
  const due = loans.filter((l) => isDue(l, today));
  const keyOf = (l: AutoLoan) => `${l.dueDay}|${l.merchant}`;
  // Exact-amount loans go first so a named loan never takes a debit that is theirs.
  const keys = [...new Set(due.map(keyOf))].sort(
    (a, b) => Number(b.endsWith('|')) - Number(a.endsWith('|')),
  );
  for (const key of keys) {
    const cluster = due.filter((l) => keyOf(l) === key);
    const [first] = cluster as [AutoLoan];
    const dueDate = dueDateIn(period, first.dueDay);
    const from = dateFromDayNumber(dayNumber(dueDate) - EARLY_DAYS);
    const pool = txns
      .filter(
        (t) =>
          t.amountCents > 0 &&
          t.postedAt >= from &&
          t.postedAt <= today &&
          !loanIds.has(t.accountId) &&
          !used.has(t.id),
      )
      .sort((a, b) => `${a.postedAt}${a.id}`.localeCompare(`${b.postedAt}${b.id}`));
    const take = (cents: number) => {
      const t = pool.find((x) => !used.has(x.id) && x.amountCents === cents);
      if (t) used.set(t.id, t.amountCents);
      return t;
    };
    const apply = (l: AutoLoan, t: AutoTxn) =>
      out.push({
        accountId: l.accountId,
        beforeCents: l.owedCents,
        afterCents: stepBalance(l.owedCents, l.aprMilliPct, l.paymentCents - (l.escrowCents ?? 0)),
        asOf: t.postedAt,
        txnId: t.id,
      });
    if (first.merchant !== '') {
      const named = pool.filter((t) => t.text.includes(first.merchant));
      const [earliest] = named;
      if (earliest) {
        for (const t of named) used.set(t.id, t.amountCents);
        for (const l of cluster) apply(l, earliest);
      }
      continue;
    }
    const lump = take(cluster.reduce((n, l) => n + l.paymentCents, 0));
    for (const l of cluster) {
      const t = lump ?? take(l.paymentCents);
      if (t) apply(l, t);
    }
  }
  return { applied: out, debitCents: [...used.values()].reduce((n, c) => n + c, 0) };
}
