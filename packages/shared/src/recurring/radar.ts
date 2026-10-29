import { dayNumber } from '../networth';
import { within5Pct } from './amount';
import type { Cadence, Occurrence } from './detect';
import { CYCLE_DAYS } from './miss';

/** Charges a year at each cadence, for a series' yearly cost. */
export const PER_YEAR: Record<Cadence, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  annual: 1,
};

/** How long a price change or a double charge stays on the radar. */
export const RADAR_DAYS = 60;

export interface Radar {
  /** The charge before the latest, when the latest went up by more than 5%. */
  previousAmountCents: number | null;
  priceChangedOn: string | null;
  /** The later of two charges in one cycle, for the same amount. */
  doubleChargedOn: string | null;
}

/**
 * What the subscription radar notices about one series (SPEC §7.1). Pure, and quiet by design:
 * only a price that went up, or two same-size charges well inside one cycle, and each only
 * for `RADAR_DAYS` after it happened. A series that went quiet is `missState`'s job.
 */
export function seriesRadar(occ: readonly Occurrence[], cadence: Cadence, today: string): Radar {
  const sorted = [...occ].sort((a, b) => a.date.localeCompare(b.date));
  const recent = (date: string) => dayNumber(today) - dayNumber(date) <= RADAR_DAYS;
  // The latest price, and the charge before it started: back past every charge at the
  // latest price, so a doubled new price still reads as one change.
  const last = sorted.at(-1);
  let from = sorted.length - 1;
  while (
    from > 0 &&
    last &&
    within5Pct((sorted[from - 1] as Occurrence).amountCents, last.amountCents)
  )
    from--;
  const changed = sorted[from];
  const prev = sorted[from - 1];
  const up =
    last &&
    changed &&
    prev &&
    recent(changed.date) &&
    Math.abs(last.amountCents) > Math.abs(prev.amountCents);
  // Weekly charges sit too close together to tell a double from a schedule.
  const gap = cadence === 'weekly' ? 0 : Math.floor(CYCLE_DAYS[cadence] / 4);
  let doubled: string | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as Occurrence;
    const b = sorted[i] as Occurrence;
    if (
      recent(b.date) &&
      dayNumber(b.date) - dayNumber(a.date) <= gap &&
      within5Pct(b.amountCents, a.amountCents)
    )
      doubled = b.date;
  }
  return {
    previousAmountCents: up ? prev.amountCents : null,
    priceChangedOn: up ? changed.date : null,
    doubleChargedOn: doubled,
  };
}

export type ChargeFlag = 'duplicate' | 'unusual' | 'first_time';

export interface FlagCandidate {
  id: string;
  date: string;
  amountCents: number;
  accountId: string;
  /** Only rows still waiting for review are flagged; history is only compared against. */
  needsReview: boolean;
}

/** Below these, a flag is more noise than help. */
export const DUPLICATE_MIN_CENTS = 2_000;
export const UNUSUAL_MIN_OVER_CENTS = 5_000;
export const FIRST_TIME_MIN_CENTS = 30_000;
/** Only rows this recent are flagged, so history from an import never lights up. */
export const FLAG_WINDOW_DAYS = 10;

/**
 * Quiet flags for one merchant's charges (SPEC §8.1). Pure. A row waiting for review, posted
 * in the last `FLAG_WINDOW_DAYS`, money out, gets at most one:
 * - `duplicate`: the same amount at the same account within two days of another charge;
 * - `unusual`: at least three earlier charges, and this one is over 2.5× their median and at
 *   least $50 more;
 * - `first_time`: no earlier charge at this merchant at all, and $300 or more.
 */
export function chargeFlags(
  rows: readonly FlagCandidate[],
  today: string,
): Map<string, ChargeFlag> {
  const out = new Map<string, ChargeFlag>();
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  sorted.forEach((r, i) => {
    if (!r.needsReview || r.amountCents <= 0) return;
    if (dayNumber(today) - dayNumber(r.date) > FLAG_WINDOW_DAYS) return;
    const earlier = sorted.slice(0, i).filter((e) => e.amountCents > 0);
    const dup = earlier.some(
      (e) =>
        e.accountId === r.accountId &&
        e.amountCents === r.amountCents &&
        dayNumber(r.date) - dayNumber(e.date) <= 2,
    );
    if (dup && r.amountCents >= DUPLICATE_MIN_CENTS) {
      out.set(r.id, 'duplicate');
      return;
    }
    if (earlier.length === 0) {
      if (r.amountCents >= FIRST_TIME_MIN_CENTS) out.set(r.id, 'first_time');
      return;
    }
    if (earlier.length < 3) return;
    const amounts = earlier.map((e) => e.amountCents).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)] as number;
    if (2 * r.amountCents > 5 * median && r.amountCents - median >= UNUSUAL_MIN_OVER_CENTS)
      out.set(r.id, 'unusual');
  });
  return out;
}
