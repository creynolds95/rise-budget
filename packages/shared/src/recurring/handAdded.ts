import { dayNumber } from '../networth';
import { within5Pct } from './amount';
import { earliestMatch } from './calendar';
import { advanceManualRule, firstUpcoming, parts, type Cadence } from './detect';
import { CYCLE_DAYS } from './miss';

export interface ProofRow {
  /** Stable key, so one row proves one schedule. */
  key: string;
  date: string;
  /** SPEC §1.1: money out positive. */
  amountCents: number;
}

export interface HandAddedRule {
  cadence: Cadence;
  anchorDays: [number, number] | null;
  /** SPEC §1.1 sign: a bill positive, a paycheck negative. */
  amountCents: number;
  nextExpectedDate: string;
}

/**
 * Move a hand-added schedule on, only on proof. Pure.
 *
 * It has no merchant to tie a charge to, so the proof is a row in the cash accounts of the
 * same direction and about the same amount (5%), dated no earlier than the schedule's early
 * window (`earliestMatch`: a bill is never paid early). The earliest such row not already
 * `claimed` by another schedule proves it, and each row proves one schedule. With no proof it
 * stays where it is, owed, until a whole cycle has passed: then the missed-bill note is the
 * signal and it rolls to its next date so it never goes stale.
 */
export function advanceHandAdded(
  rule: HandAddedRule,
  rows: readonly ProofRow[],
  claimed: ReadonlySet<string>,
  today: string,
): { nextExpectedDate: string; claimedKey: string | null } {
  const from = dayNumber(earliestMatch(rule.nextExpectedDate, rule.amountCents < 0));
  const proof =
    rows
      .filter(
        (r) =>
          !claimed.has(r.key) &&
          Math.sign(r.amountCents) === Math.sign(rule.amountCents) &&
          within5Pct(r.amountCents, rule.amountCents) &&
          dayNumber(r.date) >= from,
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  if (proof) {
    const { nextExpectedDate } = advanceManualRule(
      {
        cadence: rule.cadence,
        anchorDays: rule.anchorDays,
        expectedAmountCents: rule.amountCents,
        nextExpectedDate: rule.nextExpectedDate,
      },
      [{ date: proof.date, amountCents: proof.amountCents, categoryId: null }],
      today,
    );
    return { nextExpectedDate, claimedKey: proof.key };
  }
  const late = dayNumber(today) - dayNumber(rule.nextExpectedDate);
  if (late < CYCLE_DAYS[rule.cadence]) {
    return { nextExpectedDate: rule.nextExpectedDate, claimedKey: null };
  }
  const day = parts(rule.nextExpectedDate).d;
  return {
    nextExpectedDate: firstUpcoming(
      rule.cadence,
      rule.nextExpectedDate,
      rule.anchorDays ?? [day, day],
      today,
    ),
    claimedKey: null,
  };
}
