import { dateFromDayNumber, dayNumber } from '../networth';
import { within5Pct } from './amount';

/**
 * Whether a Surplus schedule's money has already moved in the bank balance before its
 * transaction reached Rise. Pure.
 *
 * SimpleFIN can report a balance that already has a bill taken out of it a day or more before
 * the bill's transaction comes through. Counting that bill as still to come subtracts it
 * twice, so Surplus reads short on the very day the bill leaves. Instead the balance is the
 * evidence: since a balance from before the bill, it has moved by what the imported
 * transactions explain plus something more. When that something more is a due bill (or a
 * set of them), those bills have already left and are not projected again.
 *
 * It only ever says "seen" when every way of explaining the balance agrees. A balance it
 * can't explain leaves every bill counted, as before: cautious, never reading high.
 */

/** Days after a due date a schedule is still looked for in the balance, before its lag. */
export const BALANCE_GRACE_DAYS = 2;
/** Days before its due date a bill or paycheck may leave or land early. */
export const BALANCE_EARLY_DAYS = 3;
/** A learned lag never stretches the search further than this. */
export const MAX_BALANCE_LAG_DAYS = 7;
/** Seen in the balance this long with no transaction: stop waiting for it. */
export const BALANCE_GIVE_UP_DAYS = 14;
/** The most schedules weighed at once (each can count 0, 1 or 2 times: 3^8 ways). */
export const MAX_BALANCE_CANDIDATES = 8;

export interface BalanceReading {
  asOf: string;
  balanceCents: number;
}

export interface BalanceTxn {
  accountId: string;
  postedAt: string;
  /** SPEC §1.1: money out positive. */
  amountCents: number;
  isPending: boolean;
}

export interface BalanceRule {
  id: string;
  /** The due date still waiting on its transaction. */
  dueOn: string;
  /** SPEC §1.1 sign: a bill positive, a paycheck negative. */
  amountCents: number;
  /** Days its transaction usually trails the balance, once learned. */
  lagDays: number | null;
  /** The due date an earlier sync already saw in the balance, still waiting on its row. */
  seenDue: string | null;
}

export interface SeenInBalance {
  id: string;
  dueOn: string;
  /** The balance moved by this schedule twice: possibly charged twice. */
  twice: boolean;
}

const clampLag = (lag: number | null) => Math.min(Math.max(lag ?? 0, 0), MAX_BALANCE_LAG_DAYS);

interface Candidate {
  id: string;
  dueOn: string;
  /** What it does to the balance: a bill takes away, a paycheck adds. */
  deltaCents: number;
  forced: boolean;
}

/** The latest reading before `day`, and the latest of all. */
function readings(snaps: readonly BalanceReading[], before: string) {
  let base: BalanceReading | null = null;
  let current: BalanceReading | null = null;
  for (const s of snaps) {
    if (s.asOf < before && (!base || s.asOf > base.asOf)) base = s;
    if (!current || s.asOf > current.asOf) current = s;
  }
  return { base, current };
}

/**
 * Every multiset of candidates (each 0-2 times, a forced one at least once) whose total
 * movement is within 5% of the unexplained gap. The empty set fits a gap within 5% of the
 * smallest candidate: a balance that moved by about nothing beyond its transactions.
 */
function fits(gapCents: number, cands: readonly Candidate[]): number[][] {
  const out: number[][] = [];
  const counts: number[] = cands.map((c) => (c.forced ? 1 : 0));
  const smallest = Math.min(...cands.map((c) => Math.abs(c.deltaCents)));
  const walk = (i: number) => {
    if (i === cands.length) {
      let moved = 0;
      let size = 0;
      cands.forEach((c, k) => {
        moved += (counts[k] as number) * c.deltaCents;
        size += (counts[k] as number) * Math.abs(c.deltaCents);
      });
      // Within 5% of what moved (of the smallest candidate when nothing did), in whole cents.
      if (100 * Math.abs(gapCents - moved) <= 5 * (size > 0 ? size : smallest))
        out.push([...counts]);
      return;
    }
    for (let n = counts[i] as number; n <= 2; n++) {
      counts[i] = n;
      walk(i + 1);
    }
    counts[i] = (cands[i] as Candidate).forced ? 1 : 0;
  };
  walk(0);
  return out;
}

/**
 * Which schedules the cash accounts' balance already shows. `snapshots` holds each cash
 * account's dated balances; `txns` every transaction in those accounts since well before the
 * oldest due date weighed.
 */
export function seenInBalance(
  snapshots: ReadonlyMap<string, readonly BalanceReading[]>,
  txns: readonly BalanceTxn[],
  rules: readonly BalanceRule[],
  today: string,
): SeenInBalance[] {
  const latest = [...snapshots.values()].map((s) => readings(s, '').current);
  if (latest.length === 0 || latest.some((r) => r === null)) return [];
  const balanceDay = Math.min(...(latest as BalanceReading[]).map((r) => dayNumber(r.asOf)));
  const todayN = dayNumber(today);
  const cands: Candidate[] = rules
    .flatMap((r): Candidate[] => {
      const deltaCents = -r.amountCents;
      if (deltaCents === 0) return [];
      if (r.seenDue && todayN - dayNumber(r.seenDue) <= BALANCE_GIVE_UP_DAYS + MAX_BALANCE_LAG_DAYS)
        return [{ id: r.id, dueOn: r.seenDue, deltaCents, forced: true }];
      const due = dayNumber(r.dueOn);
      const open =
        due >= balanceDay - BALANCE_GRACE_DAYS - clampLag(r.lagDays) &&
        due <= balanceDay + BALANCE_EARLY_DAYS;
      return open ? [{ id: r.id, dueOn: r.dueOn, deltaCents, forced: false }] : [];
    })
    .sort((a, b) => Number(b.forced) - Number(a.forced) || a.dueOn.localeCompare(b.dueOn))
    .slice(0, MAX_BALANCE_CANDIDATES);
  if (cands.length === 0) return [];
  const forcedOnly = () =>
    cands.filter((c) => c.forced).map((c) => ({ id: c.id, dueOn: c.dueOn, twice: false }));

  // A balance from before any of them could have moved it (early ones included).
  const from = dateFromDayNumber(
    Math.min(...cands.map((c) => dayNumber(c.dueOn))) - BALANCE_EARLY_DAYS,
  );
  // Banks differ on whether a pending row is in the balance yet, so both readings are weighed.
  let gapPosted = 0;
  let pendingCents = 0;
  for (const [accountId, snaps] of snapshots) {
    const { base, current } = readings(snaps, from);
    if (!base) return forcedOnly();
    gapPosted += (current as BalanceReading).balanceCents - base.balanceCents;
    for (const t of txns) {
      if (t.accountId !== accountId || t.postedAt <= base.asOf) continue;
      if (t.postedAt > (current as BalanceReading).asOf) continue;
      if (t.isPending) pendingCents += t.amountCents;
      else gapPosted += t.amountCents;
    }
  }
  const all = [...fits(gapPosted, cands), ...fits(gapPosted + pendingCents, cands)];
  if (all.length === 0) return forcedOnly();
  // Seen only where every fit agrees; twice only where every fit says twice.
  return cands.flatMap((c, k) => {
    const least = Math.min(...all.map((f) => f[k] as number));
    return least > 0 ? [{ id: c.id, dueOn: c.dueOn, twice: least === 2 }] : [];
  });
}

/**
 * Whether any schedule is near enough its due date (or already seen) for the balance to be
 * worth reading at all: most days none is, and the reads are skipped.
 */
export function anyNearDue(
  rules: readonly Pick<BalanceRule, 'dueOn' | 'seenDue'>[],
  today: string,
) {
  const t = dayNumber(today);
  return rules.some((r) => {
    if (r.seenDue) return true;
    const due = dayNumber(r.dueOn);
    return (
      due >= t - BALANCE_GRACE_DAYS - MAX_BALANCE_LAG_DAYS - BALANCE_EARLY_DAYS &&
      due <= t + BALANCE_EARLY_DAYS
    );
  });
}

/** A new lag sample folded into what was learned: the average, rounded, within bounds. */
export function learnLag(prev: number | null, sampleDays: number): number {
  const sample = clampLag(sampleDays);
  return prev === null ? sample : Math.round((clampLag(prev) + sample) / 2);
}

/** Whether a schedule seen in the balance has waited past its usual lag for its row. */
export function balanceOverdue(seenOn: string, lagDays: number | null, today: string): boolean {
  return (
    dayNumber(today) - dayNumber(seenOn) >= Math.max(BALANCE_GRACE_DAYS, clampLag(lagDays) + 1)
  );
}

/**
 * The transaction that confirms a hand-added schedule seen in the balance: no merchant ties
 * them, so the same direction and amount (5%) from a few days before its due date on.
 */
export function handAddedArrival<T extends { postedAt: string; amountCents: number }>(
  rule: { amountCents: number; dueOn: string },
  txns: readonly T[],
): T | null {
  const from = dateFromDayNumber(dayNumber(rule.dueOn) - BALANCE_EARLY_DAYS);
  return (
    txns
      .filter((t) => t.postedAt >= from && within5Pct(t.amountCents, rule.amountCents))
      .sort((a, b) => a.postedAt.localeCompare(b.postedAt))[0] ?? null
  );
}
