import { dateFromDayNumber, dayNumber } from '../networth';

/**
 * Recurring detection (SPEC §7). Pure. A series is ≥ 3 charges from one merchant with
 * steady amounts on a steady cadence. It predicts the next charge, flags a missed one, and
 * feeds pace (`typical_post_day`) and Layer-3 categorisation.
 */

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'annual';

export interface Occurrence {
  date: string;
  amountCents: number;
  /** The single category this charge was filed under, if any. */
  categoryId: string | null;
}

export interface DetectedSeries {
  cadence: Cadence;
  /** The latest charge: a price change shows up as the new expectation. */
  expectedAmountCents: number;
  lastDate: string;
  nextExpectedDate: string;
  status: 'active' | 'broken';
  categoryId: string | null;
  occurrences: number;
}

export const MIN_OCCURRENCES = 3;
export const INTERVAL_TOLERANCE_DAYS = 4;
export const AMOUNT_TOLERANCE_PERCENT = 5;
export const BROKEN_AFTER_DAYS = 7;

function parts(date: string) {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) };
}

const daysInMonth = (y: number, m: number) =>
  dayNumber(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`) -
  dayNumber(`${y}-${String(m).padStart(2, '0')}-01`);

/** Same day next month (or next year), clamped to the month's length. */
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const { y, m, d } = parts(date);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function nextDate(cadence: Cadence, from: string, anchorDay?: number): string {
  switch (cadence) {
    case 'weekly':
      return dateFromDayNumber(dayNumber(from) + 7);
    case 'biweekly':
      return dateFromDayNumber(dayNumber(from) + 14);
    case 'monthly':
      return addMonths(from, 1, anchorDay);
    case 'annual':
      return addMonths(from, 12, anchorDay);
  }
}

/** Total deviation from the cadence, or null if any interval misses it by more than ±4 days. */
function cadenceFit(dates: string[], cadence: Cadence): number | null {
  const anchor = parts(dates[0] as string).d;
  let total = 0;
  for (let i = 1; i < dates.length; i++) {
    const expected = nextDate(cadence, dates[i - 1] as string, anchor);
    const off = Math.abs(dayNumber(dates[i] as string) - dayNumber(expected));
    if (off > INTERVAL_TOLERANCE_DAYS) return null;
    total += off;
  }
  return total;
}

const CADENCES: Cadence[] = ['weekly', 'biweekly', 'monthly', 'annual'];

/** Every amount within 5% of the median (exact integer maths on the doubled median). */
export function steadyAmounts(amounts: number[]): boolean {
  const sorted = [...amounts].sort((a, b) => a - b);
  const n = sorted.length;
  const m2 =
    n % 2 === 1
      ? 2 * (sorted[(n - 1) / 2] as number)
      : (sorted[n / 2 - 1] as number) + (sorted[n / 2] as number);
  return amounts.every(
    (a) => 100 * Math.abs(2 * a - m2) <= AMOUNT_TOLERANCE_PERCENT * Math.abs(m2),
  );
}

function bestCadence(dates: string[]): Cadence | null {
  let best: { cadence: Cadence; fit: number } | null = null;
  for (const cadence of CADENCES) {
    const fit = cadenceFit(dates, cadence);
    if (fit !== null && (best === null || fit < best.fit)) best = { cadence, fit };
  }
  return best?.cadence ?? null;
}

/**
 * The longest run of most-recent charges that forms a series. Older charges that don't fit
 * (a price change long ago, a one-off) are ignored rather than blocking detection.
 */
export function detectSeries(
  occurrences: readonly Occurrence[],
  today: string,
): DetectedSeries | null {
  const all = [...occurrences].sort((a, b) => a.date.localeCompare(b.date));
  for (let start = 0; start + MIN_OCCURRENCES <= all.length; start++) {
    const run = all.slice(start);
    const amounts = run.map((o) => o.amountCents);
    if (amounts.some((a) => Math.sign(a) !== Math.sign(amounts[0] as number) || a === 0)) continue;
    if (!steadyAmounts(amounts)) continue;
    const dates = run.map((o) => o.date);
    const cadence = bestCadence(dates);
    if (!cadence) continue;
    const last = run.at(-1) as Occurrence;
    const nextExpectedDate = nextDate(cadence, last.date, parts(dates[0] as string).d);
    return {
      cadence,
      expectedAmountCents: last.amountCents,
      lastDate: last.date,
      nextExpectedDate,
      status:
        dayNumber(today) - dayNumber(nextExpectedDate) > BROKEN_AFTER_DAYS ? 'broken' : 'active',
      categoryId: establishedCategory(run),
      occurrences: run.length,
    };
  }
  return null;
}

/** The latest charge's category, if at least two charges in the series share it. */
function establishedCategory(run: Occurrence[]): string | null {
  const latest = [...run].reverse().find((o) => o.categoryId !== null)?.categoryId ?? null;
  if (latest === null) return null;
  return run.filter((o) => o.categoryId === latest).length >= 2 ? latest : null;
}

/** Day of month a monthly bill is expected, for fixed-shape pace (SPEC §2.7). */
export const typicalPostDay = (s: DetectedSeries): number | null =>
  s.cadence === 'monthly' ? parts(s.nextExpectedDate).d : null;
