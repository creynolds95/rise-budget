import { dateFromDayNumber, dayNumber } from '../networth';
import { within5Pct } from './amount';
import { earliestMatch, nextBusinessDay } from './calendar';

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
  /** Normalized merchant, to tie a pending row to a tagged schedule. */
  merchant?: string;
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
  /** A tagged schedule's merchant; absent for a hand-added one (matched by amount). */
  merchant?: string | null;
}

export interface SeenInBalance {
  id: string;
  dueOn: string;
  /** The balance moved by this schedule twice: possibly charged twice. */
  twice: boolean;
}

/**
 * When its money can first show in the balance. A paycheck may land up to a few days early
 * (up to the paycheck's early business days); a bill is taken on its due date, or the next
 * business day when that is a weekend or bank holiday, so a balance read before then says nothing about it (a coincidental
 * gap must not read as the bill, which would drop it from Surplus).
 */
function firstShows(c: { dueOn: string; deltaCents: number }): number {
  return c.deltaCents > 0
    ? dayNumber(earliestMatch(c.dueOn, true))
    : dayNumber(nextBusinessDay(c.dueOn));
}

/**
 * Whether money due `dueOn` can have moved by `today`: a bill is taken no earlier than its
 * business day, a paycheck lands no earlier than its early window. A balance reading can never
 * show it before that, so a "seen" mark from before then is a coincidence (or an older rule's
 * mistake) and is dropped, never trusted.
 */
export function mayHaveLeft(dueOn: string, amountCents: number, today: string): boolean {
  const first = amountCents < 0 ? earliestMatch(dueOn, true) : nextBusinessDay(dueOn);
  return first <= today;
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
 * movement is within 5% (of the smallest one counted) of the unexplained gap. The empty set fits a gap within 5% of the
 * smallest candidate: a balance that moved by about nothing beyond its transactions.
 */
function fits(gapCents: number, cands: readonly Candidate[]): number[][] {
  const out: number[][] = [];
  const counts: number[] = cands.map((c) => (c.forced ? 1 : 0));
  const smallest = Math.min(...cands.map((c) => Math.abs(c.deltaCents)));
  const walk = (i: number) => {
    if (i === cands.length) {
      let moved = 0;
      let smallestCounted = Infinity;
      cands.forEach((c, k) => {
        const n = counts[k] as number;
        moved += n * c.deltaCents;
        if (n > 0) smallestCounted = Math.min(smallestCounted, Math.abs(c.deltaCents));
      });
      // Each counted schedule gets its own 5% check, not 5% of the total: the leftover gap must
      // be within 5% of the smallest one counted (of the smallest candidate when none was).
      const unit = Number.isFinite(smallestCounted) ? smallestCounted : smallest;
      if (100 * Math.abs(gapCents - moved) <= 5 * unit) out.push([...counts]);
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
  // The day each account's balance is really from: its reported date, or later when it
  // already has newer pending rows out (the bank's date can lag the money in it).
  const asOf = new Map(
    [...snapshots].map(([id, snaps]) => [id, effectiveAsOf(id, snaps, txns, today)]),
  );
  // A balance can't be from after today (a clock or zone slip must not open future bills).
  const balanceDay = Math.min(dayNumber(today), ...[...asOf.values()].map(dayNumber));
  const todayN = dayNumber(today);
  const cands: Candidate[] = rules
    .flatMap((r): Candidate[] => {
      const deltaCents = -r.amountCents;
      if (deltaCents === 0) return [];
      if (
        r.seenDue &&
        mayHaveLeft(r.seenDue, r.amountCents, today) &&
        todayN - dayNumber(r.seenDue) <= BALANCE_GIVE_UP_DAYS + MAX_BALANCE_LAG_DAYS
      )
        return [{ id: r.id, dueOn: r.seenDue, deltaCents, forced: true }];
      const due = dayNumber(r.dueOn);
      const open =
        due >= balanceDay - BALANCE_GRACE_DAYS - clampLag(r.lagDays) &&
        firstShows({ dueOn: r.dueOn, deltaCents }) <= balanceDay;
      return open ? [{ id: r.id, dueOn: r.dueOn, deltaCents, forced: false }] : [];
    })
    .sort((a, b) => Number(b.forced) - Number(a.forced) || a.dueOn.localeCompare(b.dueOn))
    .slice(0, MAX_BALANCE_CANDIDATES);
  if (cands.length === 0) return [];
  const forcedOnly = () =>
    cands.filter((c) => c.forced).map((c) => ({ id: c.id, dueOn: c.dueOn, twice: false }));

  // A balance from before any of them could have moved it (early ones included).
  const from = dateFromDayNumber(Math.min(...cands.map(firstShows)));
  // Banks differ on whether a pending row is in the balance yet, so both readings are weighed.
  let gapPosted = 0;
  let pendingCents = 0;
  // Pending rows dated the base reading's own day: that reading may or may not have them.
  let pendingOnBase = 0;
  for (const [accountId, snaps] of snapshots) {
    const current = readings(snaps, '').current as BalanceReading;
    const until = asOf.get(accountId) as string;
    // The base is always an earlier reading than the current one, even when the current one
    // is dated before the bills it already has out.
    const { base } = readings(snaps, from < current.asOf ? from : current.asOf);
    if (!base) return forcedOnly();
    gapPosted += current.balanceCents - base.balanceCents;
    for (const t of txns) {
      if (t.accountId !== accountId || t.postedAt > until) continue;
      if (t.postedAt === base.asOf && t.isPending) pendingOnBase += t.amountCents;
      if (t.postedAt <= base.asOf) continue;
      if (t.isPending) pendingCents += t.amountCents;
      else gapPosted += t.amountCents;
    }
  }
  // When the balance has taken the pending rows out (what the imported rows leave unexplained
  // is exactly their sum), a pending row that is a schedule's own charge proves it left.
  const proven =
    pendingBalanceTakesOut(gapPosted, pendingCents) ||
    pendingBalanceTakesOut(gapPosted, pendingCents + pendingOnBase)
      ? pendingProven(cands, rules, txns)
      : new Set<string>();
  const all = [...fits(gapPosted, cands), ...fits(gapPosted + pendingCents, cands)];
  // Seen only where every fit agrees; twice only where every fit says twice.
  const fromFits = new Map<string, boolean>();
  if (all.length > 0) {
    cands.forEach((c, k) => {
      const least = Math.min(...all.map((f) => f[k] as number));
      if (least > 0) fromFits.set(c.id, least === 2);
    });
  }
  const out = cands.flatMap((c) =>
    fromFits.has(c.id)
      ? [{ id: c.id, dueOn: c.dueOn, twice: fromFits.get(c.id) as boolean }]
      : proven.has(c.id) || (all.length === 0 && c.forced)
        ? [{ id: c.id, dueOn: c.dueOn, twice: false }]
        : [],
  );
  return out;
}

/**
 * The day an account's latest balance is really from. A bank can report a balance that
 * already has newer pending rows taken out under an older date (its date only moves when a
 * row posts), and that balance overwrites the day's reading. When the latest balance, against
 * the reading before the earliest pending row, is explained exactly by the rows since with
 * every pending row out, it is as new as the newest of them. Anything else: its own date.
 */
function effectiveAsOf(
  accountId: string,
  snaps: readonly BalanceReading[],
  txns: readonly BalanceTxn[],
  today: string,
): string {
  const current = readings(snaps, '').current as BalanceReading;
  const mine = txns.filter((t) => t.accountId === accountId && t.postedAt <= today);
  const pending = mine.filter((t) => t.isPending);
  const newest = pending.reduce((d, t) => (t.postedAt > d ? t.postedAt : d), '');
  if (newest <= current.asOf) return current.asOf;
  const earliest = pending.reduce((d, t) => (t.postedAt < d ? t.postedAt : d), newest);
  const { base } = readings(snaps, earliest < current.asOf ? earliest : current.asOf);
  if (!base) return current.asOf;
  let gap = current.balanceCents - base.balanceCents;
  let pendingCents = 0;
  for (const t of mine) {
    if (t.postedAt <= base.asOf) continue;
    if (t.isPending) pendingCents += t.amountCents;
    else gap += t.amountCents;
  }
  return pendingBalanceTakesOut(gap, pendingCents) ? newest : current.asOf;
}

/** Slack for the unexplained gap to equal the pending rows' sum (cents). */
const PENDING_TAKEN_TOLERANCE_CENTS = 100;

/**
 * Whether the balance already has the pending rows taken out: what the rows leave unexplained
 * is their sum, and not about nothing. Anything else (a bank that adds them later, or a gap of
 * its own) says nothing, and no pending row is trusted.
 */
function pendingBalanceTakesOut(gapPosted: number, pendingCents: number): boolean {
  return (
    pendingCents !== 0 &&
    Math.abs(gapPosted) > PENDING_TAKEN_TOLERANCE_CENTS &&
    Math.abs(gapPosted + pendingCents) <= PENDING_TAKEN_TOLERANCE_CENTS
  );
}

/**
 * Candidates whose own pending charge is in the transactions: the schedule's merchant (any
 * amount: the bank's is the truth), or the exact amount (a hand-added schedule has no
 * merchant, and a bill's amount does not change). Each row proves one schedule.
 */
function pendingProven(
  cands: readonly Candidate[],
  rules: readonly BalanceRule[],
  txns: readonly BalanceTxn[],
): Set<string> {
  const used = new Set<BalanceTxn>();
  const out = new Set<string>();
  for (const c of cands) {
    const r = rules.find((x) => x.id === c.id) as BalanceRule;
    const from = earliestMatch(c.dueOn, c.deltaCents > 0);
    const row = txns
      .filter(
        (t) =>
          t.isPending &&
          !used.has(t) &&
          t.postedAt >= from &&
          Math.sign(t.amountCents) === Math.sign(r.amountCents) &&
          ((r.merchant != null && t.merchant === r.merchant) || t.amountCents === r.amountCents),
      )
      .sort((a, b) => a.postedAt.localeCompare(b.postedAt))[0];
    if (row) {
      used.add(row);
      out.add(c.id);
    }
  }
  return out;
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
  const from = earliestMatch(rule.dueOn, rule.amountCents < 0);
  return (
    txns
      .filter((t) => t.postedAt >= from && within5Pct(t.amountCents, rule.amountCents))
      .sort((a, b) => a.postedAt.localeCompare(b.postedAt))[0] ?? null
  );
}
