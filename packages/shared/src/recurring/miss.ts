import { dateFromDayNumber, dayNumber } from '../networth';
import { within5Pct } from './amount';
import { BROKEN_AFTER_DAYS, INTERVAL_TOLERANCE_DAYS, type Cadence } from './detect';
import type { AccountOccurrence } from './suggest';

/**
 * Whether a detected series' missed charge is worth a clay note (SPEC §7). Pure.
 *
 * - `active`: not late yet, or late but not knowably missed: the card it charges to hasn't
 *   reported anything since the due date (Apple Card reports monthly), or the same amount
 *   landed that week under a drifted merchant name ("ESPN PLUS" for "ESPN").
 * - `broken`: one cycle missed with nothing to explain it. The only state that is clay.
 * - `lapsed`: the next cycle is missed too. It stopped; Recurring lists it quietly, the
 *   Dashboard doesn't. Recomputed every refresh, so a charge that resumes revives it.
 */
export type MissState = 'active' | 'broken' | 'lapsed';

/** Longest gap one cycle of each cadence can span. */
export const CYCLE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  biweekly: 14,
  semimonthly: 16,
  monthly: 31,
  annual: 366,
};

/** Words too generic to tie two merchant names together. */
const GENERIC = new Set([
  'THE',
  'ACH',
  'POS',
  'DEBIT',
  'CREDIT',
  'PURCHASE',
  'PAYMENT',
  'PYMNT',
  'ONLINE',
  'WEB',
  'CHECKCARD',
  'RECURRING',
  'BILL',
]);

/** The first distinctive word of a merchant name, the part that survives a descriptor change. */
export function merchantStem(merchant: string): string | null {
  for (const w of merchant.toUpperCase().match(/[A-Z]{3,}/g) ?? []) {
    if (!GENERIC.has(w)) return w;
  }
  return null;
}

/** The latest date each account reported a charge. */
export function latestByAccount(
  byMerchant: ReadonlyMap<string, readonly AccountOccurrence[]>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const occ of byMerchant.values()) {
    for (const o of occ) {
      const prev = out.get(o.accountId);
      if (!prev || o.date > prev) out.set(o.accountId, o.date);
    }
  }
  return out;
}

export interface MissInput {
  merchant: string;
  cadence: Cadence;
  nextExpectedDate: string;
  expectedAmountCents: number;
  /** The account its latest charge posted to, or null when none is in the window. */
  accountId: string | null;
}

export function missState(
  s: MissInput,
  byMerchant: ReadonlyMap<string, readonly AccountOccurrence[]>,
  latest: ReadonlyMap<string, string>,
  today: string,
): MissState {
  const due = dayNumber(s.nextExpectedDate);
  const late = dayNumber(today) - due;
  if (late <= BROKEN_AFTER_DAYS) return 'active';
  if (late > CYCLE_DAYS[s.cadence] + BROKEN_AFTER_DAYS) return 'lapsed';
  // The card hasn't reported past the charge's window: unknown, not missed.
  const reported = s.accountId ? latest.get(s.accountId) : undefined;
  const windowEnd = dateFromDayNumber(due + INTERVAL_TOLERANCE_DAYS);
  if (!reported || reported < windowEnd) return 'active';
  return continuesElsewhere(s, byMerchant) ? 'active' : 'broken';
}

/** A same-amount charge, around the due date, from another merchant sharing its stem. */
export function continuesElsewhere(
  s: MissInput,
  byMerchant: ReadonlyMap<string, readonly AccountOccurrence[]>,
): boolean {
  const stem = merchantStem(s.merchant);
  if (!stem) return false;
  const due = dayNumber(s.nextExpectedDate);
  for (const [merchant, occ] of byMerchant) {
    if (merchant === s.merchant || merchantStem(merchant) !== stem) continue;
    const hit = occ.some(
      (o) =>
        Math.abs(dayNumber(o.date) - due) <= INTERVAL_TOLERANCE_DAYS &&
        Math.sign(o.amountCents) === Math.sign(s.expectedAmountCents) &&
        within5Pct(o.amountCents, s.expectedAmountCents),
    );
    if (hit) return true;
  }
  return false;
}
