import { dateFromDayNumber, dayNumber } from '../networth';

/**
 * Recurring detection (SPEC §7). Pure. A series is ≥ 3 charges from one merchant with
 * steady amounts on a steady cadence. It predicts the next charge, flags a missed one, and
 * feeds pace (`typical_post_day`) and Layer-3 categorisation.
 */

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'annual' | 'semimonthly';

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
  /** Only set for `semimonthly`: the two days of month it pays on, before weekend-shift. */
  anchorDays: [number, number] | null;
}

export const MIN_OCCURRENCES = 3;
export const INTERVAL_TOLERANCE_DAYS = 4;
export const AMOUNT_TOLERANCE_PERCENT = 5;
export const BROKEN_AFTER_DAYS = 7;

export function parts(date: string) {
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
    case 'semimonthly':
      throw new Error('semimonthly cadence uses nextSemimonthlyDate, not nextDate');
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
      anchorDays: null,
    };
  }
  return null;
}

export const MIN_SEMIMONTHLY_OCCURRENCES = 4;
/** A gap smaller than this between the two day-of-month clusters means they're really one. */
const MIN_ANCHOR_GAP_DAYS = 5;
/** Consecutive semimonthly paydays land 10-20 days apart (the 15th-to-1st being the tightest). */
const MIN_SEMIMONTHLY_GAP_DAYS = 10;
const MAX_SEMIMONTHLY_GAP_DAYS = 20;

/** 0 = Sunday ... 6 = Saturday. 1970-01-01 (day number 0) is a Thursday. */
function weekday(dayNum: number): number {
  return (((dayNum + 4) % 7) + 7) % 7;
}

/** A payday never lands on a weekend — it moves to the Friday before, never later. */
export function shiftWeekendToFriday(date: string): string {
  const dn = dayNumber(date);
  const wd = weekday(dn);
  if (wd === 6) return dateFromDayNumber(dn - 1);
  if (wd === 0) return dateFromDayNumber(dn - 2);
  return date;
}

function nominalPayDate(y: number, m: number, anchorDay: number): string {
  const day = Math.min(anchorDay, daysInMonth(y, m));
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The actual (weekend-shifted) date a given month pays on for one anchor day. */
function actualPayDate(y: number, m: number, anchorDay: number): string {
  return shiftWeekendToFriday(nominalPayDate(y, m, anchorDay));
}

function monthAfter(y: number, m: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + 1;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Smallest of the two anchors' actual dates in `from`'s month or the next that falls after it. */
export function nextSemimonthlyDate(from: string, anchors: readonly [number, number]): string {
  const { y, m } = parts(from);
  const next = monthAfter(y, m);
  const candidates = [
    actualPayDate(y, m, anchors[0]),
    actualPayDate(y, m, anchors[1]),
    actualPayDate(next.y, next.m, anchors[0]),
    actualPayDate(next.y, next.m, anchors[1]),
  ];
  const fromN = dayNumber(from);
  const future = candidates
    .filter((c) => dayNumber(c) > fromN)
    .sort((a, b) => dayNumber(a) - dayNumber(b));
  return future[0] as string;
}

/**
 * Consecutive dates space out like semimonthly pay. Whether they actually touch both
 * anchors is already guaranteed by `fitSemimonthly`'s clustering (every date lands in one
 * of exactly two non-empty clusters, each within tolerance of its own anchor), so this only
 * needs to check the gap between charges.
 */
function alternatesAnchors(dates: readonly string[]): boolean {
  for (let i = 1; i < dates.length; i++) {
    const gap = dayNumber(dates[i] as string) - dayNumber(dates[i - 1] as string);
    if (gap < MIN_SEMIMONTHLY_GAP_DAYS || gap > MAX_SEMIMONTHLY_GAP_DAYS) return false;
  }
  return true;
}

/**
 * Two days-of-month, ~15 days apart (5th & 20th, 1st & 15th, ...), each occurrence within
 * `INTERVAL_TOLERANCE_DAYS` before its anchor — a weekend shift only ever moves a payday
 * earlier, so the largest day seen in a cluster is the true anchor.
 */
function fitSemimonthly(dates: readonly string[]): [number, number] | null {
  const days = dates.map((d) => parts(d).d);
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length < 2) return null;
  let splitAt = -1;
  let maxGap = -1;
  for (let i = 1; i < unique.length; i++) {
    const gap = (unique[i] as number) - (unique[i - 1] as number);
    if (gap > maxGap) {
      maxGap = gap;
      splitAt = i;
    }
  }
  if (maxGap < MIN_ANCHOR_GAP_DAYS) return null;
  const clusterA = unique.slice(0, splitAt);
  const clusterB = unique.slice(splitAt);
  const anchorA = clusterA.at(-1) as number;
  const anchorB = clusterB.at(-1) as number;
  const fitsCluster = (cluster: number[], anchor: number) =>
    cluster.every((d) => anchor - d >= 0 && anchor - d <= INTERVAL_TOLERANCE_DAYS);
  if (!fitsCluster(clusterA, anchorA) || !fitsCluster(clusterB, anchorB)) return null;
  const anchors: [number, number] = [Math.min(anchorA, anchorB), Math.max(anchorA, anchorB)];
  if (!alternatesAnchors(dates)) return null;
  return anchors;
}

/**
 * Semimonthly pay (e.g. 5th & 20th) isn't one of the generic cadences `detectSeries` tries —
 * it alternates between two fixed days of month rather than a fixed interval. Called as a
 * fallback when `detectSeries` finds nothing.
 */
export function detectSemimonthly(
  occurrences: readonly Occurrence[],
  today: string,
): DetectedSeries | null {
  const all = [...occurrences].sort((a, b) => a.date.localeCompare(b.date));
  for (let start = 0; start + MIN_SEMIMONTHLY_OCCURRENCES <= all.length; start++) {
    const run = all.slice(start);
    const amounts = run.map((o) => o.amountCents);
    if (amounts.some((a) => Math.sign(a) !== Math.sign(amounts[0] as number) || a === 0)) continue;
    if (!steadyAmounts(amounts)) continue;
    const dates = run.map((o) => o.date);
    const anchors = fitSemimonthly(dates);
    if (!anchors) continue;
    const last = run.at(-1) as Occurrence;
    const nextExpectedDate = nextSemimonthlyDate(last.date, anchors);
    return {
      cadence: 'semimonthly',
      expectedAmountCents: last.amountCents,
      lastDate: last.date,
      nextExpectedDate,
      status:
        dayNumber(today) - dayNumber(nextExpectedDate) > BROKEN_AFTER_DAYS ? 'broken' : 'active',
      categoryId: establishedCategory(run),
      occurrences: run.length,
      anchorDays: anchors,
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

export interface ProjectedOccurrence {
  date: string;
  amountCents: number;
}

/**
 * The next `count` dates a series is expected to land on, at its current amount. Used to
 * build a cash-flow projection (paychecks in, real auto-drafted bills out) — never called
 * for a card payment, since those are never a predictable outflow.
 */
export function projectOccurrences(series: DetectedSeries, count: number): ProjectedOccurrence[] {
  const anchorDay = parts(series.nextExpectedDate).d;
  const out: ProjectedOccurrence[] = [];
  let date = series.nextExpectedDate;
  for (let i = 0; i < count; i++) {
    out.push({ date, amountCents: series.expectedAmountCents });
    date =
      series.cadence === 'semimonthly'
        ? nextSemimonthlyDate(date, series.anchorDays as [number, number])
        : nextDate(series.cadence, date, anchorDay);
  }
  return out;
}

/**
 * A user-declared cash withdrawal (SPEC-adjacent: Caleb's cash-to-payday tool). Unlike a
 * `DetectedSeries`, its cadence and next date are declared up front from one transaction
 * rather than inferred from three — for a bill that's real but too new, too irregularly
 * amounted, or too easily confused with a sibling (two different student loans) to detect.
 */
export interface ManualRule {
  cadence: Cadence;
  anchorDays: [number, number] | null;
  expectedAmountCents: number;
  /** The declared due date, or the date it last advanced to after a confirming charge. */
  nextExpectedDate: string;
}

/** Caleb: 2 days late without notice is worth flagging — shorter than a detected series's 7. */
export const MISSED_AFTER_DAYS = 2;

/**
 * The first occurrence of a cadence starting from `anchorDate` that lands on or after
 * `today` — the declared due date itself is usually in the past (it's the transaction the
 * user just tagged), so a fresh manual rule's `nextExpectedDate` starts here, not at the
 * anchor.
 */
export function firstUpcoming(
  cadence: Cadence,
  anchorDate: string,
  anchorDays: [number, number] | null,
  today: string,
): string {
  let date = anchorDate;
  while (dayNumber(date) < dayNumber(today)) {
    date =
      cadence === 'semimonthly'
        ? nextSemimonthlyDate(date, anchorDays as [number, number])
        : nextDate(cadence, date, parts(anchorDate).d);
  }
  return date;
}

/**
 * Advance a manual rule against fresh occurrences of its merchant: a charge on or after the
 * due date (within tolerance) confirms it and rolls `nextExpectedDate` to the next cycle;
 * otherwise it stays put, and reads `broken` once it's more than `MISSED_AFTER_DAYS` overdue
 * — same status a detected series uses, so the existing "hasn't charged since..." banner
 * covers this too.
 */
export function advanceManualRule(
  rule: ManualRule,
  occurrences: readonly Occurrence[],
  today: string,
): { nextExpectedDate: string; status: 'active' | 'broken' } {
  const confirming = occurrences
    .filter((o) => Math.sign(o.amountCents) === Math.sign(rule.expectedAmountCents))
    .filter((o) => steadyAmounts([o.amountCents, rule.expectedAmountCents]))
    .filter((o) => dayNumber(o.date) >= dayNumber(rule.nextExpectedDate) - INTERVAL_TOLERANCE_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date));
  let next = rule.nextExpectedDate;
  for (const o of confirming) {
    if (dayNumber(o.date) < dayNumber(next) - INTERVAL_TOLERANCE_DAYS) continue;
    next =
      rule.cadence === 'semimonthly'
        ? nextSemimonthlyDate(o.date, rule.anchorDays as [number, number])
        : nextDate(rule.cadence, o.date, parts(o.date).d);
  }
  const status = dayNumber(today) - dayNumber(next) > MISSED_AFTER_DAYS ? 'broken' : 'active';
  return { nextExpectedDate: next, status };
}
